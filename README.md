# SiteTwin

> Building Better Worlds Hackathon, Talona Track 01 *Context for the Physical World*

**Live demo:** [sitetwin-hendriks-projects-491d3237.vercel.app](https://sitetwin-hendriks-projects-491d3237.vercel.app) (fictional test data)

Construction runs on group chats, email threads and shared folders. One crew closes a wall before the electricians have run their pipes, another builds from last week's drawing. **SiteTwin** plugs into what the site already uses (WhatsApp, mail, photos, drawings, a Drive folder), keeps every message unchanged as raw data, turns it into structured records (what, where, who, when, which drawing, who decided, what is waiting on whom), checks each new record against the valid drawing, and raises a **signal** while somebody can still act, before rework happens. A phone agent calls the foreman responsible for an open signal. The office sees the live state of each project in a web app (the "digital twin"). Nobody on site has to change how they work.

How this maps to the Talona brief:

| Talona brief | Where it lives here |
|---|---|
| Catch it before the rework: missed change, work out of sequence, outdated drawing | Prüf-Agent (checking agent) in `uebersetzer/`, signals in the table `signale` |
| Live picture of the place | Web app: changes, inbox, daily log, record, alerts per project (`app/`, `components/app/`) |
| Dock onto what the site already uses | Ablage (ingest layer) in `ablage/`: WhatsApp (export, linked-device reader or Twilio), `.eml`/Gmail, Drive folder, call transcripts |
| Live log: what changed, who decided, what waits on whom | Table `eintraege` (columns for decision and "waits on"), view `eintraege_mit_quelle`, table `signal_verlauf` |
| Crews ask, decisions go to the foreman | "Ask" drawer in the web app (answers only from the record); phone agent calls the foreman for each open signal (`lib/telefon/`); signal lifecycle in `KONZEPT.md` |

**Language note.** The domain is a German-speaking building site. Folder and table names are German and stay as they are: `ablage` = filing / ingest, `quellen` = sources (raw data), `Übersetzer` = translator (structuring), `Prüf-Agent` = checking agent, `eintraege` = structured entries, `signale` = signals (flags), `plaene` = drawings, `Vorarbeiter` = foreman, `Bauleitung` = site management. The fictional project is "BV Simmering".

All test data is **fictional** (see [Assumptions and limits](#8-assumptions-and-limits)).

## Contents

1. [Architecture](#1-architecture)
2. [Prerequisites and environment](#2-prerequisites-and-environment)
3. [Setup and start](#3-setup-and-start)
4. [Tests](#4-tests)
5. [Demo walkthrough](#5-demo-walkthrough)
6. [Live sources (optional)](#6-live-sources-optional)
7. [First prototype (/v1)](#7-first-prototype-v1)
8. [Assumptions and limits](#8-assumptions-and-limits)
9. [Repo layout and sub-docs](#9-repo-layout-and-sub-docs)
10. [License](#10-license)

## 1. Architecture

```
 WhatsApp export / live      .eml / Gmail (n8n)    Drive folder (n8n)    call JSON
            \                       |                     |                 /
             v                      v                     v                v
        +--------------------------------------------------------------------+
        | Ablage (ablage/, Python + FastAPI + CLI)                           |
        | parses, never interprets; photos/voice/PDF go to the bucket        |
        +-----------------------------+--------------------------------------+
                                      | writes (insert only)
                                      v
        +--------------------------------------------------------------------+
        | Supabase: table `quellen` (raw data) + private bucket `ablage`     |   <-- interface Ablage / Übersetzer
        +-----------------------------+--------------------------------------+
                                      | reads status='neu' (+ project timeline)
                                      v
        +--------------------------------------------------------------------+
        | Übersetzer (uebersetzer/, Python, Claude with structured output)   |
        | -> `eintraege`, `plaene`, `elemente` (component register)          |
        +-----------------------------+--------------------------------------+
                                      v
        +--------------------------------------------------------------------+
        | Prüf-Agent (uebersetzer/uebersetzer/pruefung.py)                   |
        | fixed rules (free) + optional Claude check -> `signale`            |
        +----------------+---------------------------------+-----------------+
                         | signal (flag)                   | reads everything
                         v                                 v
        +-------------------------------+   +-----------------------------------+
        | Telefon-Agent (phone agent)   |   | Web app / digital twin            |
        | ElevenLabs + Twilio           |   | (Next.js: app/, components/, lib/)|
        | (lib/telefon/, app/api/telefon)|  |                                   |
        +-------------------------------+   +-----------------------------------+
```

**Ablage** (`ablage/`, owner: Santino). Ingest layer. Reads WhatsApp chat exports (`.zip`/`.txt`, Android and iPhone, German and English), `.eml` files, a Drive-style folder, call-transcript JSON, and live inputs (WhatsApp through a linked-device reader or the Twilio webhook, Gmail and Drive via n8n). Stores everything unchanged: one row per message/mail/file/call in `quellen`, files in the private bucket `ablage`. Duplicates are detected by `content_hash`, so importing twice yields 0 new rows. Voice messages are transcribed on import if a transcription key is set, PDFs get their text via `pypdf`. Interface: FastAPI (`ablage/ablage/api.py`) and the CLI `python -m ablage`.

**`quellen` is the interface** between Ablage and Übersetzer. Ablage only inserts; the Übersetzer reads it directly with the service key and writes back only `status` and `meta.fehler`. Evidence elsewhere refers to `quellen.content_hash`, never to `id`, so `quellen` can be emptied and re-imported. Contract: [`ablage/SPEC.md`](ablage/SPEC.md) sections 5 and 6.

**Übersetzer** (`uebersetzer/`, owner: Hendrik). Reads new rows of `quellen` one by one (with the last 40 sources as timeline, the valid drawings and the master data) and asks Claude for structured entries: what, where (unit "Top", room, component), who, when, which drawing index, who decided, what waits on whom. Writes `eintraege`, new drawing indices in `plaene`, and the component register `elemente` (planned state read from drawings). Idempotent: re-processing a source replaces its entries. Schema: [`uebersetzer/schema.sql`](uebersetzer/schema.sql).

**Prüf-Agent** (`uebersetzer/uebersetzer/pruefung.py`, owner: Hendrik). Checks each new entry against the valid drawing and creates **signals** in `signale` while someone can still act: work after an outdated drawing index, wall closed (or announced) before installation is done, work on a component the valid drawing no longer contains, unclear message. A second stage can ask Claude to check further. The signal lifecycle is `offen` (open) -> `in_bearbeitung` (in progress) -> `geloest` (resolved); every change is logged in `signal_verlauf`. Details: [`uebersetzer/README.md`](uebersetzer/README.md).

**Telefon-Agent** (phone agent, `lib/telefon/`, `app/api/telefon/`, `scripts/telefon.mts`; owner: Melih). Step 5 of `KONZEPT.md`: when the Prüf-Agent creates a signal (`signale.status = offen`), SiteTwin calls the responsible person, names the conflict and asks to pause the affected work until it is clarified. The voice agent runs at ElevenLabs with a Twilio number; this app selects the signals, places the call and handles the way back.

```
signale (offen, angerufen_am null) ─► POST /api/telefon/anrufen ─► ElevenLabs outbound call (Twilio)
       status = in_bearbeitung, anruf_id, angerufen_am, telefon          │
                                                                         ▼ conversation
ElevenLabs post-call webhook ─► POST /api/telefon/webhook ─► Ablage POST /import/call ─► Übersetzer ─► Prüf-Agent
```

- **Selection:** `status = offen` and `angerufen_am is null`. The number comes from `signale.telefon`, otherwise from `personen` (name or alias of `zustaendig`), normalised to E.164.
- **Call:** `POST /v1/convai/twilio/outbound-call` with `dynamic_variables` (`anruf_modus`, `zustaendig_name`, `signal_id`, `signal_filter`, `signal_titel`, `anruf_text`, `signal_begruendung`, `signal_ort`, `projekt_name`). The agent reads place and conflict from them; it writes its decision and note itself through its tool `signal_abschliessen` (`status`, `bewertung_notiz`) into Supabase.
- **Way back:** the transcript goes through the post-call webhook to Ablage (`/import/call`, call contract v1, `ablage/SPEC.md` section 7.4) and runs through Übersetzer and Prüf-Agent like any other source. Not reached (`call_initiation_failure`): the signal goes back to `offen` and is tried again after `TELEFON_WARTEZEIT_MIN`, at most `TELEFON_MAX_VERSUCHE` times (counted in `signal_verlauf`).
- **Safeguards:** `TELEFON_TROCKEN=1` only selects and does not call. `TELEFON_TESTNUMMER` redirects all calls to one number (always set it for demo and tests, the test data holds placeholder numbers). `TELEFON_TOKEN` protects the call endpoint, `ELEVENLABS_WEBHOOK_SECRET` checks the webhook signature.

As a text channel next to the call, the WhatsApp reader can post the warning into the group chat (section 6). The calls in `fake_data/` are fictional transcripts.

**Web app / digital twin** (`app/`, `components/`, `lib/`; owner: Max, built on Melih's first prototype). Next.js app that reads the Supabase tables server-side (`lib/sb.ts`, service key stays on the server) and polls every 6 seconds. `/` lists projects, `/projekt/<projekt>` opens one project with the views Changes, Inbox, Daily log (Bautagebuch), Record (Protokoll) and Notifications (alerts and the rules behind them). An "Ask" drawer answers questions only from the record (`POST /api/fragen`). The web app is read-only with respect to Supabase: it writes nothing back.

## 2. Prerequisites and environment

Required tools:

| Tool | For |
|---|---|
| A Supabase project (database + Storage) | `quellen`, `eintraege`, `signale`, bucket `ablage` |
| Python 3.11 or newer | `ablage/`, `uebersetzer/` |
| [uv](https://docs.astral.sh/uv/) (optional for `uebersetzer/`, a `pip` alternative is given) | `uebersetzer/` |
| Node.js 24 and npm | web app and first prototype (`node:sqlite` is used). On Node 22.15 the web app, `/v1` and `npm test` also ran, but `npm run demo` fails there because that Node version cannot run a `.mts` file directly |
| An Anthropic API key | Übersetzer (needed to create structured entries), optional elsewhere |

Never commit secrets. Credentials come only from the `.env` files below.

### Root: `.env.local` (web app and first prototype)

`cp .env.example .env.local` (PowerShell: `copy .env.example .env.local`). Read by Next.js.

| Variable | Required | Without it |
|---|---|---|
| `SUPABASE_URL` | for the digital twin | `/projekt/<id>` returns 404, the project list shows only the two demo cards |
| `SUPABASE_SERVICE_KEY` | for the digital twin | same. Server only, never expose as `NEXT_PUBLIC_` |
| `ABLAGE_BUCKET` | optional, default `ablage` | default is used; serves photos and PDFs through `/api/anhang` |
| `ANTHROPIC_API_KEY` | optional | `/v1` uses a rule-based extractor; the "Ask" drawer falls back to keyword search over the record |
| `ANTHROPIC_AUTH_TOKEN` | optional alternative to the key | same as above |
| `SITETWIN_MODEL` | optional, default `claude-sonnet-5-5` | model for `/v1` extraction |
| `SITETWIN_ASK_MODEL` | optional, default `claude-opus-5-5` | model for the "Ask" drawer |
| `TELEGRAM_BOT_TOKEN` | optional, `/v1` only | no Telegram messages |
| `TELEGRAM_SUPER_CHAT_ID` | optional, `/v1` only | no alerts to Telegram |
| `TELEGRAM_WEBHOOK_SECRET` | optional, `/v1` only | webhook accepts any caller |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_PHONE_NUMBER_ID` | phone agent only | no calls; `GET /api/telefon/anrufen` reports `konfiguriert: false` |
| `ELEVENLABS_WEBHOOK_SECRET` | optional, phone agent | webhook signature is not checked |
| `TELEFON_TESTNUMMER` | set it for demo and tests | calls go to the numbers in `personen` (placeholders in the test data) |
| `TELEFON_TROCKEN` | optional, `.env.example` ships `1` | `1` = select and log, do not call; `0` = real calls |
| `TELEFON_TOKEN` | optional | `POST /api/telefon/anrufen` is not protected; if set, it requires the header `X-Telefon-Token` |
| `ABLAGE_URL`, `ABLAGE_IMPORT_TOKEN` | optional, phone agent | call transcripts are not forwarded to Ablage |
| `DEFAULT_PROJEKT`, `TELEFON_LAENDERVORWAHL`, `TELEFON_MAX_VERSUCHE`, `TELEFON_WARTEZEIT_MIN` | optional | defaults `BV Simmering`, `+43`, `3`, `10` |

### `ablage/.env` (Ablage)

`copy ablage\.env.example ablage\.env`. Read by `ablage/ablage/config.py`.

| Variable | Required | Without it |
|---|---|---|
| `SUPABASE_URL` | yes (except `--dry-run` and tests) | import cannot write |
| `SUPABASE_SERVICE_KEY` | yes (except `--dry-run` and tests) | same |
| `ABLAGE_BUCKET` | optional, default `ablage` | default is used |
| `DEFAULT_PROJEKT` | optional, default `BV Simmering` | used when an import gives no project |
| `TZ` | optional, default `Europe/Vienna` | default is used |
| `WHATSAPP_LIVE_KANAL` | optional | live WhatsApp rows get no channel name |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | optional, Twilio only | no media download, no signature check |
| `TWILIO_WEBHOOK_URL` | optional, Twilio only | no signature check |
| `ABLAGE_IMPORT_TOKEN` | optional | `/import/email/gmail`, `/import/email/gmail-felder` and `/import/drive/datei` are not protected; if set, they require the header `X-Ablage-Token` |
| `TRANSKRIPT_API_KEY` | optional | voice messages are stored without transcript (unless a sidecar `<audio>.txt` exists) |
| `TRANSKRIPT_BASE_URL` | optional, default `https://api.openai.com/v1` | default |
| `TRANSKRIPT_MODELL` | optional, default `whisper-1` | default |

### `uebersetzer/.env` (Übersetzer and Prüf-Agent)

`copy uebersetzer\.env.example uebersetzer\.env`. Read by `uebersetzer/uebersetzer/konfig.py` and the Anthropic SDK.

| Variable | Required | Without it |
|---|---|---|
| `SUPABASE_URL` | yes for `lauf` and `pruefen` | command exits with a message. Not needed for `trockenlauf` and the tests. `.env.example` ships a placeholder; replace it with your project URL |
| `SUPABASE_SERVICE_KEY` | yes for `lauf` and `pruefen` | same |
| `ABLAGE_BUCKET` | optional, default `ablage` | default |
| `DEFAULT_PROJEKT` | optional, default `BV Simmering` | used by `trockenlauf` |
| `ANTHROPIC_API_KEY` | yes for anything with `--mit-claude` | no structured entries are created; without Claude only the free rule stage of the Prüf-Agent runs. **Read by the Anthropic SDK, listed in `.env.example`** |
| `UEBERSETZER_MODELL` | optional, default `claude-haiku-5-5` | default |
| `UEBERSETZER_EFFORT` | optional, default `medium` | default |
| `UEBERSETZER_KONTEXT` | optional, default `40` | number of earlier sources sent as timeline |

**Cost guard.** Every Übersetzer command that calls Claude requires the flag `--mit-claude`; without it nothing calls the API (the code and `.env.example` mark this as `HACKATHON-KOSTENSPERRE`). The Übersetzer README states about 4 cents for one full run over the fictional data (measured by the team on 13.11.).

## 3. Setup and start

Order for a juror: database, Ablage, import, Übersetzer + Prüf-Agent, web app. The commands below are PowerShell (Windows) unless a bash variant is shown.

### 3.1 Database (Supabase)

In the Supabase SQL editor, run in this order:

1. The table `quellen` (copied from `ablage/SPEC.md` section 5; no separate `.sql` file exists for it):

```sql
create table if not exists quellen (
  id            uuid primary key default gen_random_uuid(),
  typ           text not null check (typ in ('whatsapp','email','drive','call')),
  projekt       text not null,
  kanal         text,
  absender      text,
  zeitpunkt     timestamptz,
  text          text not null default '',
  anhang_pfad   text,
  anhang_typ    text,
  anhang_name   text,
  original_ref  text not null,
  content_hash  text not null unique,
  status        text not null default 'neu' check (status in ('neu','verarbeitet','fehler')),
  meta          jsonb not null default '{}',
  importiert_am timestamptz not null default now()
);
create index if not exists quellen_status_idx on quellen (status, zeitpunkt);
create index if not exists quellen_projekt_idx on quellen (projekt, zeitpunkt);
```

2. `uebersetzer/schema.sql` (structured tables and views; it uses `quellen`, so run it second; it can be run repeatedly).
3. `uebersetzer/stammdaten_bv_simmering.sql` (master data of the fictional project: project, bill of quantities, units, people).

Then, under Storage, create a **private** bucket named `ablage`.

### 3.2 Ablage API and import of the fictional data

```powershell
cd ablage
py -3 -m venv .venv
.venv\Scripts\python -m pip install -e .
copy .env.example .env          # fill in SUPABASE_URL and SUPABASE_SERVICE_KEY
```

bash alternative: `python3 -m venv .venv && .venv/bin/python -m pip install -e . && cp .env.example .env`, then use `.venv/bin/python` instead of `.venv\Scripts\python`.

Import the fictional base data plus the scenario "Wand Top 5" (from `ablage/`; add `--dry-run` to parse without writing):

```powershell
.venv\Scripts\python -m ablage import whatsapp ..\fake_data\whatsapp --projekt "BV Simmering"
.venv\Scripts\python -m ablage import email    ..\fake_data\email    --projekt "BV Simmering"
.venv\Scripts\python -m ablage import ordner   ..\fake_data\drive    --projekt "BV Simmering"
.venv\Scripts\python -m ablage import call     ..\fake_data\calls    --projekt "BV Simmering"
.venv\Scripts\python -m ablage import whatsapp ..\fake_data\szenarien\wand_top5\whatsapp --projekt "BV Simmering"
.venv\Scripts\python -m ablage import call     ..\fake_data\szenarien\wand_top5\calls    --projekt "BV Simmering"
.venv\Scripts\python -m ablage zeige --projekt "BV Simmering" --limit 10
.venv\Scripts\python -m ablage audit --projekt "BV Simmering"
```

Base data is 39 WhatsApp messages, 8 mails (6 mails + 2 attachments), 6 Drive files and 1 call; the scenario adds 11 rows (65 in total, per `ablage/SPEC.md` section 10). `audit` reads `quellen` and the bucket and runs data-quality checks against `fake_data/`. Importing twice is harmless.

Start the API (needed only for the live sources and the `/import/...` endpoints, not for the CLI import):

```powershell
.venv\Scripts\python -m uvicorn ablage.api:app --port 8000
```

`GET /health`, interactive docs at `http://localhost:8000/docs`. Endpoints are listed in [`ablage/README.md`](ablage/README.md). The API has no login except the optional token on the n8n endpoints: run it locally or behind a tunnel only.

### 3.3 Übersetzer and Prüf-Agent

With `uv` (a `uv.lock` is committed):

```bash
cd uebersetzer
cp .env.example .env            # PowerShell: copy .env.example .env
                                # fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY
uv sync
```

Without `uv` (`pyproject.toml` has no build backend, so install the dependencies directly; versions as in `pyproject.toml`):

```powershell
cd uebersetzer
py -3 -m venv .venv
.venv\Scripts\python -m pip install "anthropic>=0.70" "supabase>=2.10" "pydantic>=2.7" "pypdf>=4.0" python-dotenv tzdata pytest
copy .env.example .env
```

(bash: `.venv/bin/python` instead of `.venv\Scripts\python`.) Replace `uv run python` with `.venv\Scripts\python` in the commands below. This `pip` route is not what the team's lockfile pins; `uv` is the tested path.

Free commands (no Claude):

```bash
uv run python -m uebersetzer trockenlauf        # translates fake_data without Claude, writes nothing (shows what would be sent)
uv run python -m uebersetzer pruefen --trocken  # checks existing entries in Supabase against the rules, writes nothing
```

Commands that call Claude (cost money, need `ANTHROPIC_API_KEY`):

```bash
uv run python -m uebersetzer lauf --mit-claude                 # translate all new sources, then run the Prüf-Agent
uv run python -m uebersetzer lauf --mit-claude --dauerhaft 30  # loop, look again every 30 s (live demo)
uv run python -m uebersetzer pruefen                           # fixed rules only, writes signals (free)
uv run python -m uebersetzer pruefen --mit-claude              # additionally the Claude check
```

Note: `lauf` without `--mit-claude` stops with a message as soon as a new source would need Claude (cost guard); it does not continue with the rule stage alone. For the fixed rules only, use `pruefen`. On a database that holds only `quellen`, structured entries (and therefore signals) appear only after a run with `--mit-claude`.

### 3.4 Web app (digital twin)

From the repository root:

```powershell
npm install
copy .env.example .env.local    # fill in SUPABASE_URL and SUPABASE_SERVICE_KEY (and optionally ANTHROPIC_API_KEY)
npm run dev                     # http://localhost:3000
```

bash: `cp .env.example .env.local`. For a production build: `npm run build` then `npm start`.

Open `http://localhost:3000`. The card "BV Simmering" opens the twin; the cards "Wiener Staatsoper" and "Holzhybrid Seestadt (fiktiv)" are static demo cards without data and do not open anything. Without Supabase variables only those two cards appear.

### 3.5 Telefon-Agent (phone agent, optional)

1. In `.env.local`: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_PHONE_NUMBER_ID`, `TELEFON_TESTNUMMER`, and `ABLAGE_URL` of the running Ablage API. For real calls set `TELEFON_TROCKEN=0`.
2. In ElevenLabs, set the agent's post-call webhook to `https://<host>/api/telefon/webhook` (events `post_call_transcription` and `call_initiation_failure`) and put its secret into `ELEVENLABS_WEBHOOK_SECRET`. Locally, put a tunnel in front of `npm run dev`.
3. `npm run dev`, then in a second terminal:

```bash
npm run telefon            # call open signals every 30 s
npm run telefon:einmal     # one pass
```

`GET /api/telefon/anrufen` shows the state (configured, dry run, test number set, open signals without a call).

## 4. Tests

| Part | Command | Needs |
|---|---|---|
| Ablage | `cd ablage` then `.venv\Scripts\python -m pytest -q` | no Supabase, uses `fake_data/` as fixtures |
| Übersetzer + Prüf-Agent | `cd uebersetzer` then `uv run pytest` (or `.venv\Scripts\python -m pytest` with the `pip` route) | no Claude, no Supabase |
| WhatsApp reader | `cd ablage/whatsapp-mitleser` then `npm install` and `npm test` | no network, no WhatsApp account |
| Web app, phone agent and first prototype | `npm test` (Vitest: phone agent with fake ElevenLabs and Supabase, rules and twin derivation of the `/v1` prototype); `npm run typecheck` | nothing |

The Übersetzer tests use fake Claude answers; the Claude stage of the Prüf-Agent was only tested that way (see limits). `npm test` covers the phone agent (`tests/telefon.test.ts`, no network) and the first prototype's rule engine (`tests/rules.test.ts`), not the Supabase-based views.

## 5. Demo walkthrough

Chain from raw data to the office view, using the fictional data. The scenario is the core example of `KONZEPT.md`: the drywall crew announces on Friday that it will close the wall in the storage room of unit "Top 5" on Saturday at 7:00, but the valid drawing (index C) moves the distribution board there and the electricians have not yet done it.

1. Do 3.1 to 3.4 (database, import of base data and scenario).
2. Run `uv run python -m uebersetzer lauf --mit-claude` in `uebersetzer/`. The output reports translated sources, entries, drawings, new signals and resolved signals.
3. Open `http://localhost:3000` and click "BV Simmering". Check:
   - **Notifications** (bell icon): signals with severity, who would be called and the text for the call (`anruf_text`).
   - **Changes**: detected changes per unit with the sources behind each (WhatsApp, voice, photo, mail).
   - **Inbox**, **Daily log**, **Record**: the raw messages and the structured record, each entry linked to its source.
   - **Ask** drawer: e.g. a question about Top 5; the answer cites record entries.
4. Live feeling: leave `uv run python -m uebersetzer lauf --mit-claude --dauerhaft 30` running, import another message (for example through the WhatsApp reader, section 6, or `python -m ablage import ...`), and watch the web app pick it up within a few seconds (it polls every 6 s). A message that reports the fix moves the signal to resolved.

5. Optional, with the phone agent set up (3.5): `npm run telefon:einmal` calls the responsible person for each open signal and sets it to `in_bearbeitung`; the web app then shows "called at ...". Without the ElevenLabs variables no call is placed and the signal stays `offen`.

## 6. Live sources (optional)

All of these are optional and none is needed for the walkthrough above. Status of each is in section 8.

- **WhatsApp via a linked device (unofficial, prototype)**: a small Node service (`ablage/whatsapp-mitleser/`, Baileys) logs in to a WhatsApp account as a linked device, reads along only in chats that are explicitly allowed, and forwards new messages, photos, voice notes and documents to `POST /import/whatsapp/nachricht`. By default it sends nothing. Two optional parts, both off by default: it can post a warning into one allowed chat for each new open signal (and again when a resolved signal is reopened), and it can store a rating of that warning (thumbs up or down, or a reply) in `signale.bewertung`. Setup in [`ablage/whatsapp-mitleser/README.md`](ablage/whatsapp-mitleser/README.md).
- **WhatsApp via Twilio sandbox**: `POST /import/whatsapp/twilio`; setup in [`ablage/README.md`](ablage/README.md), section "WhatsApp live über Twilio".
- **Gmail and Google Drive via n8n**: `POST /import/email/gmail-felder` and `POST /import/drive/datei`, two importable n8n flows; setup in [`ablage/n8n/README.md`](ablage/n8n/README.md). Needs a public tunnel to the Ablage API and `ABLAGE_IMPORT_TOKEN`.
- **Voice-message transcription**: set `TRANSKRIPT_API_KEY` (and optionally base URL and model) in `ablage/.env`; any OpenAI-compatible transcription API; details in [`ablage/README.md`](ablage/README.md), section "Sprachnachrichten transkribieren".
- **Own WhatsApp chat**: export a chat with media and import the `.zip` under a separate project name (`ablage/README.md`, "Eigenen WhatsApp-Chat testen").

## 7. First prototype (/v1)

The first prototype (Melih) is a self-contained Next.js app at `/v1`. It is **separate from the Supabase chain** above: it has its own SQLite event log (`data/sitetwin.db`, created on first start), its own extraction (`lib/extract.ts`, Claude or a rule-based fallback), its own rule engine (`lib/rules.ts`) and its own 3D model. It does not read `quellen`, `eintraege` or `signale`, and nothing from the Supabase chain flows into it. Its Telegram bot is the only notification channel it has; it is not the phone agent.

What it does: a Telegram group, pasted emails, site photos (Claude vision) or the simulator in the UI produce events in an append-only log; the twin state is derived from the log, so a timeline slider replays the site. A rule engine flags closed-before-inspection walls, work from an outdated drawing revision, out-of-sequence work, unacknowledged changes and unclear messages. The superintendent decides with *Stop* or *Approve* in an inbox, and a decision is again an event. Crews can ask a question and get an answer built only from the record; flag types the superintendent keeps approving for a trade are downgraded automatically (`lib/answer.ts`).

Run (from the root, `.env.local` optional):

```bash
npm run dev      # then open http://localhost:3000/v1 and click "Demo" in the header
npm run demo     # plays the storyline from a terminal against the running server (needs Node 24, see section 2)
npm run db:reset # resets the SQLite log to the seed data (server must run)
```

| Rule | Severity |
|---|---|
| Closed (or planned to close) before inspection | critical |
| Work from an outdated drawing | high |
| Out of sequence | high |
| Change not acknowledged | medium |
| Unclear message | medium |

On Vercel: the app is live at https://sitetwin-hendriks-projects-491d3237.vercel.app, deployed automatically from `feature/sitetwin` as a standard Next.js project (Node 24.x, env vars from `.env.example`). Vercel's project directory is read-only, so the SQLite event log of this prototype lives in `/tmp` there. It is per function instance and ephemeral: every cold start begins again from the seed scenario, and the live stream (`/api/stream`) only sees changes made on the same instance. The digital twin reads from Supabase and is not affected. The phone agent is not configured on the Vercel deployment; calls are placed from a local instance.

| Method | Path | |
|---|---|---|
| `POST` | `/api/ingest` | `{ source, sender, text, image? }` |
| `GET` | `/api/state` | events, flags, derived twin |
| `POST` | `/api/decide` | `{ flagId, outcome: "approve" \| "stop", comment }` |
| `GET` | `/api/twin/elements/:id` | wall / room / `ALL` as JSON for agents |
| `GET` | `/api/stream` | Server-Sent Events on every change |
| `POST` | `/api/telegram` | Telegram webhook (optional; set it with `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<host>/api/telegram&secret_token=<TELEGRAM_WEBHOOK_SECRET>`) |
| `POST` | `/api/reset` | reset to seed data |

The Supabase-based routes of the web app are `GET /api/projekt/:id`, `POST /api/fragen` and `GET /api/anhang?pfad=...`. The phone agent adds `GET`/`POST /api/telefon/anrufen` and `POST /api/telefon/webhook`.

## 8. Assumptions and limits

Status as of Saturday 14.11.2026, noon. Built beats promised: what is not listed as working here should be read as not working.

**Data**
- All test data in `fake_data/` is fictional (people, company, project, plans). Photos are placeholders. The two voice files are two seconds of silence; the transcripts of the fictional voice messages come from hand-written sidecar files (`<audio>.txt`), not from speech recognition. The PDF plans are generated (`uebersetzer/werkzeuge/plan_top3.py` for one of them).
- The Übersetzer's own `testquellen.py` builds `quellen`-like rows from `fake_data/` for tests and dry runs with simplified parsing; it does not replace Ablage.

**Live inputs**
- **Drive -> n8n Cloud -> tunnel -> Ablage -> Supabase** ran once for real on 14.11.2026, triggered by hand with a test PDF. Later that day the flow was activated and run by hand a second time; Ablage recognised the same PDF as a duplicate. Not checked: that a new file in the folder arrives on its own through the activated flow (one-minute polling).
- **Gmail -> n8n Cloud -> tunnel -> Ablage -> Supabase** ran once for real on 14.11.2026, triggered by hand, with a fictional test mail without attachment (`POST /import/email/gmail-felder`, the mail as n8n's Gmail node delivers it, parsed into fields). Later that day the flow was activated and run by hand a second time; Ablage recognised the same mail as a duplicate. Not checked on the live path: mails with attachments, hash equality with the `.eml` import of the same mail, and that a new mail arrives on its own through the activated flow. Both flows reach Ablage through a temporary tunnel address that changes with every restart of the tunnel and then has to be entered in the flows again. In tests, the six fictional mails give the same rows and hashes as the `.eml` import. The older raw-mail endpoint `POST /import/email/gmail` does not work with n8n Cloud, which does not allow its managed Google credential in an HTTP Request node. Importing `.eml` files works and is tested.
- **Voice-message transcription** is built for an OpenAI-compatible API but was only tested against a mocked interface, never with a real key or a real WhatsApp voice message. A voice message stored without a transcript does not get one later (insert-only table; delete the row and import again).
- The **Twilio WhatsApp endpoint** is built to Twilio's documented format and tested, but has never run against a real Twilio account.
- The **WhatsApp reader** ran for real on 14.11.2026 with one team member's own account and a test group created for it: a text, a photo with caption and a voice note arrived in `quellen`, and one dropped connection was re-established automatically. Not checked: messages from other participants, documents and videos, longer operation, large groups. It uses Baileys (7.0.0-rc14, a release candidate), which is **not** the WhatsApp Business API and is against WhatsApp's terms of use; the number can be restricted. A linked device receives all chats of the account; the service discards everything outside the allowlist without storing or logging it. Prototype only: Twilio or the WhatsApp Business API is the route for production.
- The **warning into the WhatsApp group** and the **rating of a warning** each ran once for real on 14.11.2026, with a test warning built from an existing signal and a thumbs-down reaction that was stored on the signal (the test rating was removed afterwards). The warner has not yet run continuously against a signal that was newly created by a live message. When the Prüf-Agent reopens a resolved signal, the warner posts a new warning marked "Wieder offen"; this is covered by tests and has not run live. Warnings come from the linked account's own number; anyone in the chat can rate, there is no check of who may decide.
- The same WhatsApp message imported once live and once via export gives two rows (different identity). Two identical messages by the same person within the same minute collapse into one.
- The Ablage API has no authentication except the optional token on the n8n endpoints.

**Agents**
- **Phone agent:** the automated tests run against fake ElevenLabs and Supabase responses (`tests/telefon.test.ts`). The voice agent itself, its prompt and its tool `signal_abschliessen` live in the team's ElevenLabs workspace, not in this repository. If nobody picks up, the signal stays open and visible in the web app after `TELEFON_MAX_VERSUCHE` attempts; there is no escalation to the office yet. The agent decides itself whether it resolves the signal; the Prüf-Agent additionally sets `geloest` as soon as a message reports the fix. The phone agent also calls for a follow-up signal that was downgraded after a false-alarm rating.
- **Learning loop: built, not yet run live.** A rating given in WhatsApp is stored on the signal (`signale.bewertung`: `berechtigt` or `fehlalarm`), and the Prüf-Agent reads it. If a situation rated as a false alarm comes up again, the rated signal is left alone and a follow-up signal is created, downgraded to `mittel` and titled "Früher als Fehlalarm bewertet: …". The last ten rated signals of the project also go into the prompt of the Claude stage. It does not learn new rules: the fixed rules only downgrade exactly the same situation. All of this is tested against a rebuilt database with fake answers; storing a rating ran once for real, the Prüf-Agent acting on one has not. Details in [`uebersetzer/README.md`](uebersetzer/README.md), section "Lernschleife". The first prototype (`/v1`) has its own, separate loop (section 7).
- The Prüf-Agent's fixed rules (outdated drawing, wall closed before installation, component dropped from the plan, unclear message) are the stage that ran on the real test data. Its Claude stage is only tested with fake answers.
- The Übersetzer uses Claude (default `claude-haiku-5-5`). Results depend on the model; a source that fails because of rate limit or network stays `neu` and is retried. Use your own API key.
- The Übersetzer does not transcribe audio itself.
- Partly solved (see `KONZEPT.md`, open points): if the foreman does not pick up, the phone agent retries a limited number of times. Not solved: escalation to the office, and what happens if a fix is never reported.

**Web app**
- Read-only against Supabase; the signal status is never changed from the UI. `in_bearbeitung` is set only by the phone agent (server routes under `app/api/telefon/`).
- The twin is generated from the table `tops` (units and rooms); it is a schematic, not a scanned model.
- **Numbers that are derived, not measured:**
  - *Progress* is the share of electrical work stages that were **reported** done per unit in messages. It is not an inspected or measured value.
  - *Extra costs* are estimates: hours times the Regie rate plus extra pieces at bill-of-quantities unit prices. Where a message carries no quantity, `lib/demo-preise.ts` supplies **hard-coded demo estimates** keyed by unit and topic (marked "Demo estimates" in the code, and noted as partly from the demo calculation in the Changes view). These figures are not taken from any invoice.
  - Alert rules in the Notifications view (`REGELN` in `lib/vm.ts`) describe which signal kinds are routed to whom; they are display text, not configurable rules.
  - The confirmation drafts in the Changes view are text for a person to send; the app sends nothing.
  - The two additional project cards on the home page are static demo cards with no data behind them.

**First prototype (/v1)**
- Not connected to the Supabase chain (section 7). Telegram and the SQLite log belong to that prototype only. Whether the Telegram bot was ever run against a real bot is not documented.

**Repository**
- The repository is private, as required by the Talona rules.

## 9. Repo layout and sub-docs

```
.
├── KONZEPT.md              core idea and process (source of truth)
├── TALONA.md               design and function reference taken from the Talona product
├── CLAUDE.md               rules and ownership for AI sessions in this repo
├── ablage/                 Ablage: ingest layer (Python, FastAPI, CLI)
│   ├── ablage/             package: adapters/, api.py, store.py, ...
│   ├── n8n/                two n8n flows (Gmail, Drive) and setup
│   ├── whatsapp-mitleser/  WhatsApp reader via linked device (Node, Baileys; unofficial prototype)
│   └── tests/
├── uebersetzer/            Übersetzer + Prüf-Agent (Python, Claude)
│   ├── uebersetzer/        package: lauf.py, pruefung.py, extraktion.py, ...
│   ├── schema.sql          structured tables, views
│   ├── stammdaten_bv_simmering.sql
│   └── tests/
├── fake_data/              fictional test data: whatsapp/, email/, drive/, calls/, szenarien/
├── app/                    Next.js routes: /, /projekt/[id], /v1, app/api/*
├── components/             web app UI (components/app/) and the /v1 prototype UI
├── lib/                    Supabase access, view model (vm.ts, twin-model.ts), phone agent (telefon/), /v1 pipeline
├── scripts/                demo.mts (terminal demo of /v1), telefon.mts (phone agent loop)
└── tests/                  Vitest tests (phone agent, /v1 rules)
```

| Doc | Content |
|---|---|
| [`KONZEPT.md`](KONZEPT.md) | core idea, process, signal lifecycle |
| [`ablage/README.md`](ablage/README.md) | Ablage setup, CLI, endpoints, Twilio, transcription |
| [`ablage/SPEC.md`](ablage/SPEC.md) | contract of the table `quellen` (sections 5 and 6), adapters, API |
| [`ablage/n8n/README.md`](ablage/n8n/README.md) | Gmail and Drive via n8n, with known limits |
| [`ablage/whatsapp-mitleser/README.md`](ablage/whatsapp-mitleser/README.md) | WhatsApp reader: setup, allowlist, limits |
| [`uebersetzer/README.md`](uebersetzer/README.md) | Übersetzer, component register, Prüf-Agent, views for the front end |
| [`uebersetzer/schema.sql`](uebersetzer/schema.sql) | structured database schema |
| [`TALONA.md`](TALONA.md) | what the web app imitates from the Talona product |
| [`fake_data/szenarien/wand_top5/README.md`](fake_data/szenarien/wand_top5/README.md) | the demo scenario in detail |

## 10. License

Talona track of the Building Better Worlds Hackathon: all work in this repository belongs to Talona. The repository is private and is not published under the MIT license.
