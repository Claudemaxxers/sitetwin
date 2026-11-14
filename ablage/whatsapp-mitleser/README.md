# WhatsApp-Mitleser

Small Node service that reads along in your **own** WhatsApp as a linked device (like WhatsApp Web) and sends new messages from selected chats to the Ablage (`POST /import/whatsapp/nachricht`, SPEC §7.5). That way real construction-site chats land live in `quellen` without anyone changing how they work.

## Important up front

- **Unofficial.** Built with Baileys, a library that does not come from WhatsApp. This is **not** the WhatsApp Business API.
- **Violates WhatsApp's terms of service.** There is a risk that the number gets restricted or banned. Therefore only with a test number or a test chat and only as a **prototype**.
- The official path remains Twilio (`POST /import/whatsapp/twilio`, see `../README.md`).
- Read-only by default (notifier off): the service sends no messages, no read receipts and does not appear as "online". The library acknowledges receipt at protocol level (delivery, like every linked device); that cannot be switched off.

## Setup (Windows, PowerShell, Node 20.12 or newer)

```powershell
cd ablage\whatsapp-mitleser
npm install
copy .env.example .env
```

1. **Start the Ablage** (other window, in `ablage\`): `.venv\Scripts\python -m uvicorn ablage.api:app --port 8000`. To test: `curl.exe localhost:8000/health`.
2. **Link and look at the chats:**
   ```powershell
   npm run chats
   ```
   The first time, a QR code appears in the terminal (additionally as the image `auth\qr.png`). On the phone: WhatsApp → Settings → Linked devices → Link a device → scan. After that the command lists all groups with name and JID and exits.
   Prefer a code instead of QR: set `WHATSAPP_NUMMER=<number with country code, digits only>` in `.env`; a pairing code is printed, which you enter in WhatsApp under "Link with phone number instead".
3. **Select a chat:** in `.env`, enter the group name (exact, case-insensitive) or the JID at `WHATSAPP_CHATS`, several separated by commas. Individual chats only by number (`+43…`) or JID.
4. **Start reading along:**
   ```powershell
   npm start
   ```
   One line per forwarded message: chat, sender, type, the first 40 characters, response of the Ablage (`neu` / `duplikate`). Check in `ablage\`: `.venv\Scripts\python -m ablage zeige --projekt "Test Santino"`.

Settings (`.env`, template `.env.example`): `ABLAGE_URL` (default `http://localhost:8000`), `ABLAGE_PROJEKT` (default `Test Santino`), `WHATSAPP_CHATS`, `WHATSAPP_NUMMER`, `WHATSAPP_MAX_MB` (default 20). This endpoint needs no token; it does not check one.

## What is forwarded

- **Only chats on the allowlist.** If `WHATSAPP_CHATS` is empty, **nothing** goes out. Messages from other chats are neither forwarded nor logged.
- Only messages that arrive live after the start, no history. Your own messages are included (for testing: write into the group yourself).
- Not forwarded: reactions, protocol/system messages (e.g. deleted, edited), status, broadcasts, channels, stickers and everything without text or a supported attachment.

Mapping onto the endpoint:

| Field | Content |
|---|---|
| `absender` | display name (push name) plus number, e.g. `Name (+43…)`, where known |
| `kanal` | group name, in an individual chat the name of the other party |
| `zeitpunkt` | timestamp of the message (ISO, UTC) |
| `text` | text, extended text or caption of image, video, document |
| `wa_id` | WhatsApp's message ID (identity, duplicate delivery results in `duplikate`) |
| `projekt` | `ABLAGE_PROJEKT` |
| `anhang` | image, video, voice message, document as `{mimetype, dateiname, base64}` in the JSON body |

Voice messages go out as `<id>.ogg` with empty text; the Ablage transcribes them if `TRANSKRIPT_API_KEY` is set there (SPEC §7.9). Media above `WHATSAPP_MAX_MB` or with a failed download are stored without attachment (only the text, if present). If the POST fails, there are three retries with a wait, then the message is discarded and noted in the log (no buffer: if the Ablage was down during that time, the message is missing).

## Warning into the chat (notifier, optional)

New: the service can additionally send a warning into **one** WhatsApp chat when the Prüf-Agent creates a signal (table `signale`, status `offen`). Process according to KONZEPT: signal, the person responsible is informed, fix reported, done.

**Off by default.** Without `WHATSAPP_WARNEN=1` the service behaves exactly as before (read-only). To switch it on, in `.env`:

```
WHATSAPP_WARNEN=1
WHATSAPP_WARN_CHAT=<JID oder exakter Gruppenname>
WHATSAPP_CHATS=<muss denselben Chat enthalten, gleiche Schreibweise>
```

All settings: `WHATSAPP_WARN_AB` (only signals from this ISO timestamp on, default is the start time of the service, so that a restart never dumps old signals into the chat), `WHATSAPP_WARN_ERLEDIGT` (default 1), `WARN_INTERVALL_S` (default 5), `WARN_MAX_PRO_10MIN` (default 6), `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (from this `.env`, otherwise from `../.env`; only these two values are read from the Ablage `.env`). The project is `ABLAGE_PROJEKT`.

**Flow.** Every `WARN_INTERVALL_S` seconds the open signals of the project are read (`GET` only; writing happens only for feedback, see below). Every signal with status `offen` or `in_bearbeitung` whose last change (`erstellt_am` or `aktualisiert_am`, the later value) is not before `WHATSAPP_WARN_AB` gets a warning, once per round. If a reported signal later becomes `geloest`, `✅ SiteTwin: erledigt – <Titel>` follows once, which closes the round. If the Prüf-Agent reopens the same signal (same row, status back to `offen`), a new warning comes whose title starts with "Wieder offen:". As long as a reported signal is open, further changes to it (more evidence, rating, call) trigger nothing.

Two limits: if a signal is resolved and immediately reopened between two polls, the notifier does not notice, because it only sees the state per poll. And an open signal from before `WHATSAPP_WARN_AB` that the notifier has never reported is reported as soon as anything changes it, including a call by the phone agent.

The state (reported signal IDs, IDs of sent messages) is in `zustand/melder.json` (git-ignored, not in `auth/`), so that a restart repeats nothing.

Columns of `signale` used: `id`, `projekt`, `status`, `erstellt_am`, `aktualisiert_am`, `titel`, `schwere`, `top`, `raum`, `element`, `anruf_text` (alternatively `begruendung`), `zustaendig`. `telefon` is never read or sent. Example text:

```
⚠️ SiteTwin-Warnung (automatisch)
<Titel> (kritisch)
Wo: <Top>, <Raum>, <Element>
<anruf_text>
Zuständig: <Name>
```

Empty fields are dropped, phone numbers are removed from the text, upper limit 700 characters. Note: `anruf_text` is worded for the phone agent and sometimes sounds spoken in the chat.

**Safety rules**
- Off by default, only with `WHATSAPP_WARNEN=1`.
- Sending goes **only** to `WHATSAPP_WARN_CHAT`, and that chat must be on the allowlist `WHATSAPP_CHATS`. Otherwise the service aborts at startup with a clear message.
- **Never** to numbers or names from the database (`telefon`, `zustaendig`). The test data is fictional, the numbers could belong to real people. The person responsible appears only as a name in the text.
- **No feedback loop.** The Mitleser also reads its own messages. Messages sent by the notifier are never forwarded to the Ablage: detection via the remembered message IDs and additionally via the fixed text prefixes `⚠️ SiteTwin-Warnung` and `✅ SiteTwin:`. Normal messages of your own continue to go through as before.
- **Rate limit.** At most one message every 3 seconds and `WARN_MAX_PRO_10MIN` per 10 minutes. Beyond that, messages are discarded and logged (until the next start, not into a queue). A failed send is retried at most 3 times on the next poll.
- **The sender is the linked account**: the warning comes from your own number, the one the service is linked with, not from a bot account. This is still unofficial (Baileys) and increases the risk of a ban. Send only into a test group.
- One log line per sent warning (signal ID shortened, the first 40 characters).

**Dry run without WhatsApp:** `npm run warn-test` reads Supabase (read-only), shows column names, number of open signals and the text of up to the 5 newest open signals (regardless of `WHATSAPP_WARN_AB`). It opens no WhatsApp socket. Other project: `$env:ABLAGE_PROJEKT="BV Simmering"; npm run warn-test`.

**Trial with real sending:** `npm run warn-probe` (needs the same switches as the notifier) connects, sends exactly one warning marked as "TEST" into the warn chat, built from the newest signal of the project regardless of status, checks the feedback-loop block and exits after 10 seconds (with feedback enabled: after 180).

**Checked:** unit tests (text with empty fields and length limit, selection, done message exactly once, loop protection, rate limit, retries, refusal to start with a chat outside the allowlist, notifier off by default; Supabase via fake fetch) and the dry run against the real Supabase.

**Real run on 14 Nov 2026:** a trial warning via `npm run warn-probe` arrived in the test group (text from a resolved signal of the fictional project). `sendMessage` returned the message ID, the own message came back via `messages.upsert` and was recognized by ID and not forwarded to the Ablage. **Not checked:** the notifier in continuous operation with a newly created signal (the Übersetzer has to run for that), the done message, the throttle under load.

## Feedback on warnings (learning loop, first part)

Whoever rates a warning in the warn chat as **berechtigt** (justified) or **Fehlalarm** (false alarm) has their verdict stored on the signal. The Prüf-Agent can use it on its next run. This second part (evaluating the ratings in the Prüf-Agent) is **not** part of this service.

**Off by default.** Switch on in `.env`:

```
WHATSAPP_WARNEN=1
WHATSAPP_WARN_CHAT=<Chat>
WHATSAPP_CHATS=<derselbe Chat>
WHATSAPP_BEWERTEN=1
```

`WHATSAPP_BEWERTEN=1` without `WHATSAPP_WARNEN=1` is refused: the service does not start and says why. With `WHATSAPP_BEWERTEN_BESTAETIGEN=0` the confirmation in the chat is omitted (default 1). If the switch is off, nothing new is written, neither to Supabase nor to `zustand/melder.json`.

**How to rate** (only in the warn chat):

| Form | Example | Applies to |
|---|---|---|
| Reaction to the warning | 👍 or ✅ = berechtigt, 👎 or ❌ = Fehlalarm (removing a reaction is ignored) | this warning |
| Reply (quote) to the warning, word anywhere in the text | „Das war ein Fehlalarm, Plan C liegt vor“ | the quoted warning |
| Short message without quote (at most 80 characters), starts with the word, up to 10 minutes after the last warning | „Stimmt“ | the most recent warning |

Words (whole words, case-insensitive): Fehlalarm = `fehlalarm`, `falscher alarm`, `stimmt nicht`, `falsch`. Berechtigt = `stimmt`, `richtig`, `korrekt`, `passt`. Negating forms first: `stimmt nicht` is never "stimmt". Addition beyond the brief: if `nicht`, `kein`, `keine`, `keinen` or `nie` occurs and no Fehlalarm word, the message does not count as a rating at all (e.g. "passt nicht"), so that the opposite is never stored. Your account's own messages count, messages of the notifier (warning, done, confirmation) never do. The message itself is forwarded to the Ablage like any other; reactions remain unforwarded.

**What is written where.** Exactly one `PATCH` per rating on `signale?id=eq.<id>` with only two columns:

```
{"bewertung": "berechtigt" | "fehlalarm", "bewertung_notiz": "per WhatsApp, <Name>, <Zeit>: <Text bis 200 Zeichen oder Emoji>"}
```

The allowed values come from `uebersetzer/schema.sql` (`check (bewertung in ('berechtigt','fehlalarm'))`). `status` is never touched. No phone numbers in the note. A later rating of the same signal overwrites the earlier one. Failed writes are retried twice, then logged and given up. After that a short confirmation in the chat: `✅ SiteTwin: Rückmeldung gespeichert (Fehlalarm) – <Titel>`, via the same send path and the same rate limit as the warnings. Locally, `zustand/melder.json` additionally remembers which message ID belongs to which signal (`warnungen`; old files without the field still load). One log line per rating (signal ID shortened, verdict, form), no chat texts.

**This is the only place where this service writes to Supabase.** The key must be allowed to write for that (the service key is).

**Limit of the prototype:** every person in the warn chat can rate. It is not checked who is allowed to decide.

`npm run warn-test` additionally shows how many signals of the project already have a `bewertung` (read-only), and whether feedback is on. With feedback switched on, `npm run warn-probe` waits 180 instead of 10 seconds, remembers message and signal of the trial warning in the process and really writes a rating of the trial into the signal (caution: this is the real signal the trial text was built from).

**Checked:** unit tests without network with fake fetch (all three forms, word order, non-ratings, foreign chat, the notifier's own messages, removed reaction, 10-minute window, PATCH structure, overwriting, off by default, refusal without notifier, old state).

**Real run on 14 Nov 2026:** a trial warning in the test group was reacted to with 👎 from the phone. The reaction arrived via `messages.upsert`, was matched to the warning and stored on the signal as `fehlalarm` (looked up in Supabase), the confirmation arrived in the chat and was neither read as a rating nor forwarded to the Ablage. **Not checked:** rating by reply and by short message, rating by other participants, overwriting by a second rating. The ratings are not yet used in the Prüf-Agent.

## What is stored

- In **Supabase** (`quellen`, bucket `ablage`): sender, number, message text, attachments and time of the allowed chats. Everything in `quellen` can be read by the Übersetzer and sent to Claude, so do not allow private chats.
- Locally in `auth\`: the **credentials of the WhatsApp session**. Whoever has the folder can read along in the session. It is in `.gitignore` and must never be committed or passed on. `qr.png` is there as well.
- No messages locally, no log of the texts (only a 40-character preview of allowed chats in the terminal).

## Unlinking again

1. On the phone: WhatsApp → Settings → Linked devices → tap the device ("Chrome (macOS)") → Log out.
2. Stop the service (Ctrl+C) and delete the folder `auth\`: `Remove-Item -Recurse -Force auth`.

If the device is removed on the phone, the running service logs out with a clear message and exits.

## Tests

```powershell
npm test
```

Node test runner, no network, 57 tests (21 Mitleser, 16 notifier, 20 feedback): mapping of hand-built Baileys messages (group text, extended text, image with caption, voice message, document, own message, reaction, protocol, status, sticker, LID sender, individual chat), allowlist logic, retries when sending, configuration. The mapping lives in `mapping.js` (pure, without socket).

**Checked:** these tests; the start without a session gets as far as the QR code (the connection to WhatsApp with the installed version works); a test request from the mapping (text only, fictional) was accepted by the running Ablage with `neu: 1`, a second identical one with `duplikate: 1`.

**Real run on 14 Nov 2026** (own account as linked device, a test group created specifically for this, project "Test Santino"): linking via QR code, group list and allowing via JID worked. Three own messages from the phone arrived and are in `quellen`: text, photo with caption (`.jpg` in the bucket) and voice message (`.ogg`, without transcript, because no `TRANSKRIPT_API_KEY` was set). The sender was resolved with name and number. A dropped connection (code 428) was restored by the service on its own after 14 seconds.

**Not checked:** messages from other participants, documents and videos, linking via code instead of QR, allowing via group name, logging out from the phone, operation over a longer period and in large groups. Version: `baileys` 7.0.0-rc14 (release candidate, the version listed as `latest`; the 6.x line is marked as `legacy`).

## Files

```
index.js     Verbindung, Login, Ereignisse, Medien-Download
mapping.js   Nachricht -> Anfrage, Allowlist (rein)
forward.js   POST mit Wiederholungen
config.js    Umgebung und .env
bewertung.js Rückmeldung: Bewertung erkennen, PATCH auf signale (rein, ohne Baileys)
melder.js    Warnungen: Auswahl, Text, Rate-Limit, Schleifenschutz, Zustand (rein, ohne Baileys)
warn-test.js Trockenlauf des Melders ohne WhatsApp; `npm run warn-probe` sendet eine Test-Warnung
zustand/     Stand des Melders (git-ignoriert)
test/        Node-Tests und Fixtures (alles erfunden)
```
