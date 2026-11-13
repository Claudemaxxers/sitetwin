# SPEC – Tieout Ablage (Ingestion Layer)

> **Für Claude/Fable:** Lies diese Datei vor jeder Aufgabe vollständig. Sie ist die einzige Quelle der Wahrheit für dieses Modul. Wenn etwas hier nicht steht: nachfragen, nicht raten. Änderungen am Datenvertrag (Abschnitt 4–6) nur nach Absprache mit Henrik (DB) und dem Übersetzer.

Owner: Santino · Stack: Python 3.11+, FastAPI, Pydantic v2, Supabase (Postgres + Storage), pytest · Stand: 13.11.2026, Building Better Worlds Hackathon, Track Talona

---

## 1. Zweck

Tieout hilft **Subunternehmern** (Elektro, HKLS), keine ausgeführte Mehrleistung zu verlieren. Die **Ablage** ist die Eingangsschicht: Sie holt alles, was auf der Baustelle kommuniziert wird (WhatsApp, E-Mail, Drive-Dateien, Fotos, Sprachnachrichten, Anruf-Transkripte), **unverändert** an einen Ort, damit der **Übersetzer** (Claude-API) daraus strukturierte Änderungen machen kann.

**Die Ablage interpretiert nichts.** Sie parst Formate, normalisiert sie in ein gemeinsames `RawItem` und speichert sie mit Beleg. Ob etwas eine Mehrleistung ist, entscheidet der Übersetzer.

## 2. Abgrenzung

| Gehört zur Ablage | Gehört NICHT zur Ablage |
|---|---|
| Formate parsen (WhatsApp-Export, .eml, Dateien, Call-JSON) | LLM-Extraktion, LV-Abgleich (→ Übersetzer) |
| Normalisieren in `RawItem` | Tabelle `aenderungen` (→ Henrik / Übersetzer) |
| Dateien in Supabase Storage ablegen | UI, Dashboard, Zwilling (→ Henrik, Melih) |
| Duplikate verhindern | Telefonie (→ Melih, liefert nur das JSON) |
| Status `neu` setzen, `GET /quellen?status=neu` anbieten | Transkription von Sprachnachrichten (Stretch, s. 11) |

## 3. Architektur

```
 WhatsApp-Export ─┐
 .eml-Dateien ────┤   adapters/*  (reine Funktionen, kein I/O außer Lesen)
 Drive-Ordner ────┼──▶ parse(path, ctx) -> Iterator[RawItem]
 Call-Webhook ────┘                 │
                                    ▼
                         store.py: Storage-Upload + Upsert (content_hash)
                                    │
                                    ▼
                    Supabase: Tabelle `quellen` (status = 'neu')
                                    │
                    GET /quellen?status=neu   ◀── Übersetzer (Claude)
                    PATCH /quellen/{id}/status ◀── setzt verarbeitet | fehler
```

Prinzipien:
1. **Unveränderliche Rohdaten.** `quellen` wird nur eingefügt, nie inhaltlich geändert. Einzige änderbare Spalte: `status` (+ `meta.fehler`).
2. **Ein Adapter pro Quelle, ein Ausgabeformat.** Adapter kennen weder DB noch HTTP.
3. **Idempotenz.** Gleicher Input zweimal importiert → keine Duplikate (Abschnitt 6).
4. **Rückverfolgbarkeit.** Jedes `RawItem` zeigt auf seine Originaldatei und Position darin.
5. **Fehler isolieren.** Eine kaputte Zeile/Datei bricht nicht den ganzen Import ab; sie landet in `ImportErgebnis.fehler`.

## 4. Datenmodell (Python)

