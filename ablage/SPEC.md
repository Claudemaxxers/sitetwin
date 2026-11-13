# SPEC – SiteTwin Ablage (Ingestion Layer)

> **Für Claude/Fable:** Lies diese Datei vor jeder Aufgabe vollständig. Sie ist die einzige Quelle der Wahrheit für dieses Modul. Wenn etwas hier nicht steht: nachfragen, nicht raten. Änderungen am Datenvertrag (Abschnitt 4–6) nur nach Absprache mit Henrik (DB + Übersetzer).

Owner: Santino (Ablage) · Henrik (DB + Übersetzer) · Melih (Call-Agent, UI) · Stack: Python 3.11+, FastAPI, Pydantic v2, Supabase (Postgres + Storage), pytest · Stand: 13.11.2026, Building Better Worlds Hackathon, Track Talona

---

## 1. Zweck

SiteTwin ist unser Beitrag zu Talona Track 01, *Context for the Physical World*: **ein Live-Protokoll der Baustelle**, das festhält, was sich geändert hat und wer es entschieden hat, und Probleme meldet, solange noch jemand eingreifen kann (verpasste Änderung, Arbeit außer Reihenfolge, veralteter Plan). Die **Ablage** ist die Eingangsschicht und dockt an das an, was die Baustelle schon nutzt: Sie holt alles, was dort kommuniziert wird (WhatsApp, E-Mail, Drive-Dateien, Fotos, Sprachnachrichten, Anruf-Transkripte), **unverändert** an einen Ort, damit der **Übersetzer** (Claude-API) daraus strukturierte Änderungen machen kann.

Demo-Fall ist ein Elektro-Subunternehmer auf dem BV Simmering; das Golden Set in `fake_data/ERWARTET.md` sind die Änderungen, die dort sonst untergehen.

**Die Ablage interpretiert nichts.** Sie parst Formate, normalisiert sie in ein gemeinsames `RawItem` und speichert sie mit Beleg. Ob etwas eine Änderung oder ein Problem ist, entscheidet der Übersetzer.

## 2. Abgrenzung

| Gehört zur Ablage | Gehört NICHT zur Ablage |
|---|---|
| Formate parsen (WhatsApp-Export, .eml, Dateien, Call-JSON) | LLM-Extraktion, LV-Abgleich (→ Übersetzer, Henrik) |
| Normalisieren in `RawItem` | Tabelle `aenderungen` (→ Henrik) |
| Dateien in Supabase Storage ablegen | UI, Dashboard, Zwilling (→ Henrik, Melih) |
| Duplikate verhindern | Telefonie (→ Melih, liefert nur das JSON) |
| Status `neu` setzen | Status weitersetzen (→ Henrik, direkt in der Tabelle) |
| Sidecar-Transkripte und PDF-Text nach `text` übernehmen | Whisper-Transkription (Stretch, s. 11) |

## 3. Architektur

```
 WhatsApp-Export ─┐
 .eml-Dateien ────┤   adapters/*  (reine Funktionen, kein I/O außer Lesen)
 Drive-Ordner ────┼──▶ parse(path, ctx) -> Iterator[RawItem]
 Call-JSON ───────┘                 │
                                    ▼
                         store.py: Storage-Upload + Upsert (content_hash)
                                    │
                                    ▼
                    Supabase: Tabelle `quellen` (status = 'neu')
                                    ▲
                                    │  liest direkt (Service-Key), setzt status
                              Übersetzer (Henrik)
```

Prinzipien:
1. **Unveränderliche Rohdaten.** `quellen` wird nur eingefügt, nie inhaltlich geändert. Einzige änderbare Spalte: `status` (+ `meta.fehler`), gesetzt vom Übersetzer.
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
    zeitpunkt: datetime | None        # timezone-aware, Europe/Vienna; None bei Drive (Stammdaten)
    text: str = ""                    # Nachrichtentext / Mail-Body / Transkript / extrahierter Dateitext
    anhang: Anhang | None = None
    original_ref: str                 # Rückverweis, s. u.
    meta: dict = Field(default_factory=dict)

    def content_hash(self) -> str: ...  # s. Abschnitt 6
