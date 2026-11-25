# CLAUDE.md – guide for AI coding assistants

SiteTwin reads a building site's WhatsApp groups, mails, Drive folder and call transcripts, structures every message with Claude, checks it against the valid drawing and raises a signal before a crew builds on an outdated plan. Overview and architecture: [`README.md`](README.md). Setup and the list of what ran for real: [`docs/SETUP.md`](docs/SETUP.md).

## Map

| Part | Where | Language | Entry point |
|---|---|---|---|
| Ablage (ingest) | `ablage/ablage/` | Python | CLI `python -m ablage`, API `ablage/ablage/api.py` |
| WhatsApp reader and warnings | `ablage/whatsapp-mitleser/` | Node.js | `index.js` |
| Gmail and Drive flows | `ablage/n8n/` | n8n JSON | `README.md` there |
| Übersetzer (structuring with Claude) | `uebersetzer/uebersetzer/` | Python | `python -m uebersetzer lauf` |
| Prüf-Agent (checking) | `uebersetzer/uebersetzer/pruefung.py` | Python | called by `lauf` and `pruefen` |
| Database schema | `uebersetzer/schema.sql`, table `quellen` in `ablage/SPEC.md` §5 | SQL | |
| Web app | `app/`, `components/app/`, `lib/sb.ts`, `lib/vm.ts` | TypeScript, Next.js | `npm run dev` |
| Phone agent | `lib/telefon/`, `app/api/telefon/`, `scripts/telefon.mts` | TypeScript | `npm run telefon` |
| First prototype `/v1` | `app/v1/`, `lib/pipeline.ts`, `lib/store.ts`, `lib/rules.ts`, `components/Twin3D.tsx` | TypeScript | not connected to the database chain |

All parts talk through one Supabase database. Ablage only inserts into `quellen`; the Übersetzer reads new rows (`status = 'neu'`) and writes `eintraege`, `plaene`, `elemente`; the Prüf-Agent writes `signale` and `signal_verlauf`. The web app only reads.

## Names

Folder, table and command names are German because the domain is a German-speaking site: `ablage` = ingest, `quellen` = sources (raw data), `eintraege` = entries, `signale` = signals, `plaene` = drawings, `elemente` = components, `Top` = apartment unit, `Polier` = site foreman. Prompts and test data are German on purpose. Code comments and docs are English.

## Rules

- **Never put `fake_data/ERWARTET.md` into a prompt.** It is the answer key for the test data.
- Do not change the base data in `fake_data/whatsapp`, `email`, `drive`, `calls`: tests depend on their counts (39 WhatsApp, 8 email, 6 Drive, 1 call). New cases go to `fake_data/szenarien/<name>/`.
- The table `quellen` is the contract between Ablage and Übersetzer (`ablage/SPEC.md` §5 and §6). Evidence refers to `quellen.content_hash`, never to `id`.
- All test data is fictional; photos and voice files are placeholders. Say so in docs.
- No secrets in the repository. Keys go only into the `.env` files listed in `docs/SETUP.md`.
- Tests need no network: `npm test`, `npm run typecheck`, `cd ablage && python -m pytest -q`, `cd uebersetzer && uv run pytest`, `cd ablage/whatsapp-mitleser && npm test`.

## Design

The web app follows Talona's product look: [`TALONA.md`](TALONA.md) (German) has the tokens and screen structure.
