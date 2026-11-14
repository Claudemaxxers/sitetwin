# SiteTwin

> Building Better Worlds Hackathon, Talona Track 01 *Context for the Physical World*

**Live demo:** [sitetwin-hendriks-projects-491d3237.vercel.app](https://sitetwin-hendriks-projects-491d3237.vercel.app) (fictional test data)

Construction runs on group chats, email threads and shared folders. One crew closes a wall before the electricians have run their pipes, another builds from last week's drawing. **SiteTwin** plugs into what the site already uses (WhatsApp, mail, photos, drawings, a Drive folder), keeps every message unchanged as raw data, turns it into structured records, checks each new record against the valid drawing, and raises a **signal** while somebody can still act. The foreman gets the warning in the WhatsApp group or by phone, the office sees the live state of each project in a web app. Nobody on site has to change how they work.

## 1. Idea and design decisions

- **Dock on, do not replace.** Crews keep writing in WhatsApp and mail. The system reads along.
- **Raw data stays untouched.** The ingest layer parses and never interprets. Every structured entry and every signal points back to its source, so a person can check the claim.
- **Structure first, then check.** Claude turns a message into entries (what, where, who, when, which drawing, who decided, what waits on whom). Fixed rules then check the entries for free; a Claude stage looks for what the rules miss.
- **Warn while it still helps.** A signal goes to the person responsible, in the channel they already use.
- **People decide, the system learns.** The foreman rates a warning as justified or false alarm; the checking agent reads the ratings.

| Talona brief | Where it lives here |
|---|---|
| Catch it before the rework | Prüf-Agent (checking agent), table `signale` |
| Live picture of the place | Web app per project: changes, inbox, daily log, record, alerts |
| Dock onto what the site already uses | Ablage (ingest layer): WhatsApp, mail, Drive folder, call transcripts |
| Live log: what changed, who decided, what waits on whom | Table `eintraege`, view `eintraege_mit_quelle`, table `signal_verlauf` |
| Crews ask, decisions go to the foreman | "Ask" drawer, warning in the WhatsApp group, phone agent |

**Language note.** The domain is a German-speaking building site, so folder, table and command names are German: `ablage` = ingest, `quellen` = sources (raw data), `Übersetzer` = translator (structuring), `Prüf-Agent` = checking agent, `eintraege` = entries, `signale` = signals, `plaene` = drawings. Prompts, test data and the texts sent to the crew are German on purpose. The fictional project is "BV Simmering".

## 2. Architecture

```
 WhatsApp (export / live)    .eml / Gmail (n8n)    Drive folder (n8n)    call JSON
             \                      |                     |                /
              v                     v                     v               v
        +------------------------------------------------------------------+
        | Ablage (ablage/, Python, FastAPI + CLI): parses, never interprets|
        +--------------------------------+---------------------------------+
                                         v  insert only
        +------------------------------------------------------------------+
        | Supabase: table `quellen` (raw data) + private bucket `ablage`   |
        +--------------------------------+---------------------------------+
                                         v  reads status='neu'
        +------------------------------------------------------------------+
        | Übersetzer (uebersetzer/, Python, Claude with structured output) |
        | -> `eintraege`, `plaene`, `elemente` (component register)        |
        +--------------------------------+---------------------------------+
                                         v
        +------------------------------------------------------------------+
        | Prüf-Agent (uebersetzer/uebersetzer/pruefung.py)                 |
        | fixed rules + Claude check -> `signale`                          |
        +-----------+-------------------------+----------------------+-----+
                    v                         v                      v
          WhatsApp warning             Phone agent              Web app
          (whatsapp-mitleser/)         (lib/telefon/)           (app/, components/, lib/)
```

| Part | Where | What it does |
|---|---|---|
| **Ablage** | `ablage/` | Reads WhatsApp exports, `.eml` files, a Drive-style folder, call transcripts and live inputs. One row per message in `quellen`, files in the bucket. Duplicates are detected by `content_hash`. Voice messages are transcribed on import if a key is set. |
| **WhatsApp reader** | `ablage/whatsapp-mitleser/` | Node service (Baileys) that reads allowed chats as a linked device and forwards them to Ablage. Optionally posts a warning per new signal and stores the rating of it. |
| **Übersetzer** | `uebersetzer/` | Reads new `quellen` rows with the recent timeline, the valid drawings and the master data, and asks Claude for structured entries. Idempotent. |
| **Prüf-Agent** | `uebersetzer/uebersetzer/pruefung.py` | Checks entries against the valid drawing: work from an outdated drawing index, wall closed before installation is done, work on a dropped component, unclear message. Signal lifecycle `offen` → `in_bearbeitung` → `geloest`, logged in `signal_verlauf`. |
| **Phone agent** | `lib/telefon/`, `app/api/telefon/` | Calls the responsible person for an open signal (ElevenLabs + Twilio). The transcript returns through Ablage like any other source. |
| **Web app** | `app/`, `components/app/`, `lib/` | Next.js, reads Supabase server-side, polls every 6 s, writes nothing back. "Ask" drawer answers only from the record. |
| **First prototype** | `/v1` (`app/v1/`, `lib/pipeline.ts`, …) | Earlier self-contained version with its own SQLite log, rule engine and 3D model. Not connected to the Supabase chain. |

`quellen` is the interface between Ablage and Übersetzer (contract: [`ablage/SPEC.md`](ablage/SPEC.md), sections 5 and 6). Schema of everything else: [`uebersetzer/schema.sql`](uebersetzer/schema.sql).

## 3. Prerequisites and environment

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

## 4. Setup and start

Commands are bash. On Windows use `copy` instead of `cp` and `.venv\Scripts\python` instead of `.venv/bin/python`.

### 4.1 Database

In the Supabase SQL editor, run in this order:

1. The `create table quellen` statement from [`ablage/SPEC.md`](ablage/SPEC.md), section 5
2. `uebersetzer/schema.sql`
3. `uebersetzer/stammdaten_bv_simmering.sql` (master data of the fictional project)

Then create a **private** Storage bucket named `ablage`.

### 4.2 Ablage: import the fictional data

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

### 4.3 Übersetzer and Prüf-Agent

```bash
cd uebersetzer
cp .env.example .env    # fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY
uv sync
uv run python -m uebersetzer lauf                                       # translate new sources, then check
uv run python -m uebersetzer lauf --dauerhaft 30 --projekt "BV Simmering"  # loop every 30 s (live demo)
```

Claude is called by default; a full run over the fictional data costs about 4 cents. `--ohne-claude` skips every API call and runs the fixed rules only. `uv run python -m uebersetzer trockenlauf --ohne-claude` is a free dry run over `fake_data/` that writes nothing.

### 4.4 Web app

```bash
npm install
cp .env.example .env.local    # fill in SUPABASE_URL and SUPABASE_SERVICE_KEY
npm run dev                   # http://localhost:3000
```

The card "BV Simmering" opens the project. The two other cards on the home page are static demo cards without data.

### 4.5 Optional parts

- **WhatsApp reader and warnings:** [`ablage/whatsapp-mitleser/README.md`](ablage/whatsapp-mitleser/README.md)
- **Gmail and Drive via n8n:** [`ablage/n8n/README.md`](ablage/n8n/README.md)
- **Phone agent:** set the `ELEVENLABS_*` variables, `TELEFON_TESTNUMMER` and `TELEFON_TROCKEN=0` in `.env.local`, point the ElevenLabs post-call webhook to `https://<host>/api/telefon/webhook`, then `npm run telefon` (loop) or `npm run telefon:einmal`.
- **First prototype:** `npm run dev`, open `/v1` and click "Demo".

### 4.6 Tests

| Part | Command |
|---|---|
| Ablage | `cd ablage && .venv/bin/python -m pytest -q` |
| Übersetzer and Prüf-Agent | `cd uebersetzer && uv run pytest` |
| WhatsApp reader | `cd ablage/whatsapp-mitleser && npm install && npm test` |
| Web app, phone agent, `/v1` | `npm test` and `npm run typecheck` |

No test needs Supabase, Claude or a network connection.

## 5. Demo walkthrough

The scenario: the drywall crew announces on Friday that it will close the wall in the storage room of unit "Top 5" on Saturday at 7:00. The valid drawing (index C) moves the distribution board there, and the electricians have not done it yet.

1. Do 4.1 to 4.4.
2. Run `uv run python -m uebersetzer lauf` in `uebersetzer/`. The output lists entries, drawings and signals.
3. Open `http://localhost:3000`, click "BV Simmering" and look at **Notifications** (signals), **Changes** (per unit, with sources), **Inbox**, **Daily log**, **Record** and the **Ask** drawer.
4. Leave `lauf --dauerhaft 30` running and import another message. The web app picks it up within seconds; a message that reports the fix resolves the signal.

## 6. Assumptions and limits

Status as of 14.11.2026. Built beats promised: what is not listed as working should be read as not working.

- **All test data is fictional** (people, company, project, drawings). Photos and voice files are placeholders; the transcripts of the fictional voice messages are hand-written sidecar files.
- **The chain ran end to end live once**, on 14.11.2026 at 14:47, ten minutes before the freeze: a typed WhatsApp message in the test group ("we will board the bedroom wall in Top 3 tomorrow at seven") was stored, structured and checked; the signal row appeared 14 seconds after the message, the warning in the WhatsApp group after 17 seconds, and the phone agent (running on Vercel) started the call to a team member's phone after 23 seconds. The signal was set to resolved 96 seconds after the call started. This is a single run; the times are read from the logs and the database, not averaged. The message was sent from the linked account itself, not by a second participant. A voice note sent just before it arrived without a transcript (no transcription key in the running Ablage) and was recorded as "voice note without transcript".
- **Prüf-Agent:** the fixed rules ran on the test data. The Claude stage is only tested with fake answers.
- **Learning loop:** storing a rating from WhatsApp ran once for real. The Prüf-Agent downgrading a repeated false alarm is tested, not run live. It learns no new rules.
- **Phone agent:** tested against fake ElevenLabs and Supabase responses. The voice agent and its prompt live in the team's ElevenLabs workspace, not in this repository. It is not configured on the Vercel deployment. No escalation to the office if nobody picks up.
- **WhatsApp reader:** uses Baileys, which is not the WhatsApp Business API and is against WhatsApp's terms of use. Prototype only. Ran for real with one account and a test group.
- **Gmail and Drive via n8n:** each ran once for real, triggered by hand, through a temporary tunnel address that changes on restart.
- **Voice transcription:** ran against a real transcription API with a synthetic recording, not yet with a real WhatsApp voice message through the running Ablage.
- **Twilio WhatsApp endpoint:** built and tested, never run against a real Twilio account.
- **Ablage API:** no authentication except the optional token on the n8n endpoints. Run it locally or behind a tunnel.
- **Web app numbers are derived, not measured.** Progress is the share of work stages reported done in messages. Extra costs are estimates; where a message carries no quantity, `lib/demo-preise.ts` supplies hard-coded demo values. The twin is a schematic generated from the unit list, not a scanned model.
- **`/v1`** is separate from the Supabase chain. On Vercel its SQLite log is ephemeral.

## 7. Repo layout

```
ablage/        ingest layer (Python), n8n flows, WhatsApp reader (Node)
uebersetzer/   Übersetzer and Prüf-Agent (Python), schema.sql
fake_data/     fictional test data and scenarios
app/           Next.js routes and API
components/    web app UI (components/app/) and /v1 UI
lib/           Supabase access, view model, phone agent, /v1 pipeline
scripts/       phone agent loop, /v1 terminal demo
tests/         Vitest tests
```

Further docs: [`KONZEPT.md`](KONZEPT.md) (core idea, German), [`ablage/README.md`](ablage/README.md), [`ablage/SPEC.md`](ablage/SPEC.md), [`uebersetzer/README.md`](uebersetzer/README.md), [`TALONA.md`](TALONA.md).

## 8. License

Talona track of the Building Better Worlds Hackathon: all work in this repository belongs to Talona. The repository is private and not published under an open-source license.