```

`original_ref` – Format je Quelle:
- whatsapp: `"<exportdatei>#L<zeilennummer>"` (erste Zeile der Nachricht, 1-basiert); live: `"<wa_id>"`
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
  zeitpunkt     timestamptz,     -- null bei drive
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

**Vertrag mit dem Übersetzer (Henrik).** Diese Tabelle ist die Schnittstelle, nicht die API.
- Henrik liest direkt aus `quellen` und holt Dateien mit dem Service-Key aus dem Bucket.
- Er schreibt nur `status` (`verarbeitet` | `fehler`) und `meta.fehler`. Sonst schreibt nur die Ablage.
- Belege in `aenderungen` referenzieren **`content_hash`**, nicht `id`. Die `id` ändert sich bei jedem Neuimport, der Hash nicht.
- Eine Änderung hat mehrere Belege (Golden Set: bis zu 6) → n:m.
- Für einen Nachtrag die ganze Projekt-Zeitachse lesen (`where projekt = …`), `status = 'neu'` ist nur der Marker für Neues. Belege verteilen sich über WhatsApp, Mail und Call.
- Fotos, Sprachnachrichten und PDFs sind eigene Zeilen mit `anhang_pfad`. **PDF-Zeilen (Mail-Anhang und Drive) haben den per `pypdf` extrahierten Text in `text`** (`meta.text_quelle = "pypdf"`; kaputtes PDF → `text` leer + `meta.pdf_fehler`). Fotos: `text` leer. Sprachnachrichten: Transkript nur, wenn ein Sidecar daneben liegt, sonst leer → Transkription macht der Übersetzer (s. 12).

## 6. Identität und Duplikate

```
Standard (whatsapp, email):
content_hash = sha256( typ | projekt | kanal | absender | zeitpunkt_iso_utc | text | anhang.sha256 or "" )