```python
from datetime import datetime
from enum import Enum
from pydantic import BaseModel, Field

class QuellTyp(str, Enum):
    whatsapp = "whatsapp"
    email = "email"
    drive = "drive"
    call = "call"

class AnhangTyp(str, Enum):
    image = "image"      # .jpg .jpeg .png .heic
    audio = "audio"      # .opus .ogg .m4a .mp3 .wav
    pdf = "pdf"
    tabelle = "tabelle"  # .csv .xlsx
    text = "text"        # .txt .md
    sonstig = "sonstig"

class Status(str, Enum):
    neu = "neu"
    verarbeitet = "verarbeitet"
    fehler = "fehler"

class Anhang(BaseModel):
    lokaler_pfad: str | None = None   # nur während des Imports
    storage_pfad: str | None = None   # gesetzt von store.py
    dateiname: str
    typ: AnhangTyp
    sha256: str                       # Hash des Dateiinhalts

class RawItem(BaseModel):
    typ: QuellTyp
    projekt: str                      # z. B. "BV Simmering"
    kanal: str | None = None          # WhatsApp-Gruppe, Postfach, Drive-Ordner, Telefonnummer
    absender: str | None = None       # wie im Original, nicht normalisiert
    zeitpunkt: datetime | None        # immer timezone-aware, Europe/Vienna
    text: str = ""                    # Nachrichtentext / Mail-Body / Transkript / extrahierter Dateitext
    anhang: Anhang | None = None
    original_ref: str                 # Rückverweis, s. u.
    meta: dict = Field(default_factory=dict)

    def content_hash(self) -> str: ...  # s. Abschnitt 6
```

`original_ref` – Format je Quelle:
- whatsapp: `"<exportdatei>#L<zeilennummer>"` (erste Zeile der Nachricht, 1-basiert)
- email: `"<Message-ID>"`, Anhang: `"<Message-ID>#<dateiname>"`
- drive: relativer Pfad ab Drive-Wurzel, z. B. `"Projekt_Simmering/Plaene/Plan_E-05_Top5_IndexC.pdf"`
- call: `"<call_id>"`

## 5. Datenbank (Supabase)

```sql
create table quellen (
  id            uuid primary key default gen_random_uuid(),
  typ           text not null check (typ in ('whatsapp','email','drive','call')),
  projekt       text not null,
  kanal         text,
  absender      text,
  zeitpunkt     timestamptz,
  text          text not null default '',
  anhang_pfad   text,            -- Storage-Pfad im Bucket 'ablage'
  anhang_typ    text,
  anhang_name   text,
  original_ref  text not null,
  content_hash  text not null unique,
  status        text not null default 'neu' check (status in ('neu','verarbeitet','fehler')),
  meta          jsonb not null default '{}',
  importiert_am timestamptz not null default now()
);
create index quellen_status_idx on quellen (status, zeitpunkt);
create index quellen_projekt_idx on quellen (projekt, zeitpunkt);
```

Storage: Bucket `ablage` (privat). Pfad: `{projekt_slug}/{typ}/{sha256}{endung}` → gleiche Datei = gleicher Pfad = kein Doppel-Upload.

## 6. Identität und Duplikate

```
content_hash = sha256( typ | projekt | kanal | absender | zeitpunkt_iso_utc | text | anhang.sha256 or "" )
```
- Felder mit `|` verbunden, `None` → `""`, Text vorher `strip()` und Zeilenenden auf `\n`.
- Upsert mit `on_conflict=content_hash`, `ignore_duplicates=true`.
- Bewusst **nicht** im Hash: `original_ref`, `meta`, Dateiname der Exportdatei (der Chat wird oft mehrmals mit anderem Namen exportiert).
- Bekannte Einschränkung: Zwei identische Nachrichten derselben Person in derselben Minute („ok“, „👍“) fallen zusammen. Für den Hackathon akzeptiert.

## 7. Adapter

Gemeinsame Signatur:
```python
@dataclass(frozen=True)
class ImportKontext:
    projekt: str
    tz: ZoneInfo = ZoneInfo("Europe/Vienna")

def parse(path: Path, ctx: ImportKontext) -> Iterator[RawItem | ParseFehler]: ...
```
Adapter sind **reine Funktionen**: lesen Dateien, geben Items zurück, schreiben nichts.

### 7.1 WhatsApp (`adapters/whatsapp.py`)
Input: Ordner mit `*.txt` (Export) + Mediendateien (flach oder in `media/`), oder `.zip` desselben.

