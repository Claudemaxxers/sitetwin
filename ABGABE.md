# Written submission (draft)

Draft for the submission form. Items in [square brackets] still need a decision or a link from the team.

## Title

SiteTwin

## One-line pitch

SiteTwin reads the WhatsApp groups, mails and drawings a building site already uses, keeps one record of what changed and who decided it, and warns the site manager before a crew builds on an outdated plan.

## Team and members

Team Claudemaxxers, Talona track (Track 01, Context for the Physical World).

| Member | Part |
|---|---|
| Santino Schrader | Ablage: ingest layer for WhatsApp, mail, Drive and calls; test data |
| Hendrik Boettcher | Database, Übersetzer (structuring with Claude), Prüf-Agent (checking agent) |
| Melih Kurtulmus | First prototype; phone agent |
| Maximilian Dieringer | Concept, web app (digital twin) |

## Problem

On a residential building site, changes travel through group chats, mail threads and a shared folder. A planner sends a new drawing index by mail, the electrician hears about it on Monday, and the drywall crew closes the wall on Saturday. Nobody did anything wrong, and the wall still has to be opened again. Rework like this costs small and mid-size general contractors money and days, and it happens because no one has the whole picture at the moment it matters: what is the valid plan, what has been done, what is about to be done, and who is waiting on whom.

Existing tools ask crews to enter data into yet another app. They do not, so the record stays incomplete.

## Solution overview

SiteTwin docks onto the channels the site already uses. Nobody changes how they work.

1. **Ablage (ingest).** WhatsApp messages with photos and voice notes, mails with attachments, files from a Drive folder and call transcripts are stored unchanged as raw sources. Each source keeps a content hash, so the same message arriving twice is stored once and every later statement can be traced back to its source.
2. **Übersetzer (structuring).** Claude turns each new source into structured entries: what, where (unit, room, component), who, when, which drawing index, who decided, what waits on whom. New drawing indices and the components they contain are recorded as the planned state.
3. **Prüf-Agent (checking).** Every new entry is checked against the valid plan. Fixed rules raise a signal for work after an outdated drawing index, a wall closed or announced to be closed before the installation behind it is done, work on a component the valid drawing no longer contains, and unclear messages. A signal names who has to act and carries the text for the call. A later message that reports the fix resolves the signal.
4. **Web app.** The office sees every project live: detected changes with their sources, the inbox of raw messages, the daily log, the record, open signals, and an "Ask" field that answers questions only from the record.

What ran for real, and what did not:

- A WhatsApp message, a photo with caption and a voice note from a real phone arrived in the database through the linked-device reader. A mail from Gmail and a file from Google Drive arrived through n8n. Each of these was a run triggered by hand; a second run of each was recognised as a duplicate. Whether a new mail or file arrives on its own through the activated n8n flows is not checked.
- A warning for a signal was posted into the WhatsApp group from the linked account, once, as a test built from an existing signal. A signal that is reopened gets a new warning; that part is covered by tests only. [After the rehearsal, state here whether a new WhatsApp message triggers signal and warning end to end, and how long it takes.]
- The fixed rules of the Prüf-Agent ran on the test data. Its optional Claude stage is tested with fake answers only.
- All site data is fictional (project "BV Simmering"); photos and voice files in the test data are placeholders.
- Phone agent: for each open signal it calls the responsible person through ElevenLabs and Twilio, sets the signal to in progress and feeds the call transcript back into the chain. It is merged and covered by tests with fake responses. [State here whether a real call was placed, and to whom.]
- Learning loop: a thumbs up or down (or a reply) on a warning in the WhatsApp group is stored on the signal as justified or false alarm; this ran once for real. The checking agent reads these ratings: a situation rated as a false alarm is not raised again at full severity, it comes back as a downgraded follow-up signal that says so, and the last ten ratings go into the prompt of its Claude stage. This part is tested against a rebuilt database and has not run live. [Update after the rehearsal if it has.] The first prototype downgrades flag types the superintendent keeps approving.
- The WhatsApp reader uses an unofficial library and is a prototype. The official route (Twilio webhook) is built and tested, but has not run against a real Twilio account.
- Numbers in the web app for progress and extra cost are derived from reported messages and, in part, from demo estimates. They are not measurements.

## Tech stack

- **Ingest:** Python 3.11+, FastAPI, pypdf; n8n for Gmail and Google Drive; Node.js with Baileys for the WhatsApp reader; Twilio webhook; OpenAI-compatible speech-to-text interface for voice notes
- **Data:** Supabase (Postgres and Storage)
- **Structuring and checking:** Python, Anthropic API (Claude Haiku 5.5 with structured output for structuring, Claude Opus 5.5 for the "Ask" field)
- **Web app:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, three.js with react-three-fiber
- **Tests:** pytest, Vitest, Node test runner

## Links

- Repository: https://github.com/Claudemaxxers/sitetwin (private, as required for the Talona track) [confirm with the organisers where it has to live]
- Demo video: [link]
- Live link: none
- Pitch deck: [link, optional]