drive:  sha256( typ | projekt | kanal | original_ref | anhang.sha256 )
call:   sha256( typ | projekt | call_id )
whatsapp live (meta.wa_id gesetzt):  sha256( typ | projekt | wa_id )
```
- Felder mit `|` verbunden, `None` → `""`, Text vorher `strip()` und Zeilenenden auf `\n`.
- **Items mit `anhang`: `text` geht als `""` in den Hash.** Transkript und PDF-Text sind abgeleitet und dürfen die Identität nicht ändern.
- **Drive:** Identität ist Pfad + Dateiinhalt. Die mtime ist pro Clone anders und steht deshalb nicht im Hash. Einzige Ausnahme von „`original_ref` nicht im Hash“.
- **Call:** Identität ist `call_id`. Retries und eine nachgelieferte Zusammenfassung erzeugen keine zweite Zeile.
- **WhatsApp live:** Identität ist `wa_id` (Message-ID des Providers). Webhook-Retries erzeugen keine zweite Zeile. Folge: Dieselbe Nachricht einmal live und einmal per Export ergibt zwei Zeilen (der Export kennt keine `wa_id` und nur Minuten). Für die Demo pro Chat einen Weg wählen.
- Upsert mit `on_conflict=content_hash`, `ignore_duplicates=true`. Folge: Ein später ergänztes Transkript aktualisiert die bestehende Zeile nicht → für die Demo Tabelle leeren und neu importieren (Referenzen über `content_hash` bleiben gültig).
- Bewusst **nicht** im Hash: `meta`, Dateiname der Exportdatei, `original_ref` außer bei Drive (der Chat wird oft mehrmals mit anderem Namen exportiert).
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
Input: Ordner mit Export + Mediendateien (flach oder in `media/`), oder `.zip` desselben.

- Als Export zählt nur `WhatsApp Chat mit *.txt` (englisch `… with *.txt`) und beim iPhone `_chat.txt`. Andere `.txt`/`.md` im Ordner (Sidecars, `SPRACHNACHRICHTEN.md`) werden nicht geparst.
- **Android/DE-Format (Pflicht):** `DD.MM.YY, HH:MM - Absender: Text`
- **iPhone-Format:** `[DD.MM.YY, HH:MM:SS] Absender: Text`, Anhang als `<Anhang: DATEI>`; `kanal` kommt aus dem Namen der Zip bzw. des Ordners (`WhatsApp Chat - <Gruppe>`).
- Ebenfalls gelesen: `/` statt `.` im Datum, 12-Stunden-Zeit (`10:31 pm`), englische Marker (`(file attached)`, `<attached: …>`, `<Media omitted>`, `This message was deleted`).
- Zeile ohne Datums-Präfix = Fortsetzung der vorherigen Nachricht (mit `\n` anhängen).
- Zeile mit Datum, aber ohne `Absender: ` = **Systemzeile** → überspringen (Gruppe erstellt, hinzugefügt, Verschlüsselungshinweis).
- `<DATEINAME> (Datei angehängt)` → `anhang` aus gleichnamiger Datei; Text bleibt leer. Datei fehlt → Item trotzdem anlegen, `meta.anhang_fehlt = true`.
- **Sidecar-Transkript (Pflicht):** Liegt neben einer Audiodatei `<DATEINAME>.txt` (z. B. `PTT-20261112-WA0009.opus.txt`), wird der Inhalt zu `text`, mit `meta.transkript_quelle = "sidecar"`. Sidecars sind keine Anhänge und keine eigenen Items.
- `<Medien ausgeschlossen>` → `meta.medien_ausgeschlossen = true`.
- `Diese Nachricht wurde gelöscht.` → Item anlegen, `meta.geloescht = true`.
- `kanal` = Gruppenname aus Dateiname `WhatsApp Chat mit <Gruppe>.txt`.
- Unsichtbare Zeichen (U+200E, U+202F, BOM) vor dem Parsen entfernen.

### 7.2 E-Mail (`adapters/eml.py`)
Die Datei heißt `eml.py`, nicht `email.py` (sonst Namenskollision mit dem stdlib-Modul `email`).

Input: Ordner mit `.eml`. Parsen mit `email.parser.BytesParser(policy=email.policy.default)` (dekodiert RFC-2047-Betreffs).
- 1 RawItem pro Mail: `text = "Betreff: …\n\n" + text/plain-Body` (fallback: HTML → Text). `absender` = From-Header, `kanal` = To-Adresse, `zeitpunkt` = Date-Header.
- `meta`: `message_id`, `in_reply_to`, `to`, `cc`, `betreff`.
- **1 zusätzliches RawItem pro Anhang** mit `meta.gehoert_zu = <content_hash der Mail>`, gleicher Absender/Zeitpunkt. PDF-Anhänge: Text via `pypdf` nach `text` (dieselbe Funktion wie 7.3), sonst leer.

### 7.3 Drive (`adapters/ordner.py`)
Input: Ordner (simuliert Google Drive). Rekursiv, 1 RawItem pro Datei, `anhang` = die Datei selbst.
- `zeitpunkt = None` (Stammdaten, keine Ereignisse); mtime nur als `meta.mtime`. `absender` = `None`; `kanal` = Wurzelordnername.
- `.csv .md .txt` → Inhalt als `text`. `.pdf` → Text via `pypdf` (feste Dependency).
- Versteckte Dateien (`.*`) ignorieren. Importiert wird nur `fake_data/drive/`, nicht `fake_data/` als Ganzes (dort liegen `ERWARTET.md` usw.).

### 7.4 Call (`adapters/call.py`, kein Datei-, sondern JSON-Input)
**Vertrag v1 = `fake_data/calls/call_2026-11-13_1610_huber.json`.** Melih mappt das Format seines Anbieters (Vapi/Retell) auf seiner Seite in diese Form und POSTet selbst an `/import/call`. Kein Provider-Webhook direkt auf die Ablage.
- Pflichtfelder: `call_id`, `gestartet_um` (ISO mit Offset oder `Z`), `transkript[]` mit `rolle` + `text`. Optional: `projekt` (fehlt → `DEFAULT_PROJEKT`), `angerufene_person`, `telefon`, `richtung`, `beendet_um`, `zusammenfassung`.
- Unbekannte Felder werden ignoriert, die ganze Payload landet in `meta.roh`.
- 1 RawItem: `typ=call`, `absender = angerufene_person`, `kanal = telefon`, `zeitpunkt = gestartet_um` (nach Europe/Vienna).
- `text` = Transkript als Zeilen `Agent: …` / `<Name>: …`.
- `meta`: `call_id`, `richtung`, `dauer_s`, `zusammenfassung`, `roh`.
- Erreichbarkeit: Melihs Agent muss die Ablage erreichen (gleicher Rechner oder Tunnel) → s. 12.

### 7.5 WhatsApp live (`adapters/whatsapp_live.py`, JSON-Input)
Eine einzelne Nachricht per `POST /import/whatsapp/nachricht`. Wer den Provider-Webhook empfängt, mappt auf diese Form:
```json
{"projekt": "BV Simmering", "kanal": "BV Simmering Elektro", "absender": "Stefan Huber",
 "zeitpunkt": "2026-11-14T08:15:30+01:00", "text": "…", "wa_id": "wamid.…",
 "anhang": {"mimetype": "image/jpeg", "dateiname": "IMG.jpg", "base64": "…"}}
