# SiteTwin Ablage

Eingangsschicht von SiteTwin: holt alles, was auf der Baustelle kommuniziert wird (WhatsApp, E-Mail, Drive-Dateien, Anruf-Transkripte), **unverändert** in die Supabase-Tabelle `quellen` und den Bucket `ablage`. Die Ablage interpretiert nichts; das macht der Übersetzer. Vertrag und Details: [SPEC.md](SPEC.md).

## Setup (Windows, PowerShell, Python 3.11+)

```powershell
cd ablage
py -3 -m venv .venv
.venv\Scripts\python -m pip install -e .
copy .env.example .env   # SUPABASE_URL + SUPABASE_SERVICE_KEY eintragen
```

Tabelle `quellen` (SQL in SPEC §5) und privater Bucket `ablage` müssen in Supabase existieren.

## Benutzen

```powershell
# Tests (laufen ohne Supabase, Fixtures = ../fake_data)
.venv\Scripts\python -m pytest -q

# Import per CLI (--dry-run: nur parsen, nichts schreiben)
.venv\Scripts\python -m ablage import whatsapp ..\fake_data\whatsapp --projekt "BV Simmering"
.venv\Scripts\python -m ablage import email    ..\fake_data\email    --projekt "BV Simmering"
.venv\Scripts\python -m ablage import ordner   ..\fake_data\drive    --projekt "BV Simmering"
.venv\Scripts\python -m ablage import call     ..\fake_data\calls    --projekt "BV Simmering"

# Szenario "Wand Top 5" (Kernbeispiel aus KONZEPT.md) zusätzlich einspielen
.venv\Scripts\python -m ablage import whatsapp ..\fake_data\szenarien\wand_top5\whatsapp --projekt "BV Simmering"
.venv\Scripts\python -m ablage import call     ..\fake_data\szenarien\wand_top5\calls    --projekt "BV Simmering"

# Die zuletzt importierten Zeilen ansehen
.venv\Scripts\python -m ablage zeige --projekt "BV Simmering" --limit 10

# Datenqualität von quellen + Bucket prüfen (liest nur, 22 Prüfungen, Abgleich mit ..\fake_data)
.venv\Scripts\python -m ablage audit --projekt "BV Simmering"

# API
.venv\Scripts\python -m uvicorn ablage.api:app --port 8000
curl.exe -X POST localhost:8000/import/call -H "Content-Type: application/json" --data-binary "@..\fake_data\calls\call_2026-11-13_1610_huber.json"
```

| Endpunkt | Body | Identität |
|---|---|---|
| `GET /health` | – | – |
| `POST /import/call` | Call-JSON v1 (SPEC §7.4) | `call_id` |
| `POST /import/whatsapp/nachricht` | eine Live-Nachricht (SPEC §7.5) | `wa_id` |

Antwort jeweils `{"gelesen", "neu", "duplikate", "fehler"}`. Interaktive Doku: `http://localhost:8000/docs`.

## Eigenen WhatsApp-Chat testen

1. In WhatsApp einen Test-Chat öffnen (am besten eine neue Gruppe nur mit Testnachrichten) → Menü → **Chat exportieren → Medien einschließen**. Die `.zip` auf den Rechner legen.
2. Erst ohne Schreiben prüfen, dann unter eigenem Projektnamen importieren und ansehen:

```powershell
.venv\Scripts\python -m ablage import whatsapp "C:\Pfad\WhatsApp Chat - Testgruppe.zip" --projekt "Test Santino" --dry-run
.venv\Scripts\python -m ablage import whatsapp "C:\Pfad\WhatsApp Chat - Testgruppe.zip" --projekt "Test Santino"
.venv\Scripts\python -m ablage zeige --projekt "Test Santino"
```

Gelesen werden Android- und iPhone-Exporte (`WhatsApp Chat mit ….txt` bzw. `_chat.txt` im Zip), deutsch und englisch. Sprachnachrichten landen als Datei im Bucket; `text` bleibt leer, solange keine Transkription läuft. Ein eigener Projektname hält die Testzeilen von „BV Simmering“ getrennt. Alles in `quellen` kann vom Übersetzer gelesen und an Claude geschickt werden, deshalb keine privaten Chats importieren.

## Architektur

```
adapters/whatsapp.py  eml.py  ordner.py  call.py  whatsapp_live.py
        │  reine Funktionen: parse(path, ctx) -> RawItem | ParseFehler
        ▼
store.py   Upload in den Bucket + Insert mit content_hash (Backend per Dependency Injection:
        │  SupabaseBackend in Produktion, FakeBackend in Tests und --dry-run)
        ▼
Supabase `quellen` (status = 'neu')  ◀── Übersetzer liest direkt
```

- `models.py` Datenmodell, `hashing.py` Identität (SPEC §6), `pdf.py` PDF-Text via pypdf, `api.py` FastAPI, `__main__.py` CLI.
- Idempotent: gleicher Input zweimal → 0 neue Zeilen, kein Doppel-Upload.
- Eine kaputte Zeile/Datei bricht den Import nicht ab, sie landet in `fehler`.

## Annahmen

- Rohdaten sind unveränderlich; `quellen` wird nur eingefügt. Ein später ergänztes Transkript aktualisiert bestehende Zeilen nicht → Tabelle leeren und neu importieren (Belege hängen an `content_hash`, nicht an `id`).
- WhatsApp: Android/DE-Export ist Pflicht, iOS-Format wird mitgelesen. Sprachnachrichten bekommen ihr Transkript nur aus einer Sidecar-Datei `<audio>.txt`; ohne Sidecar bleibt `text` leer.
- Dieselbe WhatsApp-Nachricht einmal live und einmal per Export ergibt zwei Zeilen (unterschiedliche Identität).
- Zwei identische Nachrichten derselben Person in derselben Minute fallen zusammen.
- Keine Auth auf der API: nur lokal oder hinter einem Tunnel betreiben.
- Demo nutzt Exporte; echte WhatsApp-/Gmail-/Drive-APIs wären weitere Adapter mit demselben Ausgabeformat.
