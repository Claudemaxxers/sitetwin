# SiteTwin Ablage

Intake layer of SiteTwin: brings everything that is communicated on the construction site (WhatsApp, e-mail, Drive files, call transcripts) **unchanged** into the Supabase table `quellen` and the bucket `ablage`. The Ablage interprets nothing; that is the Übersetzer's job. Contract and details: [SPEC.md](SPEC.md).

## Setup (Windows, PowerShell, Python 3.11+)

```powershell
cd ablage
py -3 -m venv .venv
.venv\Scripts\python -m pip install -e .
copy .env.example .env   # fill in SUPABASE_URL + SUPABASE_SERVICE_KEY
```

The table `quellen` (SQL in SPEC §5) and the private bucket `ablage` must exist in Supabase.

## Usage

```powershell
# Tests (run without Supabase, fixtures = ../fake_data)
.venv\Scripts\python -m pytest -q

# Import via CLI (--dry-run: parse only, write nothing)
.venv\Scripts\python -m ablage import whatsapp ..\fake_data\whatsapp --projekt "BV Simmering"
.venv\Scripts\python -m ablage import email    ..\fake_data\email    --projekt "BV Simmering"
.venv\Scripts\python -m ablage import ordner   ..\fake_data\drive    --projekt "BV Simmering"
.venv\Scripts\python -m ablage import call     ..\fake_data\calls    --projekt "BV Simmering"

# Additionally load the scenario "Wand Top 5" (core example from KONZEPT.md)
.venv\Scripts\python -m ablage import whatsapp ..\fake_data\szenarien\wand_top5\whatsapp --projekt "BV Simmering"
.venv\Scripts\python -m ablage import call     ..\fake_data\szenarien\wand_top5\calls    --projekt "BV Simmering"

# Show the most recently imported rows
.venv\Scripts\python -m ablage zeige --projekt "BV Simmering" --limit 10

# Check data quality of quellen + bucket (read-only, 22 checks, comparison with ..\fake_data)
.venv\Scripts\python -m ablage audit --projekt "BV Simmering"

# API
.venv\Scripts\python -m uvicorn ablage.api:app --port 8000
curl.exe -X POST localhost:8000/import/call -H "Content-Type: application/json" --data-binary "@..\fake_data\calls\call_2026-11-13_1610_huber.json"
```

| Endpoint | Body | Identity |
|---|---|---|
| `GET /health` | – | – |
| `POST /import/call` | Call JSON v1 (SPEC §7.4) | `call_id` |
| `POST /import/whatsapp/nachricht` | one live message (SPEC §7.5) | `wa_id` |
| `POST /import/whatsapp/twilio` | Twilio webhook, form-encoded (SPEC §7.6) | `MessageSid` |
| `POST /import/email/gmail` | Gmail raw mail as JSON from n8n (SPEC §7.7) | `Message-ID` |
| `POST /import/email/gmail-felder` | Gmail mail split up (fields + attachments) as JSON from n8n (SPEC §7.10) | same as `.eml` |
| `POST /import/drive/datei` | Drive file as raw data from n8n (SPEC §7.8) | path + content |

The response is always `{"gelesen", "neu", "duplikate", "fehler"}`, only the Twilio endpoint replies with empty TwiML. Interactive docs: `http://localhost:8000/docs`.

## WhatsApp live via Twilio (sandbox)

Built to the documented Twilio format and checked in tests, but **not yet run against a real Twilio account**.

1. Add to `.env`: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (for media download and signature check), `TWILIO_WEBHOOK_URL` (public URL from step 3), optionally `WHATSAPP_LIVE_KANAL`. Set `DEFAULT_PROJEKT` to a test name of your own, e.g. `Test Santino`, so that the rows stay separate from "BV Simmering".
2. Start the API: `.venv\Scripts\python -m uvicorn ablage.api:app --port 8000`
3. Open a tunnel (e.g. `ngrok http 8000`) and enter `https://<tunnel>/import/whatsapp/twilio` in the Twilio console under Messaging → Try it out → WhatsApp Sandbox → **When a message comes in** (method POST). Set the same URL as `TWILIO_WEBHOOK_URL`, restart uvicorn.
4. Send the join code from the phone to the sandbox number, then a test message.
5. Check: `.venv\Scripts\python -m ablage zeige --projekt "Test Santino"`

Voice messages arrive as a file (`<MessageSid>.ogg`); `text` is empty as long as no transcription is set up (next section). If the media download fails, the message is kept without attachment, the reason is in `meta.anhang_fehler`. Without `TWILIO_AUTH_TOKEN` and `TWILIO_WEBHOOK_URL` the signature is not checked.

## Transcribing voice messages

With `TRANSKRIPT_API_KEY` in `.env`, every new voice message without text is transcribed before it is stored; the result is in `text`, plus `meta.transkript_quelle = "whisper"` and `meta.transkript_modell`. This applies to all paths (Twilio, `/import/whatsapp/nachricht`, Gmail attachments, Drive, CLI import, not with `--dry-run`). Without a key everything stays as before.

```
TRANSKRIPT_API_KEY=<Schlüssel>
TRANSKRIPT_BASE_URL=https://api.openai.com/v1     # Groq: https://api.groq.com/openai/v1
TRANSKRIPT_MODELL=whisper-1                       # Groq: whisper-large-v3
```

Silence is detected: if the provider reports "no speech" for all segments (`no_speech_prob >= 0.5`), `text` stays empty and `meta.transkript_fehler` reads `KeineSprache: keine Sprache erkannt`. Without that, Whisper invents text such as "Vielen Dank." on silence. Noise without speech is not detected this way.

