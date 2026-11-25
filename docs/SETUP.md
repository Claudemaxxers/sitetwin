# Run SiteTwin yourself

Back to the [README](../README.md). This page covers setup, the demo walkthrough and the honest list of what ran for real.

## 1. Prerequisites and environment

- A Supabase project (database and Storage)
- Python 3.11+ and [uv](https://docs.astral.sh/uv/)
- Node.js 24 and npm
- An Anthropic API key

Each part has its own `.env.example` that lists every variable with a comment. Never commit secrets.

| File | Copy to | Required | Optional |
|---|---|---|---|
| `.env.example` | `.env.local` | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | `ANTHROPIC_API_KEY` (without it the "Ask" drawer is a keyword search), `ELEVENLABS_*` and `TELEFON_*` (phone agent), `TELEGRAM_*` (`/v1` only) |
| `ablage/.env.example` | `ablage/.env` | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | `ABLAGE_IMPORT_TOKEN`, `TRANSKRIPT_*` (voice transcription), `TWILIO_*` |
| `uebersetzer/.env.example` | `uebersetzer/.env` | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY` | `UEBERSETZER_MODELL` (default `claude-haiku-5-5`) |
| `ablage/whatsapp-mitleser/.env.example` | `ablage/whatsapp-mitleser/.env` | only for the live WhatsApp reader | |

## 2. Setup and start

Commands are bash. On Windows use `copy` instead of `cp` and `.venv\Scripts\python` instead of `.venv/bin/python`.

### 2.1 Database

In the Supabase SQL editor, run in this order:

1. The `create table quellen` statement from [`ablage/SPEC.md`](../ablage/SPEC.md), section 5
2. `uebersetzer/schema.sql`
3. `uebersetzer/stammdaten_bv_simmering.sql` (master data of the fictional project)

Then create a **private** Storage bucket named `ablage`.

### 2.2 Ablage: import the fictional data

```bash
cd ablage
python3 -m venv .venv && .venv/bin/python -m pip install -e .
cp .env.example .env    # fill in SUPABASE_URL and SUPABASE_SERVICE_KEY
P='--projekt "BV Simmering"'
eval .venv/bin/python -m ablage import whatsapp ../fake_data/whatsapp $P
eval .venv/bin/python -m ablage import email    ../fake_data/email    $P
eval .venv/bin/python -m ablage import ordner   ../fake_data/drive    $P
eval .venv/bin/python -m ablage import call     ../fake_data/calls    $P
eval .venv/bin/python -m ablage import whatsapp ../fake_data/szenarien/wand_top5/whatsapp $P
eval .venv/bin/python -m ablage import call     ../fake_data/szenarien/wand_top5/calls    $P
```

Importing twice is harmless. The API is only needed for live sources: `.venv/bin/python -m uvicorn ablage.api:app --port 8000`.

### 2.3 Übersetzer and Prüf-Agent

```bash
cd uebersetzer
cp .env.example .env    # fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY
uv sync
uv run python -m uebersetzer lauf                                       # translate new sources, then check
uv run python -m uebersetzer lauf --dauerhaft 30 --projekt "BV Simmering"  # loop every 30 s (live demo)
```

Claude is called by default; a full run over the fictional data costs about 4 cents. `--ohne-claude` skips every API call and runs the fixed rules only. `uv run python -m uebersetzer trockenlauf --ohne-claude` is a free dry run over `fake_data/` that writes nothing.

### 2.4 Web app

```bash
npm install
cp .env.example .env.local    # fill in SUPABASE_URL and SUPABASE_SERVICE_KEY
npm run dev                   # http://localhost:3000
```

The card "BV Simmering" opens the project. The two other cards on the home page are static demo cards without data.

### 2.5 Optional parts

- **WhatsApp reader and warnings:** [`ablage/whatsapp-mitleser/README.md`](../ablage/whatsapp-mitleser/README.md)
- **Gmail and Drive via n8n:** [`ablage/n8n/README.md`](../ablage/n8n/README.md)
- **Phone agent:** set the `ELEVENLABS_*` variables, `TELEFON_TESTNUMMER` and `TELEFON_TROCKEN=0` in `.env.local`, point the ElevenLabs post-call webhook to `https://<host>/api/telefon/webhook`, then `npm run telefon` (loop) or `npm run telefon:einmal`.
- **First prototype:** `npm run dev`, open `/v1` and click "Demo".

### 2.6 Tests

| Part | Command |
|---|---|
| Ablage | `cd ablage && .venv/bin/python -m pytest -q` |
| Übersetzer and Prüf-Agent | `cd uebersetzer && uv run pytest` |
| WhatsApp reader | `cd ablage/whatsapp-mitleser && npm install && npm test` |
| Web app, phone agent, `/v1` | `npm test` and `npm run typecheck` |

No test needs Supabase, Claude or a network connection.

## 3. Demo walkthrough

The scenario: the drywall crew announces on Friday that it will close the wall in the storage room of unit "Top 5" on Saturday at 7:00. The valid drawing (index C) moves the distribution board there, and the electricians have not done it yet.

1. Do 2.1 to 2.4.
2. Run `uv run python -m uebersetzer lauf` in `uebersetzer/`. The output lists entries, drawings and signals.
3. Open `http://localhost:3000`, click "BV Simmering" and look at **Notifications** (signals), **Changes** (per unit, with sources), **Inbox**, **Daily log**, **Record** and the **Ask** drawer.
4. Leave `lauf --dauerhaft 30` running and import another message. The web app picks it up within seconds; a message that reports the fix resolves the signal.

## 4. Assumptions and limits

Status as of 14.11.2026. Built beats promised: what is not listed as working should be read as not working.

- **All test data is fictional** (people, company, project, drawings). Photos and voice files are placeholders; the transcripts of the fictional voice messages are hand-written sidecar files.
- **The chain ran end to end live once**, on 14.11.2026 at 14:47, ten minutes before the freeze: a typed WhatsApp message in the test group ("we will board the bedroom wall in Top 3 tomorrow at seven") was stored, structured and checked; the signal row appeared 14 seconds after the message, the warning in the WhatsApp group after 17 seconds, and the phone agent (running on Vercel) started the call to a team member's phone after 23 seconds. The signal was set to resolved 96 seconds after the call started. This is a single run; the times are read from the logs and the database, not averaged. The message was sent from the linked account itself, not by a second participant. A voice note sent just before it arrived without a transcript (no transcription key in the running Ablage) and was recorded as "voice note without transcript".
- **Prüf-Agent:** the fixed rules ran on the test data. The Claude stage is only tested with fake answers.
- **Learning loop:** storing a rating from WhatsApp ran once for real. The Prüf-Agent downgrading a repeated false alarm is tested, not run live. It learns no new rules.
- **Phone agent:** tested against fake ElevenLabs and Supabase responses. The voice agent and its prompt live in the team's ElevenLabs workspace, not in this repository. No escalation to the office if nobody picks up.
- **WhatsApp reader:** uses Baileys, which is not the WhatsApp Business API and is against WhatsApp's terms of use. Prototype only. Ran for real with one account and a test group.
- **Gmail and Drive via n8n:** each ran once for real, triggered by hand, through a temporary tunnel address that changes on restart.
- **Voice transcription:** ran against a real transcription API with a synthetic recording, not yet with a real WhatsApp voice message through the running Ablage.
- **Twilio WhatsApp endpoint:** built and tested, never run against a real Twilio account.
- **Ablage API:** no authentication except the optional token on the n8n endpoints. Run it locally or behind a tunnel.
- **Web app numbers are derived, not measured.** Progress is the share of work stages reported done in messages. Extra costs are estimates; where a message carries no quantity, `lib/demo-preise.ts` supplies hard-coded demo values. The twin is a schematic generated from the unit list, not a scanned model.
- **`/v1`** is separate from the Supabase chain. On Vercel its SQLite log is ephemeral.