```
- Pflicht: `absender`, `zeitpunkt` (ISO; ohne Offset = Europe/Vienna), `wa_id`. Optional: `projekt` (fehlt → `DEFAULT_PROJEKT`), `kanal`, `text`, `anhang`.
- 1 RawItem: `typ=whatsapp`, `original_ref = wa_id`, `meta = {wa_id, quelle: "live"}`. Anhang wird wie beim Export in den Bucket gelegt.
- Identität ist `wa_id` (Abschnitt 6).

## 8. API (`api.py`, FastAPI)

| Methode | Pfad | Body | Antwort |
|---|---|---|---|
| GET | `/health` | – | `{"ok": true}` |
| POST | `/import/whatsapp` | multipart: `.zip` oder `.txt` + Mediendateien, Feld `projekt` | `ImportErgebnis` |
| POST | `/import/email` | multipart: 1..n `.eml`, Feld `projekt` | `ImportErgebnis` |
| POST | `/import/ordner` | JSON `{"pfad": "...", "projekt": "..."}` – **nur lokal/dev** | `ImportErgebnis` |
| POST | `/import/call` | Call-JSON v1 (7.4) | `ImportErgebnis` |
| POST | `/import/whatsapp/nachricht` | Live-Nachricht als JSON (7.5) | `ImportErgebnis` |
| GET | `/quellen` *(optional)* | Query: `status`, `typ`, `projekt`, `limit` (≤200), `seit` | `list[QuelleOut]` sortiert nach `zeitpunkt` |
| PATCH | `/quellen/{id}/status` *(optional)* | `{"status": "verarbeitet" \| "fehler", "fehler": "..."}` | `QuelleOut` |

Die beiden `/quellen`-Endpunkte sind optional, weil Henrik direkt aus der Tabelle liest (Abschnitt 5). Falls gebaut: `QuelleOut` = alle Spalten aus Abschnitt 5, `seit` filtert auf `importiert_am`.

```python
class ImportErgebnis(BaseModel):
    gelesen: int
    neu: int
    duplikate: int
    fehler: list[str]   # "datei#L12: Grund"
