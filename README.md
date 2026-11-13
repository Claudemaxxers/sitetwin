# SiteTwin – live digital twin of the construction site

> Talona Track 01 · *Context for the Physical World*

Construction runs on group chats, email threads and spreadsheets. One crew closes a wall before the inspection, another builds from last week's drawings. **SiteTwin** listens to the channels the site already uses, keeps **one live record of what changed and who decided it**, shows it on a 3D model of the building, and flags problems early enough for the superintendent to act.

## What it does

| | |
|---|---|
| **Connects to what the site uses** | Telegram group (webhook), pasted emails, site photos (Claude vision), plus a simulator in the UI |
| **One live record** | Every message becomes structured events in an append-only log. The twin state is *derived* from that log (event sourcing), so the timeline slider replays the site at any point in time |
| **Flags issues as they happen** | Deterministic rule engine runs on every event (see below) |
| **Decisions go to the superintendent** | Inbox with *Stop* / *Approve* + comment. The decision is itself an event in the log and is pushed back to Telegram |
| **For people, agents and robots** | `GET /api/twin/elements/:id` returns status, valid drawing revision, open flags, block state and full history as JSON |

| **Answers questions** | Crews text a question (*"Darf ich Wand 12 zumachen?"*) and get an answer built only from the record: valid revision, missing inspection, open or stopped flags |
| **Learning loop** | Superintendent decisions feed back: a flag type the superintendent keeps approving for a trade is downgraded automatically; stopped flag types never are (`lib/answer.ts`) |

### Rules

| Rule | Severity | Example |
|---|---|---|
| Closed (or *planned* to close) before inspection | critical | "Mache morgen Wand 12 zu" while the inspection is missing |
| Work from an outdated drawing | high | "nach Plan Rev B" while Rev C is valid |
| Out of sequence | high | Filling before boarding, inspection before rough-in |
| Change not acknowledged | medium | A trade works on a wall after a revision it never confirmed |
| Unclear message | medium | "bin hinten fertig mit dem zeug" → ask back instead of guessing |

## Digital twin (Supabase)

`/` lists the company's projects, `/projekt/<projekt>` is the twin: KPIs on top, the building in 3D on the right, data for the current selection on the left, a timeline at the bottom.

- Reads Hendrik's structured tables (`uebersetzer/schema.sql`) server-side: `projekte`, `tops`, `eintraege_mit_quelle`, `signale`, `plaene_aktuell`, `lv_positionen`. Polls every 6 s.
- The building is generated from `tops` (storeys, units, rooms). Click a storey: the house is sliced and the storey pulled out; click a unit: rooms, and the place of a signal lights up (e.g. distribution board as built vs. where the valid plan puts it).
- KPIs are derived, nothing is written back: progress = electrical work stages reported done per unit; extra costs = hours at the Regie rate plus extra pieces at LV unit prices.
- Setup: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` in `.env.local` (server only). Melih's first prototype is still at `/v1`.

## Architecture

```
Telegram · Mail · Photo · UI ─► /api/ingest ─► Claude extraction (structured output)
                                               │  { element, action, trade, drawing_rev, confidence }
                                               ▼
                                   append-only event log (SQLite)
                                     ├─► twin = derive(events)      lib/twin.ts
                                     ├─► rules(event, twin) → flags lib/rules.ts
                                     └─► SSE ─► 3D twin · feed · superintendent inbox
```

- Next.js 16 (App Router), TypeScript, Tailwind
- `@react-three/fiber` + drei for the 3D model (`lib/model.ts`: one floor, 6 rooms, 19 walls)
- SQLite via Node's built-in `node:sqlite` (no native build step)
- Anthropic SDK, `claude-sonnet-5-5` with structured outputs. **Without an API key a rule-based extractor is used**, so the demo runs offline.

## Run it

Requires Node 24+.

```bash
npm install
cp .env.example .env.local   # optional: add ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

Click **▶ Demo** in the header to play the storyline step by step, or run it from a terminal against the running server:

```bash
npm run demo
```

Tests (rules, twin derivation, the full demo scenario):

```bash
npm test
```

### Telegram (optional)

1. Create a bot with @BotFather, put the token into `TELEGRAM_BOT_TOKEN`, and the superintendent's chat id into `TELEGRAM_SUPER_CHAT_ID`.
2. Add the bot to the site group and disable privacy mode so it sees all messages.
3. Expose the dev server (e.g. a tunnel) and set the webhook: `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<host>/api/telegram&secret_token=<TELEGRAM_WEBHOOK_SECRET>`

## Demo storyline

1. Electrician: *"Leitungen in Bad 1.04 Wand 12 fertig"* → wall 12 turns blue.
2. Planner (mail): *"Ab sofort gilt Rev C"* → bathroom walls switch to Rev C, acknowledgements reset.
3. Drywall: *"Mache morgen früh Wand 12 zu, nach Plan Rev B"* → **critical + high flag**, wall pulses red, superintendent is alerted.
4. Drywall asks *"Darf ich Wand 12 heute zumachen?"* → SiteTwin answers from the record: not yet, inspection missing, waiting on the superintendent.
5. Superintendent clicks **Stop** with a comment → logged, wall turns orange (blocked until it passes inspection).
6. Drag the timeline back: who changed what, when, and who decided.

## API

| Method | Path | |
|---|---|---|
| `POST` | `/api/ingest` | `{ source, sender, text, image? }` |
| `GET` | `/api/state` | events, flags, derived twin |
| `POST` | `/api/decide` | `{ flagId, outcome: "approve" \| "stop", comment }` |
| `GET` | `/api/twin/elements/:id` | wall / room / `ALL` as JSON for agents |
| `GET` | `/api/stream` | Server-Sent Events on every change |
| `POST` | `/api/telegram` | Telegram webhook |
| `POST` | `/api/reset` | reset to seed data |

## License

MIT – see [LICENSE](LICENSE).