- **Android/DE-Format (Pflicht):** `DD.MM.YY, HH:MM - Absender: Text`
- **iOS-Format (Stretch):** `[DD.MM.YY, HH:MM:SS] Absender: Text`
- Zeile ohne Datums-Präfix = Fortsetzung der vorherigen Nachricht (mit `\n` anhängen).
- Zeile mit Datum, aber ohne `Absender: ` = **Systemzeile** → überspringen (Gruppe erstellt, hinzugefügt, Verschlüsselungshinweis).
- `<DATEINAME> (Datei angehängt)` → `anhang` aus gleichnamiger Datei; Text bleibt leer. Datei fehlt → Item trotzdem anlegen, `meta.anhang_fehlt = true`.
- `<Medien ausgeschlossen>` → `meta.medien_ausgeschlossen = true`.
- `Diese Nachricht wurde gelöscht.` → Item anlegen, `meta.geloescht = true`.
- `kanal` = Gruppenname aus Dateiname `WhatsApp Chat mit <Gruppe>.txt`.
- Unsichtbare Zeichen (U+200E, U+202F, BOM) vor dem Parsen entfernen.

### 7.2 E-Mail (`adapters/email.py`)
Input: Ordner mit `.eml`. Parsen mit `email.parser.BytesParser(policy=email.policy.default)` (dekodiert RFC-2047-Betreffs).
- 1 RawItem pro Mail: `text = "Betreff: …\n\n" + text/plain-Body` (fallback: HTML → Text). `absender` = From-Header, `kanal` = To-Adresse, `zeitpunkt` = Date-Header.
- `meta`: `message_id`, `in_reply_to`, `to`, `cc`, `betreff`.
- **1 zusätzliches RawItem pro Anhang** mit `meta.gehoert_zu = <content_hash der Mail>`, gleicher Absender/Zeitpunkt, Text leer (PDF-Text: Stretch).

### 7.3 Drive (`adapters/ordner.py`)
Input: Ordner (simuliert Google Drive). Rekursiv, 1 RawItem pro Datei.
- `zeitpunkt` = mtime der Datei; `absender` = `None`; `kanal` = Wurzelordnername.
- `.csv .md .txt` → Inhalt als `text`. `.pdf` → Text via `pypdf`, falls installiert, sonst leer.
- Versteckte Dateien (`.*`) ignorieren. Importiert wird nur `fake_data/drive/`, nicht `fake_data/` als Ganzes (dort liegen `ERWARTET.md` usw.).

### 7.4 Call (`adapters/call.py`, kein Datei-, sondern JSON-Input)
Input: Webhook-JSON von Melih (Beispiel: `fake_data/calls/*.json`).
- 1 RawItem: `typ=call`, `absender = angerufene_person`, `kanal = telefon`, `zeitpunkt = gestartet_um`.
- `text` = Transkript als Zeilen `Agent: …` / `<Name>: …`.
- `meta`: `call_id`, `richtung`, `dauer_s`, `zusammenfassung`.
- Feldnamen sind Annahme → **mit Melih abstimmen** (s. 12).

## 8. API (`api.py`, FastAPI)

| Methode | Pfad | Body | Antwort |
|---|---|---|---|
| GET | `/health` | – | `{"ok": true}` |
| POST | `/import/whatsapp` | multipart: `.zip` oder `.txt` + Mediendateien, Feld `projekt` | `ImportErgebnis` |
| POST | `/import/email` | multipart: 1..n `.eml`, Feld `projekt` | `ImportErgebnis` |
| POST | `/import/ordner` | JSON `{"pfad": "...", "projekt": "..."}` – **nur lokal/dev** | `ImportErgebnis` |
| POST | `/import/call` | Call-JSON (Webhook) | `ImportErgebnis` |
| GET | `/quellen` | Query: `status`, `typ`, `projekt`, `limit` (≤200), `seit` | `list[QuelleOut]` sortiert nach `zeitpunkt` |
| PATCH | `/quellen/{id}/status` | `{"status": "verarbeitet" \| "fehler", "fehler": "..."}` | `QuelleOut` |

