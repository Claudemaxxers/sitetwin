# Übersetzer (Hendrik)

> **💸 Costs – please read first (Claude Code too)**
> Every Claude call costs money and runs on the API key in `uebersetzer/.env` (within the team that is Hendrik's **private** key). Please only run it when it is really needed, not "just for a quick test".
> - Free: `uv run pytest` and `uv run python -m uebersetzer trockenlauf --ohne-claude` (without Claude).
> - Costs money: everything without `--ohne-claude`. A full run over the test data costs about 4 cents (49 calls with `claude-haiku-5-5`, measured on 13 Nov over the fictional data). Within the team, briefly ask Hendrik first.
> - **Claude is on by default:** Every command calls Claude unless `--ohne-claude` is given; that flag skips every API call (fixed rules only, free). `--mit-claude` is still accepted but has no effect.

Steps 2 + 3 from [`KONZEPT.md`](../KONZEPT.md): turns the raw data of the Ablage (`quellen`, Santino) into structured entries – **what, where, who, when, according to which plan, who decided, what is being waited for** – and detects new plan revisions. The Prüf-Agent (signals) and the digital twin work on top of that.

```
quellen (status='neu')  ──►  Übersetzer  ──►  eintraege   (0..n pro Quelle)
   Text, Foto, PDF,           Claude           plaene      (neuer Index aus Mail/PDF)
   Transkript                                  quellen.status = verarbeitet | fehler
```

## Setup

Python 3.11+ and [uv](https://docs.astral.sh/uv/).

```bash
cd uebersetzer
cp .env.example .env        # fill in SUPABASE_SERVICE_KEY and ANTHROPIC_API_KEY
uv sync
```

Database: run `schema.sql`, then `stammdaten_bv_simmering.sql` in the Supabase SQL editor (both repeatable). Already done in the project `sitetwin`.

## Running

```bash
uv run pytest                                                  # tests (no Claude, no Supabase), free
uv run python -m uebersetzer trockenlauf --ohne-claude         # fake_data, no Claude, writes nothing, free
uv run python -m uebersetzer trockenlauf --limit 5             # costs money: 5 test sources with Claude
uv run python -m uebersetzer lauf                              # costs money: translate and check new sources
uv run python -m uebersetzer lauf --dauerhaft 30               # for the demo: look for new sources every 30 s
```

## How it works

- **One source per Claude call**, in chronological order. Sent along are the last 40 sources as a timeline (so that "ok machen wir" or "laut unserem Plan" can be attributed), the valid plans and the master data (Tops, LV). Extraction is done only from the new source.
- **Attachments:** Photos go to Claude as an image. iPhone photos in HEIC/HEIF format are converted to JPEG by the Übersetzer beforehand (`pillow-heif`, rotated upright, longest edge 1568 px), detected by extension or file header; checked with generated test images, not with a real iPhone photo. PDFs as text (`pypdf`) if the Ablage leaves `text` empty; PDFs without a text layer as a document. Voice messages only via the transcript in `text` – if it is missing, an entry with `unklar = true` and a follow-up question is created instead of guessed content.
- **Handled without Claude:** deleted messages, master data files from the Drive (CSV, MD, TXT), empty sources.
- **Idempotent:** If a source is processed again, its entries are replaced (`unique (quelle_hash, nr)`), not duplicated. Plans are merged; the most recent revision is the valid one (view `plaene_aktuell`).
- **Errors:** Rate limit / network → source stays `neu`, the next run tries again. Otherwise `status = fehler` with the reason in `meta.fehler`.
- **Continuous run (`--dauerhaft`):** If Supabase is briefly unreachable (e.g. DNS dropouts on the hotspot), only that cycle is aborted; the run reports `⚠ Netz/Supabase nicht erreichbar` and tries again in the next cycle.
- **Model:** `claude-haiku-5-5` with Structured Outputs (Pydantic, `modell.py`), effort `medium`. Can be changed via `UEBERSETZER_MODELL`. The stable part of the prompt (rules + master data) is cached.

## Component register (target state)

So that the Prüf-Agent knows *which* cable or *which* wall is meant, the Übersetzer reads plans in as the target state:

- **Target state from plans:** Plan documents (Drive `Plaene/…`, mail attachments `Plan_…`) provide all components – walls, cables, sockets, distribution boards, switches – with room, position and the wall they sit in (`elemente.gehoert_zu`). A new revision updates the register; whatever it no longer provides for becomes `soll_aktiv = false` (e.g. distribution board Top 5 Vorraum after revision C). An older revision changes nothing anymore once a newer one has been adopted.
- **Actual state per message:** Every entry gets, if unambiguous, `element_id` and `schritt` (verrohrung, leitung_eingezogen, gesetzt, abnahme, beplankung, …). The view `element_stand` shows the completed and planned steps per component – this is the basis for the twin.
- **Test data:** `fake_data/drive/Projekt_Simmering/Plaene/Plan_E-03_Top3_IndexA.pdf` (5 drywall partitions in Top 3 with cables and sockets), generated with `uv run python werkzeuge/plan_top3.py`. Fictional, the pipeline is real.

## Target-state changes during construction

The target state is not only in the plan: decisions are changed on site ("Keller nur 3×3 statt 3×4"). Under ÖNORM B 2110 the client can order changes to the works – verbally too, but for evidence the written form counts. SiteTwin models it like this (`soll.py`, runs in the Prüf-Agent, free):

| Who reports | Result |
|---|---|
| Site management (`personen.darf_soll_aendern`, in BV Simmering: Thomas Meier, GU) | Change applies immediately (`freigegeben`), the component register is adjusted, affected signals are resolved. |
| Someone else ("das haben wir geändert") | Only `vorgeschlagen`. Signals stay open – the worker is only cleared after the approval. |
| Site management replies (type `freigabe`) | `freigegeben` (incl. register + signals) or `abgelehnt`. Approvals from unauthorized people are ignored. |
| Site management sends a photo/PDF of a document (type `nachweis`) | `nachweis_status = vorhanden`. Voice messages and photos from others do not count. |

Open tasks for the frontend come from the view **`offene_aufgaben`**: "Soll-Änderung bestätigen" (vorgeschlagen) and "Schriftlichen Nachweis einreichen" (freigegeben, proof missing), with `zustaendig`.

## Views for the frontend (matched against `TALONA.md`)

| Talona | View / table |
|---|---|
| Project record (row + tag) | `eintraege_mit_quelle`, column **`talona_tag`**: Reported done, Planned, Verified, Delivery, Change order, Decided, Sign-off, Issue, Request, Fix reported, Progress |
| Changes, "No client sign-off", "Photo needed" | `soll_aenderungen` + **`offene_aufgaben`** (confirm / submit proof) |
| Alerts ("If work is already built · Alert PM/SU") | `signale` (+ call via the phone agent), history in `signal_verlauf` |
| Check first ("what gets covered up tomorrow") | **`check_first`**: every announced/reported boarding with status *At risk* (open sequence signal), *Resolved* or *Clear* |
| Sheets / Drawing | `plaene_aktuell`, components in `element_stand` |
| Additional costs (lib/twin-model.ts) | `eintraege.taetigkeit`, `menge`, `einheit`, `lv_pos_nr` |

## Prüf-Agent (step 4)

`pruefung.py` checks every new entry against the valid plan and creates **signals** as long as someone can still intervene. `lauf` translates and checks in one pass; individually it works with:

```bash
uv run python -m uebersetzer pruefen --trocken --ohne-claude  # check against Supabase, write nothing (free)
uv run python -m uebersetzer pruefen --ohne-claude            # fixed rules, writes signals (free)
uv run python -m uebersetzer pruefen                          # additionally the Claude check (costs money)
```

| Stage | Detects | Cost |
|---|---|---|
| Fixed rule `plan_veraltet` | Work according to plan revision X although a newer revision had already been issued at that time ("the change did not reach the crew"). Resolved as soon as work at the same location follows the valid revision. | 0 |
| Fixed rule wall closed before installation | A wall or a room is about to be closed up (or already is) although according to the plan installation is still missing there (cable not conduited/pulled, socket/distribution board not set). Critical as long as it is only announced. The call goes to the foreman of the trade whose installation is missing (e.g. electrical), not the one closing up. Resolved as soon as everything is set. An acceptance inspection is deliberately not a prerequisite (Golden Set S1). | 0 |
| Fixed rule component dropped | Work on a component that the valid plan no longer provides for. Resolved as soon as the component is done at the new location. | 0 |
| Fixed rule `unklar` | Reported work where it is unclear what or where → follow-up question instead of guessing. Short replies like "ok" trigger nothing. | 0 |
| Claude check | Deviation from plan/LV without an instruction, instructions that were not passed on; also detects when a new entry resolves an open signal. **Sequence signals (wall closed before installation) come only from the fixed rules:** the Prüf-Agent discards suggestions of this kind, after false alarms in two test runs. | 1 call per source |

- Signals are idempotent via `(projekt, schluessel)`: further evidence is added to a signal instead of creating a new one; a resolved signal goes back to `offen` on a new deviation (unless it is rated as a false alarm, see learning loop).
- Lifecycle according to `KONZEPT.md`: `offen` (Prüf-Agent) → `in_bearbeitung` (set by the phone agent after the call) → `geloest` (Prüf-Agent). `signal_verlauf` logs every transition via trigger.
- `anruf_text` is the text for the phone agent, `zustaendig` the person from the report.
- Checked entries get `geprueft_am`. To check again: `update eintraege set geprueft_am = null`.

### Learning loop: feedback from the site

The WhatsApp-Mitleser (`ablage/whatsapp-mitleser`, section "Feedback on warnings") writes the site's reply to a warning into `signale.bewertung` (`berechtigt` | `fehlalarm`) and `bewertung_notiz` ("per WhatsApp, <Name>, <Zeit>: <Text>"). The Prüf-Agent reads it like this:

| Rating | What the Prüf-Agent does |
|---|---|
| `fehlalarm` | If the same situation shows up again, the rated signal is **neither added to nor reopened**. It stays in place together with its rating. Instead a follow-up signal is created (`<schluessel>#nach-fehlalarm-1`). It is **downgraded to `mittel`**, the title starts with "Früher als Fehlalarm bewertet: …", the reasoning cites the note, the call text asks for a brief confirmation. Further evidence lands in the follow-up signal, it resolves like the original. |
| `berechtigt` | As before: add, reopen, escalate. The rating stays in place on reopening, a later verdict overwrites it. |
| Claude stage | The last 10 rated signals of the project go into the prompt as the block `<rueckmeldungen_der_baustelle>` (after the open signals, before the new entries, not in the cached part). The rule for it: do not report situations rated as false alarms and similar cases again, unless a new entry clearly shows something different. |

Why a new row instead of reopening: the follow-up signal carries the hint in the title and the downgraded severity, and the rated signal stays unchanged. (The WhatsApp notifier meanwhile also warns again on a reopened signal, with "Wieder offen:" in the title.) Nothing is suppressed entirely, because a false-alarm verdict can be wrong too.

What it does **not** do:
- It does not learn new rules. The fixed rules only downgrade exactly the same situation (same `schluessel`). Similar cases at other locations are only detected by the Claude stage, via the prompt block.
- An open signal with rating `fehlalarm` is not closed (there is no status for that). If the situation appears again, both signals are shown in the web app.
- The phone agent also calls for the downgraded follow-up signal, because it calls for every open signal. Then with the hint in the call text.

**Status:** tested only with the fake DB (`tests/test_pruefung.py`, without Claude). The Prüf-Agent has not yet run with this logic on real ratings from Supabase. The Claude stage with the new block has not been called for real.

## Contract with the Ablage (ablage/SPEC.md §5)

- Reads `quellen` directly with the service key, writes only `status` and `meta.fehler` there.
- Evidence via `content_hash`, never via `id` – no foreign key, so that the Ablage can empty the table and re-import.
- `fake_data/ERWARTET.md` (answer key) never goes into the prompt; a test checks that.

## Assumptions and limits

- `testquellen.py` builds `quellen` rows directly from `fake_data/`, only for tests and dry runs. Simplified parsing and simplified `content_hash` – does not replace the Ablage.
- No audio transcription of its own (see open question to the Ablage).
- The Claude check of the Prüf-Agent is tested with fake responses; on the real data only the fixed rule stage has run so far.