```

CLI für die Demo und Tests (aus `sitetwin/ablage/` starten): `python -m ablage import <whatsapp|email|ordner|call> <pfad> --projekt "BV Simmering"`

## 9. Konfiguration (`ablage/.env`, nie committen; `ablage/.env.example` committen)

Die `.env.example` im Repo-Root gehört zu Melihs App und bleibt unangetastet.

```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
ABLAGE_BUCKET=ablage
DEFAULT_PROJEKT=BV Simmering
TZ=Europe/Vienna
```

## 10. Qualität

- **Tests** (`ablage/tests/`, pytest, Fixtures = `fake_data/` im Repo-Root). Mindestens:
  - WhatsApp: 39 Nachrichten, 5 Systemzeilen übersprungen, 5 Anhänge, 4 Absender exakt, Mehrzeiler korrekt, gelöschte Nachricht markiert, beide Sprachnachrichten mit Sidecar-Transkript in `text`
  - E-Mail: 6 Mails + 2 Anhänge, Umlaut-Betreff dekodiert, `in_reply_to` gesetzt
  - Ordner: 5 Dateien, CSV-Inhalt im Text, Steuerdateien ignoriert, `zeitpunkt` ist `None`
  - Call: Transkript-Zeilen, Zeitzone korrekt, `projekt` aus Payload
  - Hash: gleicher Input → gleicher Hash; anderer Exportdateiname → gleicher Hash; Drive-Datei mit geänderter mtime → gleicher Hash; Audio-Item mit und ohne Sidecar → gleicher Hash; Call mit geänderter Zusammenfassung → gleicher Hash
  - Store (mit Fake-Client): zweiter Import → `neu = 0`
  - Szenario `fake_data/szenarien/wand_top5/` (Kernbeispiel aus `KONZEPT.md`): 10 WhatsApp-Nachrichten + 1 Call, zusätzlich zu den Basisdaten importiert → 11 neu, zusammen 64. Die Basisdaten bleiben unverändert, weil auch die Tests des Übersetzers an ihren Zahlen hängen.
- Adapter-Tests laufen **ohne** Supabase. Store bekommt den Client per Dependency Injection.
- Dependencies in `ablage/pyproject.toml`, darunter `pypdf` und **`tzdata`** (Windows hat keine Zeitzonendatenbank, ohne `tzdata` wirft `ZoneInfo("Europe/Vienna")`).
- `ruff` für Lint/Format. Typ-Hints überall.
- Keine Secrets im Repo. `ablage/README.md` mit Setup, Start, Architektur, Annahmen (Pflicht für die Einreichung).

## 11. Nicht-Ziele heute / Stretch

Nicht heute: echte WhatsApp-Business-API, Gmail/Outlook-OAuth, Google-Drive-API, Auth, Mandantenfähigkeit.
Pitch-Satz: *„Connectors sind austauschbare Adapter. Die Demo nutzt Exporte, Produktion nutzt die APIs.“*

Stretch (in dieser Reihenfolge): (1) Whisper für Sprachnachrichten ohne Sidecar, füllt dasselbe Feld `text` mit `meta.transkript_quelle = "whisper"`, (2) iOS-WhatsApp-Format, (3) `GET /quellen` + `PATCH` (Abschnitt 8), (4) Drive-Ordner beobachten (Watcher).

## 12. Offene Fragen

Entschieden:
- [x] Ablage = Santino. DB + Übersetzer = Henrik. Henrik liest direkt aus `quellen`, kein Polling über die API.
- [x] `projekt` ist beim Import frei wählbar.
- [x] **Henrik (13.11., 21:21):** Vertrag aus 5 + 6 bestätigt, für die Ablage ändert sich nichts. Belege über `content_hash` ohne Fremdschlüssel → `quellen` darf jederzeit geleert und neu importiert werden. Sein Schema (`eintraege`, `plaene`, `signale`) liegt in `uebersetzer/schema.sql`.
- [x] `quellen` + Bucket `ablage` existieren im gemeinsamen Supabase-Projekt.
- [x] **PDF-Text:** macht die Ablage (pypdf), Henrik muss PDFs nicht selbst auslesen.
- [x] **Sprachnachrichten ohne Sidecar:** Transkription übernimmt Henrik im Übersetzer. Whisper in der Ablage bleibt Stretch.

Offen:
- [ ] **Melih:** Bestätigt Call-Vertrag v1 (7.4) und mappt sein Provider-Format dorthin.
- [ ] **Melih:** Von wo ruft sein Agent `/import/call` auf (gleicher Rechner oder Tunnel)?

## 13. Reihenfolge + Definition of Done

Schritte 1–3 brauchen kein Supabase.

1. `models.py` + Hash + Tests → **DoD:** Hash-Tests grün
2. `adapters/whatsapp.py` + Tests → **DoD:** Zahlen aus 10 stimmen
3. `store.py` (Fake-Client + Supabase-Client) → **DoD:** zweiter Import = 0 neu
4. CLI → **DoD:** WhatsApp-Export landet in Supabase, sichtbar im Table Editor
5. `adapters/eml.py`, `adapters/ordner.py`, `adapters/call.py` + Tests
6. `api.py` (Import-Endpunkte) → **DoD:** Melihs Call-JSON per `curl` → Zeile in `quellen`
7. `ablage/README.md`, `ablage/.env.example` (keine `LICENSE`: Talona-Track, privates Repo, die Arbeit gehört Talona)

## 14. Ordnerstruktur

Die Ablage lebt als Unterordner im Repo `sitetwin`. Im Root liegt Melihs Next.js-App; deren `tests/` und `.env.example` gehören nicht zur Ablage.

```
sitetwin/
  LICENSE
  fake_data/             # Fixtures, siehe fake_data/ERWARTET.md
  ablage/
    SPEC.md
    README.md
    .env.example
    pyproject.toml
    ablage/              # Python-Paket
      __init__.py
      __main__.py        # CLI
      models.py
      hashing.py
      adapters/{whatsapp,eml,ordner,call}.py
      store.py
      api.py
    tests/               # pytest; FAKE_DATA = <Repo-Root>/fake_data
```
