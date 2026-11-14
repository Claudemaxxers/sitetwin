# n8n: Gmail and Google Drive to the Ablage

> **Status 14 Nov 2026:** Both workflows were imported into an n8n Cloud instance, all fields arrived correctly. The Drive workflow ran there once by hand: test PDF in the folder → Ablage reports `neu: 1`, the PDF text is in `quellen`. Continuous operation (activated, polling every minute) is untested for both.
>
> **Gmail workflow rebuilt and run once against n8n Cloud on 14 Nov 2026** (triggered by hand, fictional test mail without attachment, response of the Ablage `neu: 1`, row seen in Supabase). Open: mail with attachment, second run as duplicate, hash cross-check with `.eml`, continuous operation. The first version fetched the raw mail via an HTTP Request node and aborted on n8n Cloud: "This credential is configured to prevent use within an HTTP Request or GraphQL node". The Google sign-in managed by n8n Cloud ("Sign in with Google") must not be used in HTTP Request nodes. The new version no longer needs a raw mail: the Gmail Trigger delivers the mail split up (fields and attachments), a Code node packs it, the Ablage accepts it via `POST /import/email/gmail-felder` (`../SPEC.md` §7.10). This is checked in tests with rebuilt n8n items (see "First real run"). The old endpoint `POST /import/email/gmail` stays in place in case a custom Google OAuth app does allow the raw mail later.

The two files here pass real input on to the Ablage without anyone changing how they work: mails with a specific Gmail label and files from a specific Google Drive folder. The Google sign-in lives entirely in n8n. The Ablage only receives finished data via `POST /import/email/gmail-felder` and `POST /import/drive/datei` (contract: `../SPEC.md` §7.10 and §7.8) and detects repetitions itself.

| File | Workflow |
|---|---|
| `gmail_zu_ablage.json` | Gmail Trigger (every minute, label only, "Simplify" off, load attachments) → Code node „Mail für Ablage aufbereiten“ → Konfiguration → `POST /import/email/gmail-felder` |
| `drive_zu_ablage.json` | two Drive Triggers (new and changed files, one folder) → Konfiguration → Datei herunterladen → `POST /import/drive/datei` |

For tests leave `projekt` at `Test Santino`, so that nothing lands in the demo project `BV Simmering`.

## Prerequisites

1. The Ablage API is running: in the folder `ablage`, `.venv\Scripts\python -m uvicorn ablage.api:app --port 8000`.
2. The API is publicly reachable, because n8n Cloud cannot access `localhost`, e.g. with `cloudflared tunnel --url http://localhost:8000` (needs no account) or `ngrok http 8000`. The `https://…` address shown is later `ablage_url`.
3. Set `ABLAGE_IMPORT_TOKEN` in `ablage/.env` to a long random value and restart uvicorn. The tunnel is open to the internet; without a token anyone who knows the address could write data into the Ablage.
4. Create a label in Gmail, e.g. `SiteTwin`, and a Gmail filter that sets this label **on arrival** (e.g. for certain senders or for a plus address like `name+sitetwin@…`). Mails that only get a label by hand later are not seen by the trigger (see Limits).
5. A folder in Google Drive whose files should go into the Ablage.

## Setup in n8n

**1. Create three credentials** ("Credentials" on the left → "Add credential"). Ideally before the import, then n8n inserts them into the Gmail and Drive nodes itself.

| Name (suggestion) | Type in n8n | Content |
|---|---|---|
| `Gmail SiteTwin` | Gmail OAuth2 API | "Sign in with Google", the mailbox with the label |
| `Google Drive SiteTwin` | Google Drive OAuth2 API | "Sign in with Google", the account with the folder |
| `Ablage Token` | Header Auth | Name: `X-Ablage-Token`, Value: the same value as `ABLAGE_IMPORT_TOKEN` |

**2. Import the workflows:** open a new workflow → menu "…" top right → "Import from File…" → choose `gmail_zu_ablage.json`. For `drive_zu_ablage.json` create a second workflow and import the same way. If you have already imported the old Gmail version (with „Mail im Rohformat holen“): deactivate or delete that workflow and import the new file as a new workflow, otherwise both run.

**3. Assign credentials.** n8n does not carry over credential references from other instances on import. Every node with a warning symbol needs the matching credential:
- Gmail: only „Gmail: Mail mit Label“ → `Gmail SiteTwin`. No other node needs Google access.
- Drive: „Drive: neue Datei“, „Drive: geänderte Datei“, „Datei herunterladen“ → `Google Drive SiteTwin`
- both: „An Ablage senden“ → `Ablage Token`. n8n never sets the HTTP Request nodes automatically, always choose by hand here.

