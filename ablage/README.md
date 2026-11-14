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
| `POST /import/whatsapp/twilio` | Twilio-Webhook, Form-encoded (SPEC §7.6) | `MessageSid` |
| `POST /import/email/gmail` | Gmail-Mail als JSON von n8n (SPEC §7.7) | `Message-ID` |
| `POST /import/drive/datei` | Drive-Datei als Rohdaten von n8n (SPEC §7.8) | Pfad + Inhalt |

Antwort jeweils `{"gelesen", "neu", "duplikate", "fehler"}`, nur der Twilio-Endpunkt antwortet mit leerem TwiML. Interaktive Doku: `http://localhost:8000/docs`.

## WhatsApp live über Twilio (Sandbox)

Gebaut nach dem dokumentierten Twilio-Format und in Tests geprüft, aber **noch nicht gegen einen echten Twilio-Account gelaufen**.

1. `.env` ergänzen: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (für Mediendownload und Signaturprüfung), `TWILIO_WEBHOOK_URL` (öffentliche URL aus Schritt 3), optional `WHATSAPP_LIVE_KANAL`. `DEFAULT_PROJEKT` auf einen eigenen Testnamen setzen, z. B. `Test Santino`, damit die Zeilen von „BV Simmering“ getrennt bleiben.
2. API starten: `.venv\Scripts\python -m uvicorn ablage.api:app --port 8000`
3. Tunnel öffnen (z. B. `ngrok http 8000`) und `https://<tunnel>/import/whatsapp/twilio` in der Twilio-Konsole unter Messaging → Try it out → WhatsApp Sandbox → **When a message comes in** eintragen (Methode POST). Dieselbe URL als `TWILIO_WEBHOOK_URL` setzen, uvicorn neu starten.
4. Vom Handy den Join-Code an die Sandbox-Nummer schicken, danach eine Testnachricht.
5. Prüfen: `.venv\Scripts\python -m ablage zeige --projekt "Test Santino"`

Sprachnachrichten kommen als Datei (`<MessageSid>.ogg`) an; `text` ist leer, solange keine Transkription eingerichtet ist (nächster Abschnitt). Schlägt der Mediendownload fehl, bleibt die Nachricht ohne Anhang erhalten, der Grund steht in `meta.anhang_fehler`. Ohne `TWILIO_AUTH_TOKEN` und `TWILIO_WEBHOOK_URL` wird die Signatur nicht geprüft.

## Sprachnachrichten transkribieren

Mit `TRANSKRIPT_API_KEY` in `.env` wird jede neue Sprachnachricht ohne Text vor dem Speichern transkribiert; das Ergebnis steht in `text`, dazu `meta.transkript_quelle = "whisper"` und `meta.transkript_modell`. Das gilt für alle Wege (Twilio, `/import/whatsapp/nachricht`, Gmail-Anhänge, Drive, CLI-Import, bei `--dry-run` nicht). Ohne Schlüssel bleibt alles wie bisher.

```
TRANSKRIPT_API_KEY=<Schlüssel>
TRANSKRIPT_BASE_URL=https://api.openai.com/v1     # Groq: https://api.groq.com/openai/v1
TRANSKRIPT_MODELL=whisper-1                       # Groq: whisper-large-v3
```

Schlägt die Transkription fehl (Netz, Timeout, Fehlerstatus, leere Antwort), wird die Nachricht trotzdem gespeichert, `text` bleibt leer und `meta.transkript_fehler` nennt den Grund. Grenze: Eine schon gespeicherte Sprachnachricht bekommt nachträglich kein Transkript (Upsert mit `ignore_duplicates`); dafür Zeile löschen und neu importieren. Der Hash ändert sich durch das Transkript nicht.

Ehrlicher Stand: in Tests mit nachgebauter Schnittstelle geprüft, noch nicht gegen einen echten Anbieter und eine echte WhatsApp-Sprachnachricht gelaufen. Die Audiodateien in `fake_data/` sind Platzhalter, keine Aufnahmen.

## Gmail und Drive live über n8n

Zwei Endpunkte nehmen echte Eingänge aus Gmail und Google Drive an. Die OAuth-Anmeldung bei Google liegt komplett in n8n (Cloud), die Ablage bekommt nur fertige Daten.

- `POST /import/email/gmail`: JSON `{"raw": "<base64url, Gmail format=raw>", "gmail_id": "...", "projekt": "optional"}`. Läuft durch denselben Parser wie `.eml`-Dateien, dieselbe Mail ergibt keine zweite Zeile.
- `POST /import/drive/datei`: Dateibytes als Body, Query `pfad` (Pflicht), `kanal`, `projekt`, `datei_id`, `geaendert_am`. Das Item sieht aus wie eines aus dem Drive-Ordner-Import.
- Token: `ABLAGE_IMPORT_TOKEN` in `.env` setzen, n8n sendet ihn als Header `X-Ablage-Token`. Ohne Wert keine Prüfung. Gilt nur für diese beiden Endpunkte.
- Einrichtung in n8n: siehe `n8n/README.md`.

In Tests geprüft. Der Drive-Weg ist am 14.11.2026 einmal über eine echte n8n-Cloud-Instanz gelaufen (von Hand ausgelöst), der Gmail-Weg **noch nicht**.

## Eigenen WhatsApp-Chat testen

1. In WhatsApp einen Test-Chat öffnen (am besten eine neue Gruppe nur mit Testnachrichten) → Menü → **Chat exportieren → Medien einschließen**. Die `.zip` auf den Rechner legen.
2. Erst ohne Schreiben prüfen, dann unter eigenem Projektnamen importieren und ansehen:

```powershell
.venv\Scripts\python -m ablage import whatsapp "C:\Pfad\WhatsApp Chat - Testgruppe.zip" --projekt "Test Santino" --dry-run
.venv\Scripts\python -m ablage import whatsapp "C:\Pfad\WhatsApp Chat - Testgruppe.zip" --projekt "Test Santino"
.venv\Scripts\python -m ablage zeige --projekt "Test Santino"
```

Gelesen werden Android- und iPhone-Exporte (`WhatsApp Chat mit ….txt` bzw. `_chat.txt` im Zip), deutsch und englisch. Sprachnachrichten landen als Datei im Bucket; `text` bleibt leer, solange keine Transkription eingerichtet ist (siehe „Sprachnachrichten transkribieren“). Ein eigener Projektname hält die Testzeilen von „BV Simmering“ getrennt. Alles in `quellen` kann vom Übersetzer gelesen und an Claude geschickt werden, deshalb keine privaten Chats importieren.

## Architektur

```
adapters/whatsapp.py  eml.py  ordner.py  call.py  whatsapp_live.py  whatsapp_twilio.py
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
- WhatsApp: Android/DE-Export ist Pflicht, iOS-Format wird mitgelesen. Sprachnachrichten bekommen ihr Transkript aus einer Sidecar-Datei `<audio>.txt` oder, mit `TRANSKRIPT_API_KEY`, per Whisper-Schnittstelle (noch nicht gegen einen echten Anbieter gelaufen); sonst bleibt `text` leer.
- Dieselbe WhatsApp-Nachricht einmal live und einmal per Export ergibt zwei Zeilen (unterschiedliche Identität).
- Zwei identische Nachrichten derselben Person in derselben Minute fallen zusammen.
- Keine Auth auf der API: nur lokal oder hinter einem Tunnel betreiben.
- Demo nutzt Exporte; echte WhatsApp-/Gmail-/Drive-APIs wären weitere Adapter mit demselben Ausgabeformat.
