# WhatsApp-Mitleser

Kleiner Node-Dienst, der im **eigenen** WhatsApp als gekoppeltes Gerät mitliest (wie WhatsApp Web) und neue Nachrichten aus ausgewählten Chats an die Ablage schickt (`POST /import/whatsapp/nachricht`, SPEC §7.5). Damit landen echte Baustellen-Chats live in `quellen`, ohne dass jemand seine Arbeitsweise ändert.

## Wichtig vorab

- **Inoffiziell.** Gebaut mit Baileys, einer nicht von WhatsApp stammenden Bibliothek. Das ist **nicht** die WhatsApp Business API.
- **Verstößt gegen die Nutzungsbedingungen von WhatsApp.** Es besteht das Risiko, dass die Nummer eingeschränkt oder gesperrt wird. Deshalb nur mit einer Testnummer oder einem Testchat und nur als **Prototyp**.
- Der offizielle Weg bleibt Twilio (`POST /import/whatsapp/twilio`, siehe `../README.md`).
- Standardmäßig nur lesen (Melder aus): der Dienst sendet keine Nachrichten, keine Lesebestätigungen und erscheint nicht als „online“. Die Bibliothek bestätigt den Empfang auf Protokollebene (Zustellung, wie jedes gekoppelte Gerät); das lässt sich nicht abschalten.

## Setup (Windows, PowerShell, Node 20.12 oder neuer)

```powershell
cd ablage\whatsapp-mitleser
npm install
copy .env.example .env
```