**4. Choose label or folder.**
- Gmail: node „Gmail: Mail mit Label“ → Filters → Search: is set to `label:sitetwin`. Adjust for a different label name (lowercase is enough; spaces and `/` in the name become `-` in the Gmail search, `Bau/SiteTwin` becomes `label:bau-sitetwin`). Alternatively clear the search field and choose the label from the list under "Label Names or IDs". In the same node "Simplify" must be **off** and under Options "Download Attachments" **on** (that is how it is in the file). With "Simplify" on, only a shortened `snippet` arrives instead of the text; the Ablage then replies with 422.
- Drive: in **both** triggers choose the same folder from the list under "Folder" (or switch the selector next to it to "Link" and paste the folder link from the browser).

**5. Adjust the configuration.** Open the node „Konfiguration“, this is the only place with settings:
- `ablage_url`: tunnel address without path, e.g. `https://abcd-1234.ngrok-free.app`
- `projekt`: for tests `Test Santino`. Do not leave empty: without a value the Ablage takes `DEFAULT_PROJEKT` from its `.env`, so possibly `BV Simmering`
- Drive only: `kanal` (default `Google Drive`), `ordner_praefix` (default empty; when set it is put in front of the file name, e.g. `Plaene` results in `pfad = Plaene/Plan_E-05.pdf`)

**6. Run once by hand:** "Execute workflow". In the test run the Gmail Trigger fetches the newest mail with the label, the Drive Trigger the newest file in the folder, regardless of the time. If there is no matching mail or file, the trigger aborts with a notice.

**7. Activate:** save the workflow and activate it top right (in newer n8n versions "Publish"). From then on n8n polls every minute. Mails and files from **before** the activation are not caught up on.

## Checking whether it arrived

- Open the node „An Ablage senden“ in n8n. The response of the Ablage looks like this: `{"gelesen": 1, "neu": 1, "duplikate": 0, "fehler": []}`. For mails with attachments `gelesen` is larger, because every attachment is a row of its own.
- A second run with the same mail or file results in `neu: 0, duplikate: 1`. That is intended.
- In the Ablage: `.venv\Scripts\python -m ablage zeige --projekt "Test Santino"`
- Response `401`: the token in the credential `Ablage Token` does not match `ABLAGE_IMPORT_TOKEN`, or the header name is not exactly `X-Ablage-Token`.
- Response `422`: the Ablage could not use the mail; the text says what is missing (see "First real run").
- Failed runs are listed in n8n under "Executions" and can be re-run there. „An Ablage senden“ tries three times itself beforehand, 5 seconds apart.

## How it works

- **Gmail:** The Gmail Trigger delivers the mail only split up, not as the original: with "Simplify" off the item contains `subject`, `text`, `html`, `date`, `messageId`, `from`/`to`/`cc` and the header lines under `headers`, the attachments hang on the item as binary data `attachment_0`, `attachment_1`, …. The Code node „Mail für Ablage aufbereiten“ reads every attachment with `this.helpers.getBinaryDataBuffer` (n8n Cloud keeps binary data outside the item, `binary[…].data` is not reliable there), encodes it as base64 and builds `{mail, anhaenge}`. „Konfiguration“ adds `ablage_url` and `projekt`, „An Ablage senden“ sends `{projekt, mail, anhaenge}` as JSON to `/import/email/gmail-felder`.
- The Ablage builds the same rows from it as with the `.eml` import: the header lines from `headers` run through the same Python parser, body and attachments go into the same function (`eml.items`). If `headers` is missing, it takes the individual fields. The same mail as `.eml`, via the old raw path and via this path results in the same `content_hash`, so no second row. `meta.gmail_weg = "felder"` shows via which path a row came.
- **Drive:** „Datei herunterladen“ downloads normal files unchanged. Google's own formats have no file bytes and are converted on download: Docs, Slides and Drawings to PDF, Sheets to CSV. The name in Drive then has no extension; the workflow appends it for `pfad` (`.pdf` or `.csv`), so that the Ablage recognizes the type and can extract text. A `/` in the file name becomes `_`.
- New files often fire both Drive Triggers. The Ablage then receives the file twice and counts the second arrival as a duplicate.

## Limits