If the transcription fails (network, timeout, error status, empty response), the message is stored anyway, `text` stays empty and `meta.transkript_fehler` gives the reason. Limit: a voice message that is already stored does not get a transcript afterwards (upsert with `ignore_duplicates`); for that, delete the row and re-import. The hash does not change because of the transcript.

Honest status: checked in tests with a mocked interface, and additionally against Groq (`whisper-large-v3`) on 14 Nov 2026 by calling the transcriber directly: a synthetically spoken German sentence (Opus and M4A) came back word for word, silence was discarded. Not yet run: a real WhatsApp voice message through the running Ablage. The audio files in `fake_data/` are placeholders, not recordings.

## Gmail and Drive live via n8n

Three endpoints accept real input from Gmail and Google Drive. The OAuth sign-in with Google lives entirely in n8n (Cloud), the Ablage only receives finished data.

- `POST /import/email/gmail-felder` (this is the one the Gmail workflow in `n8n/` uses): JSON `{"projekt": "optional", "mail": <$json of the Gmail Trigger, Simplify off>, "anhaenge": [{"name", "mime", "base64"}]}`. Needs no raw mail, because n8n Cloud blocks the raw fetch with its Google sign-in. The Ablage builds the same rows and hashes from it as with the `.eml` import; exceptions regarding the body are in `n8n/README.md` under "Limits".
- `POST /import/email/gmail`: JSON `{"raw": "<base64url, Gmail format=raw>", "gmail_id": "...", "projekt": "optional"}`. Runs through the same parser as `.eml` files, the same mail does not produce a second row. Stays for the case that a custom Google OAuth app delivers the raw mail.
- `POST /import/drive/datei`: file bytes as body, query `pfad` (required), `kanal`, `projekt`, `datei_id`, `geaendert_am`. The item looks like one from the Drive folder import.
- Token: set `ABLAGE_IMPORT_TOKEN` in `.env`, n8n sends it as the header `X-Ablage-Token`. Without a value no check. Applies only to these three endpoints.
- Setup in n8n: see `n8n/README.md`.

Checked in tests (for `gmail-felder` with n8n items rebuilt from the six `.eml` files in `fake_data/email/`). The Drive path ran once on 14 Nov 2026 through a real n8n Cloud instance (triggered by hand), the Gmail path via `gmail-felder` likewise once (triggered by hand, test mail without attachment, `neu: 1`). Attachments, duplicate run and continuous operation are unchecked there. The raw path `gmail` fails on n8n Cloud because of the block on the Google sign-in.

## Reading along in WhatsApp (unofficial, prototype only)

`whatsapp-mitleser/` is a standalone Node service (Baileys) that reads along in your own WhatsApp as a linked device and sends new messages from selected chats to `POST /import/whatsapp/nachricht`. Read-only, allowlist, without chats in `WHATSAPP_CHATS` nothing goes out. Unofficial and against WhatsApp's terms of service; risk of the number being banned. The official path remains Twilio. Setup and limits: [whatsapp-mitleser/README.md](whatsapp-mitleser/README.md).

## Testing your own WhatsApp chat

1. Open a test chat in WhatsApp (ideally a new group with test messages only) → menu → **Chat exportieren → Medien einschließen** (export chat, include media). Put the `.zip` on the computer.
2. First check without writing, then import under a project name of your own and look at it:

```powershell
.venv\Scripts\python -m ablage import whatsapp "C:\Pfad\WhatsApp Chat - Testgruppe.zip" --projekt "Test Santino" --dry-run
.venv\Scripts\python -m ablage import whatsapp "C:\Pfad\WhatsApp Chat - Testgruppe.zip" --projekt "Test Santino"
.venv\Scripts\python -m ablage zeige --projekt "Test Santino"
```

Android and iPhone exports are read (`WhatsApp Chat mit ….txt` or `_chat.txt` in the zip), German and English. Voice messages land as a file in the bucket; `text` stays empty as long as no transcription is set up (see "Transcribing voice messages"). A project name of your own keeps the test rows separate from "BV Simmering". Everything in `quellen` can be read by the Übersetzer and sent to Claude, so do not import private chats.

## Architecture

```
adapters/whatsapp.py  eml.py  ordner.py  call.py  whatsapp_live.py  whatsapp_twilio.py
        │  reine Funktionen: parse(path, ctx) -> RawItem | ParseFehler
        ▼
store.py   Upload in den Bucket + Insert mit content_hash (Backend per Dependency Injection:
        │  SupabaseBackend in Produktion, FakeBackend in Tests und --dry-run)
        ▼
Supabase `quellen` (status = 'neu')  ◀── Übersetzer liest direkt
```

- `models.py` data model, `hashing.py` identity (SPEC §6), `pdf.py` PDF text via pypdf, `api.py` FastAPI, `__main__.py` CLI.
- Idempotent: same input twice → 0 new rows, no double upload.
- A broken row/file does not abort the import, it lands in `fehler`.

## Assumptions

- Raw data is immutable; `quellen` is insert-only. A transcript added later does not update existing rows → empty the table and re-import (evidence hangs on `content_hash`, not on `id`).
- WhatsApp: the Android/DE export is mandatory, the iOS format is read as well. Voice messages get their transcript from a sidecar file `<audio>.txt` or, with `TRANSKRIPT_API_KEY`, via the Whisper interface (run once directly against Groq, not yet with a real WhatsApp voice message); otherwise `text` stays empty.
- The same WhatsApp message once live and once via export produces two rows (different identity).
- Two identical messages from the same person in the same minute collapse into one.
- No auth on the API: operate only locally or behind a tunnel.
- The demo uses exports; real WhatsApp/Gmail/Drive APIs would be further adapters with the same output format.