```python
class ImportErgebnis(BaseModel):
    gelesen: int
    neu: int
    duplikate: int
    fehler: list[str]   # "datei#L12: Grund"
```

CLI für die Demo und Tests: `python -m ablage import <whatsapp|email|ordner|call> <pfad> --projekt "BV Simmering"`

## 9. Konfiguration (`.env`, nie committen; `.env.example` committen)

```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
ABLAGE_BUCKET=ablage
DEFAULT_PROJEKT=BV Simmering
TZ=Europe/Vienna
```

## 10. Qualität

- **Tests** (`tests/`, pytest, Fixtures = `fake_data/`). Mindestens:
  - WhatsApp: 39 Nachrichten, 5 Systemzeilen übersprungen, 5 Anhänge, 4 Absender exakt, Mehrzeiler korrekt, gelöschte Nachricht markiert
  - E-Mail: 6 Mails + 2 Anhänge, Umlaut-Betreff dekodiert, `in_reply_to` gesetzt
  - Ordner: 5 Dateien, CSV-Inhalt im Text, Steuerdateien ignoriert
  - Call: Transkript-Zeilen, Zeitzone korrekt
  - Hash: gleicher Input → gleicher Hash; anderer Exportdateiname → gleicher Hash
  - Store (mit Fake-Client): zweiter Import → `neu = 0`
- Adapter-Tests laufen **ohne** Supabase. Store bekommt den Client per Dependency Injection.
- `ruff` für Lint/Format. Typ-Hints überall.
- Keine Secrets im Repo. README mit Setup, Start, Architektur, Annahmen (Pflicht für die Einreichung).

## 11. Nicht-Ziele heute / Stretch

Nicht heute: echte WhatsApp-Business-API, Gmail/Outlook-OAuth, Google-Drive-API, Auth, Mandantenfähigkeit.
Pitch-Satz: *„Connectors sind austauschbare Adapter. Die Demo nutzt Exporte, Produktion nutzt die APIs.“*

Stretch (in dieser Reihenfolge): (1) Sprachnachrichten → Whisper-Transkript in `meta.transkript` und `text`, (2) PDF-Text bei Mail-Anhängen, (3) iOS-WhatsApp-Format, (4) Drive-Ordner beobachten (Watcher).

## 12. Offene Fragen (vor dem Coden klären)

- [ ] **Henrik:** Gleiches Supabase-Projekt? Darf ich `quellen` + Bucket `ablage` anlegen?
- [ ] **Henrik:** Wie heißt das Projekt in seinen Tabellen (`projekt`-String oder `projekt_id`)?
- [ ] **Melih:** Exaktes Webhook-Format seines Call-Anbieters (Vapi/Retell) → Feldnamen in 7.4 anpassen.
- [ ] **Übersetzer:** Holt er per `GET /quellen?status=neu` (Polling) oder direkt aus Supabase? Beides geht; die API ist der saubere Weg.
- [ ] Eine Ablage pro Projekt oder `projekt` beim Import frei wählbar? (Annahme: frei wählbar)

## 13. Reihenfolge + Definition of Done

1. `models.py` + Hash + Tests → **DoD:** Hash-Tests grün
2. `adapters/whatsapp.py` + Tests → **DoD:** Zahlen aus 10 stimmen
3. `store.py` (Fake-Client + Supabase-Client) → **DoD:** zweiter Import = 0 neu
4. CLI → **DoD:** WhatsApp-Export landet in Supabase, sichtbar im Table Editor
5. `adapters/email.py`, `adapters/ordner.py`, `adapters/call.py` + Tests
6. `api.py` → **DoD:** Melihs Call-JSON per `curl` → Zeile in `quellen`
7. README, `.env.example`, MIT `LICENSE`

## 14. Ordnerstruktur

```
tieout-ablage/
  SPEC.md
  README.md
  LICENSE
  .env.example
  pyproject.toml
  ablage/
    __init__.py
    __main__.py        # CLI
    models.py
    hashing.py
    adapters/{whatsapp,email,ordner,call}.py
    store.py
    api.py
  tests/
  fake_data/           # siehe fake_data/ERWARTET.md
```