- **Polling instead of real time:** n8n polls every minute. A mail or file arrives with a delay of up to about a minute, with many mails per minute spread over several passes (at most 10 mails per pass).
- **Label on arrival:** The Gmail Trigger only looks for mails that have arrived since the last pass. Adding the label to an older mail afterwards triggers nothing. The label must be set by a Gmail filter on arrival.
- **Only one folder, no subfolders:** The Drive Triggers only watch files directly in the chosen folder. Files in subfolders trigger nothing (according to the n8n source code, the search only queries direct children of the folder).
- **Google formats:** Sheets arrive as CSV, so only the first sheet. Google limits the export of converted files to about 10 MB. Forms, shortcuts and other Google types cannot be exported this way; the run then fails for that file.
- **Changed files:** Every change with new content becomes a new row in the Ablage (identity is path + content). If a file is renamed in Drive, a new row is created as well.
- **Large mails:** The mail goes to the Ablage with all attachments as base64 in one JSON. With very large attachments (above about 20 MB) n8n Cloud can hit its memory limit.
- **Same hash only if n8n delivers the same text.** The hash of the mail row is made from sender, To address, timestamp and `Betreff + Body`. Sender, address, time and subject come from the raw header lines and are therefore the same. n8n reads the body with mailparser, the Ablage with Python on `.eml` import. The Ablage evens out line endings and whitespace at the beginning and end; in these cases the text can still differ and a second row is created if the same mail is also imported as `.eml`:
  - pure HTML mail without a text part that does not come as a single `text/html` part (e.g. `multipart/alternative` with HTML only): mailparser generates a text of its own, the Ablage takes it instead of its HTML-to-text path;
  - mails with `format=flowed` (mailparser joins wrapped lines, Python does not) or with several text parts (mailparser concatenates them, Python takes the first).
  Attachment rows depend only on the file content and are not affected by this. Embedded images (`cid:`) in `multipart/related` are delivered by n8n as attachments, by the `.eml` import depending on the structure not; then there are additional attachment rows on the n8n path.
- **Text in the mail row:** This path always stores line endings in the body as `\n`. With the `.eml` import they stay as they are in the file (in the test data also `\n`). The hash is not affected by this.

## First real run

**Result of 14 Nov 2026** (n8n Cloud, one run by hand, fictional test mail without attachment, project "Test Santino"): all four nodes ran without any change to the imported workflow, response of the Ablage `{"gelesen":1,"neu":1,"duplikate":0,"fehler":[]}`. The trigger's item had the fields `id, threadId, labelIds, sizeEstimate, headers, html, text, textAsHtml, subject, date, to, from, messageId`; `headers` is an object with lowercase keys and values including the header name (`"subject": "Subject: =?UTF-8?Q?…?="`, `"message-id": "Message-Id: <…>"`), `from`/`to` have `value`, `html`, `text`. Point 1 of the list below is thereby confirmed. **Not checked:** points 2 and 3 (attachments), the second run from point 4 and the cross-check from point 5.

The shape of the n8n item was derived from the n8n source code (`parseRawEmail` in the Gmail node, mailparser). The tests (`../tests/test_gmail_felder.py`) rebuild the item from the six `.eml` files in `fake_data/email/` and check that rows and hashes are the same as with the `.eml` import. On the first run in n8n, check:

1. In the trigger output (tab "JSON") there is `headers` with entries like `"subject": "Subject: …"`, plus `text`, `date` (ISO), `messageId` with angle brackets, `from`/`to` as `{value: [{address, name}], text}` and `id`. If `headers` is missing, it goes via the individual fields; that is tested as well.
2. In the trigger's tab "Binary" the attachments are listed as `attachment_0`, … with file name and MIME type.
3. In the Code node `anhaenge` has as many entries as the mail has attachments, `base64` is not empty.
4. Response of the Ablage `{"gelesen": 1 + number of attachments, "neu": …}`; second run with the same mail `neu: 0`.
5. Hash cross-check: download the same mail in Gmail as `.eml` ("Show original" → "Download original") and import it with `python -m ablage import email <datei> --projekt "Test Santino"`. Expected: `neu: 0`. If a new mail row appears, the body differs (see Limits).

What a 422 response says (shown in n8n in the error of „An Ablage senden“):
- `Mail kommt vereinfacht an (nur snippet …)`: "Simplify" in the trigger is on.
- `from und date fehlen … Gefundene Felder: …`: the item has a different shape than expected; the list of found fields shows which.
- `messageId … und Gmail-id fehlen beide`: neither `messageId` nor `headers["message-id"]` nor `id` in the item.
- `mail fehlt oder ist kein JSON-Objekt` or Pydantic errors about `mail`: the body of „An Ablage senden“ is not `{projekt, mail, anhaenge}`.
- `anhaenge[n].base64 (<Name>) ist kein gültiges base64url`: the Code node did not read an attachment correctly.
- **Voice messages are not transcribed.** Audio attachments or audio files from Drive arrive as a file with empty `text`.
- **Tunnel:** If the tunnel address changes (with free ngrok after every restart), `ablage_url` must be entered again in both workflows. As long as the Ablage is not reachable, the runs fail; they can be repeated under "Executions".