1. **Ablage starten** (anderes Fenster, in `ablage\`): `.venv\Scripts\python -m uvicorn ablage.api:app --port 8000`. Zum Test: `curl.exe localhost:8000/health`.
2. **Koppeln und Chats ansehen:**
   ```powershell
   npm run chats
   ```
   Beim ersten Mal erscheint ein QR-Code im Terminal (zusätzlich als Bild `auth\qr.png`). Am Handy: WhatsApp → Einstellungen → Verknüpfte Geräte → Gerät verknüpfen → scannen. Danach listet der Befehl alle Gruppen mit Name und JID und beendet sich.
   Lieber per Code statt QR: in `.env` `WHATSAPP_NUMMER=<Nummer mit Landesvorwahl, nur Ziffern>` setzen; es wird ein Kopplungscode ausgegeben, den man in WhatsApp unter „Stattdessen mit Telefonnummer verknüpfen“ eingibt.
3. **Chat auswählen:** in `.env` bei `WHATSAPP_CHATS` den Gruppennamen (exakt, Groß/Klein egal) oder die JID eintragen, mehrere durch Komma. Einzelchats nur per Nummer (`+43…`) oder JID.
4. **Mitlesen starten:**
   ```powershell
   npm start
   ```
   Pro weitergereichter Nachricht eine Zeile: Chat, Absender, Typ, die ersten 40 Zeichen, Antwort der Ablage (`neu` / `duplikate`). Prüfen in `ablage\`: `.venv\Scripts\python -m ablage zeige --projekt "Test Santino"`.

Einstellungen (`.env`, Vorlage `.env.example`): `ABLAGE_URL` (Standard `http://localhost:8000`), `ABLAGE_PROJEKT` (Standard `Test Santino`), `WHATSAPP_CHATS`, `WHATSAPP_NUMMER`, `WHATSAPP_MAX_MB` (Standard 20). Einen Token braucht dieser Endpunkt nicht; er prüft keinen.

## Was weitergereicht wird

- **Nur Chats auf der Allowlist.** Ist `WHATSAPP_CHATS` leer, geht **nichts** raus. Nachrichten anderer Chats werden weder weitergereicht noch geloggt.
- Nur Nachrichten, die nach dem Start live eintreffen, kein Verlauf. Eigene Nachrichten sind dabei (zum Testen: selbst in die Gruppe schreiben).
- Nicht weitergereicht: Reaktionen, Protokoll-/Systemnachrichten (z. B. gelöscht, bearbeitet), Status, Broadcasts, Kanäle, Sticker und alles ohne Text oder unterstützten Anhang.

Abbildung auf den Endpunkt:

| Feld | Inhalt |
|---|---|
| `absender` | Anzeigename (Push-Name) plus Nummer, z. B. `Name (+43…)`, wo bekannt |
| `kanal` | Gruppenname, im Einzelchat der Name des Gegenübers |
| `zeitpunkt` | Zeitstempel der Nachricht (ISO, UTC) |
| `text` | Text, erweiterter Text oder Beschriftung von Bild, Video, Dokument |
| `wa_id` | Nachrichten-ID von WhatsApp (Identität, doppelte Zustellung ergibt `duplikate`) |
| `projekt` | `ABLAGE_PROJEKT` |
| `anhang` | Bild, Video, Sprachnachricht, Dokument als `{mimetype, dateiname, base64}` im JSON-Body |

Sprachnachrichten gehen als `<id>.ogg` mit leerem Text raus; die Ablage transkribiert sie, wenn dort `TRANSKRIPT_API_KEY` gesetzt ist (SPEC §7.9). Medien über `WHATSAPP_MAX_MB` oder mit fehlgeschlagenem Download werden ohne Anhang gespeichert (nur der Text, falls vorhanden). Schlägt der POST fehl, gibt es drei Wiederholungen mit Wartezeit, dann wird die Nachricht verworfen und im Log vermerkt (kein Zwischenspeicher: war die Ablage in der Zeit aus, fehlt die Nachricht).

## Warnung in den Chat (Melder, optional)

Neu: Der Dienst kann zusätzlich eine Warnung in **einen** WhatsApp-Chat schicken, wenn der Prüf-Agent ein Signal anlegt (Tabelle `signale`, Status `offen`). Prozess laut KONZEPT: Signal, Zuständiger wird informiert, Behebung gemeldet, erledigt.

**Aus per Standard.** Ohne `WHATSAPP_WARNEN=1` verhält sich der Dienst exakt wie vorher (nur lesen). Zum Einschalten in `.env`:

```
WHATSAPP_WARNEN=1
WHATSAPP_WARN_CHAT=<JID oder exakter Gruppenname>
WHATSAPP_CHATS=<muss denselben Chat enthalten, gleiche Schreibweise>
```

Alle Einstellungen: `WHATSAPP_WARN_AB` (nur Signale ab diesem ISO-Zeitpunkt, Standard Startzeit des Dienstes, damit ein Neustart nie alte Signale in den Chat kippt), `WHATSAPP_WARN_ERLEDIGT` (Standard 1), `WARN_INTERVALL_S` (Standard 5), `WARN_MAX_PRO_10MIN` (Standard 6), `SUPABASE_URL` und `SUPABASE_SERVICE_KEY` (aus dieser `.env`, sonst aus `../.env`; aus der Ablage-`.env` werden nur diese zwei Werte gelesen). Das Projekt ist `ABLAGE_PROJEKT`.

**Ablauf.** Alle `WARN_INTERVALL_S` Sekunden werden die offenen Signale des Projekts gelesen (nur `GET`, der Melder schreibt nie in Supabase). Jedes Signal mit `erstellt_am >= WHATSAPP_WARN_AB` bekommt genau eine Warnung. Wird ein gemeldetes Signal später `geloest`, folgt einmal `✅ SiteTwin: erledigt – <Titel>`. Der Stand (gemeldete Signal-IDs, IDs gesendeter Nachrichten) liegt in `zustand/melder.json` (git-ignoriert, nicht in `auth/`), damit ein Neustart nichts wiederholt.

Genutzte Spalten von `signale`: `id`, `projekt`, `status`, `erstellt_am`, `titel`, `schwere`, `top`, `raum`, `element`, `anruf_text` (ersatzweise `begruendung`), `zustaendig`. `telefon` wird nie gelesen oder gesendet. Beispieltext:

```
⚠️ SiteTwin-Warnung (automatisch)
<Titel> (kritisch)
Wo: <Top>, <Raum>, <Element>
<anruf_text>
Zuständig: <Name>
```

Leere Felder entfallen, Rufnummern werden aus dem Text entfernt, Obergrenze 700 Zeichen. Hinweis: `anruf_text` ist für den Telefon-Agenten formuliert und klingt im Chat manchmal wie gesprochen.

**Sicherheitsregeln**
- Aus per Standard, nur mit `WHATSAPP_WARNEN=1`.
- Gesendet wird **nur** an `WHATSAPP_WARN_CHAT`, und der muss auf der Allowlist `WHATSAPP_CHATS` stehen. Sonst bricht der Dienst beim Start mit einer klaren Meldung ab.
- **Nie** an Nummern oder Namen aus der Datenbank (`telefon`, `zustaendig`). Die Testdaten sind fiktiv, die Nummern könnten echten Personen gehören. Die zuständige Person steht nur als Name im Text.
- **Keine Rückkopplung.** Der Mitleser liest auch eigene Nachrichten. Vom Melder gesendete Nachrichten werden nie an die Ablage weitergereicht: Erkennung über die gemerkten Nachrichten-IDs und zusätzlich über die festen Textanfänge `⚠️ SiteTwin-Warnung` und `✅ SiteTwin:`. Normale eigene Nachrichten gehen weiter wie bisher.
- **Rate-Limit.** Höchstens eine Nachricht alle 3 Sekunden und `WARN_MAX_PRO_10MIN` je 10 Minuten. Darüber hinaus wird verworfen und geloggt (bis zum nächsten Start, nicht in eine Warteschlange). Ein fehlgeschlagener Versand wird beim nächsten Abruf höchstens 3 Mal wiederholt.
- **Absender ist das verknüpfte Konto**: die Warnung kommt von der eigenen Nummer, mit der der Dienst gekoppelt ist, nicht von einem Bot-Konto. Das ist weiterhin inoffiziell (Baileys) und erhöht das Sperrrisiko. Nur in eine Testgruppe senden.
- Pro gesendeter Warnung eine Logzeile (Signal-ID gekürzt, die ersten 40 Zeichen).

**Trockenlauf ohne WhatsApp:** `npm run warn-test` liest Supabase (nur lesen), zeigt Spaltennamen, Zahl der offenen Signale und den Text der bis zu 5 neuesten offenen Signale (ohne Rücksicht auf `WHATSAPP_WARN_AB`). Es öffnet keinen WhatsApp-Socket. Anderes Projekt: `$env:ABLAGE_PROJEKT="BV Simmering"; npm run warn-test`.

**Geprüft:** Unit-Tests (Text mit leeren Feldern und Längengrenze, Auswahl, Erledigt-Meldung genau einmal, Schleifenschutz, Rate-Limit, Wiederholungen, Start-Verweigerung bei Chat außerhalb der Allowlist, Melder aus per Standard; Supabase per Fake-Fetch) und der Trockenlauf gegen die echte Supabase. **Nicht geprüft:** ein echter Versand über `sock.sendMessage`. Offen bleibt, ob die Antwort von `sendMessage` die Nachrichten-ID in `key.id` liefert (der Textanfang fängt es sonst ab) und ob Warnungen im Chat wie erwartet ankommen.

## Was gespeichert wird

- In **Supabase** (`quellen`, Bucket `ablage`) landen Absender, Nummer, Nachrichtentext, Anhänge und Zeit der erlaubten Chats. Alles in `quellen` kann der Übersetzer lesen und an Claude schicken, also keine privaten Chats freigeben.
- Lokal in `auth\` die **Zugangsdaten der WhatsApp-Sitzung**. Wer den Ordner hat, kann in der Sitzung mitlesen. Er steht in `.gitignore` und darf nie committet oder weitergegeben werden. Dort liegt auch `qr.png`.
- Keine Nachrichten lokal, kein Log der Texte (nur 40 Zeichen Vorschau erlaubter Chats im Terminal).

## Wieder abmelden

1. Am Handy: WhatsApp → Einstellungen → Verknüpfte Geräte → das Gerät („Chrome (macOS)“) antippen → Abmelden.
2. Dienst beenden (Strg+C) und den Ordner `auth\` löschen: `Remove-Item -Recurse -Force auth`.

Wird das Gerät am Handy entfernt, meldet sich der laufende Dienst mit einer klaren Meldung ab und beendet sich.

## Tests

```powershell
npm test
```

Node-Testrunner, kein Netz, 37 Tests (21 Mitleser, 16 Melder): Abbildung handgebauter Baileys-Nachrichten (Gruppentext, erweiterter Text, Bild mit Beschriftung, Sprachnachricht, Dokument, eigene Nachricht, Reaktion, Protokoll, Status, Sticker, LID-Absender, Einzelchat), Allowlist-Logik, Wiederholungen beim Senden, Konfiguration. Die Abbildung steckt in `mapping.js` (rein, ohne Socket).

**Geprüft:** diese Tests; der Start ohne Sitzung kommt bis zum QR-Code (Verbindung zu WhatsApp mit der installierten Version steht); ein Testrequest aus der Abbildung (nur Text, fiktiv) wurde von der laufenden Ablage mit `neu: 1` angenommen, ein zweiter identischer mit `duplikate: 1`.

**Echter Lauf am 14.11.2026** (eigenes Konto als gekoppeltes Gerät, eine eigens angelegte Testgruppe, Projekt „Test Santino“): Kopplung per QR-Code, Gruppenliste und Freigabe per JID haben funktioniert. Drei eigene Nachrichten vom Handy kamen an und stehen in `quellen`: Text, Foto mit Bildunterschrift (`.jpg` im Bucket) und Sprachnachricht (`.ogg`, ohne Transkript, weil kein `TRANSKRIPT_API_KEY` gesetzt war). Der Absender wurde mit Name und Nummer aufgelöst. Eine abgebrochene Verbindung (Code 428) hat der Dienst nach 14 Sekunden von selbst wiederhergestellt.

**Nicht geprüft:** Nachrichten anderer Teilnehmer, Dokumente und Videos, Kopplung per Code statt QR, Freigabe per Gruppenname, Abmeldung vom Handy aus, Betrieb über längere Zeit und in großen Gruppen. Version: `baileys` 7.0.0-rc14 (Release Candidate, die als `latest` geführte Version; die Linie 6.x ist als `legacy` markiert).

## Dateien

```
index.js     Verbindung, Login, Ereignisse, Medien-Download
mapping.js   Nachricht -> Anfrage, Allowlist (rein)
forward.js   POST mit Wiederholungen
config.js    Umgebung und .env
melder.js    Warnungen: Auswahl, Text, Rate-Limit, Schleifenschutz, Zustand (rein, ohne Baileys)
warn-test.js Trockenlauf des Melders ohne WhatsApp
zustand/     Stand des Melders (git-ignoriert)
test/        Node-Tests und Fixtures (alles erfunden)
```
