# n8n: Gmail und Google Drive an die Ablage

> **Stand 14.11.2026:** Beide Abläufe waren in eine n8n-Cloud-Instanz importiert, alle Felder kamen richtig an. Der Drive-Ablauf ist dort einmal von Hand gelaufen: Test-PDF im Ordner → Ablage meldet `neu: 1`, der PDF-Text steht in `quellen`. Der Dauerbetrieb (aktiviert, Abfrage jede Minute) ist für beide ungetestet.
>
> **Gmail-Ablauf umgebaut und am 14.11.2026 einmal gegen n8n Cloud gelaufen** (von Hand ausgelöst, fiktive Testmail ohne Anhang, Antwort der Ablage `neu: 1`, Zeile in Supabase gesehen). Offen: Mail mit Anhang, zweiter Lauf als Duplikat, Hash-Gegenprobe mit `.eml`, Dauerbetrieb. Die erste Fassung holte die Rohmail über einen HTTP-Request-Node und brach auf n8n Cloud ab: „This credential is configured to prevent use within an HTTP Request or GraphQL node“. Die von n8n Cloud verwaltete Google-Anmeldung („Sign in with Google“) darf nicht in HTTP-Request-Nodes benutzt werden. Die neue Fassung braucht keine Rohmail mehr: Der Gmail Trigger liefert die Mail zerlegt (Felder und Anhänge), ein Code-Node packt sie ein, die Ablage nimmt sie über `POST /import/email/gmail-felder` an (`../SPEC.md` §7.10). Das ist in Tests mit nachgebauten n8n-Items geprüft (siehe „Erster echter Lauf“). Der alte Endpunkt `POST /import/email/gmail` bleibt bestehen, falls später eine eigene Google-OAuth-App die Rohmail doch erlaubt.

Die zwei Dateien hier reichen echte Eingänge an die Ablage weiter, ohne dass jemand seine Arbeitsweise ändert: Mails mit einem bestimmten Gmail-Label und Dateien aus einem bestimmten Google-Drive-Ordner. Die Google-Anmeldung liegt komplett in n8n. Die Ablage bekommt nur fertige Daten über `POST /import/email/gmail-felder` und `POST /import/drive/datei` (Vertrag: `../SPEC.md` §7.10 und §7.8) und erkennt Wiederholungen selbst.

| Datei | Ablauf |
|---|---|
| `gmail_zu_ablage.json` | Gmail Trigger (jede Minute, nur Label, „Simplify“ aus, Anhänge laden) → Code-Node „Mail für Ablage aufbereiten“ → Konfiguration → `POST /import/email/gmail-felder` |
| `drive_zu_ablage.json` | zwei Drive Trigger (neue und geänderte Dateien, ein Ordner) → Konfiguration → Datei herunterladen → `POST /import/drive/datei` |

Für Tests `projekt` auf `Test Santino` lassen, damit nichts im Demo-Projekt `BV Simmering` landet.

## Voraussetzungen

1. Ablage-API läuft: im Ordner `ablage` `.venv\Scripts\python -m uvicorn ablage.api:app --port 8000`.
2. Die API ist öffentlich erreichbar, weil n8n Cloud nicht auf `localhost` zugreifen kann, z. B. mit `cloudflared tunnel --url http://localhost:8000` (braucht kein Konto) oder `ngrok http 8000`. Die angezeigte `https://…`-Adresse ist später `ablage_url`.
3. `ABLAGE_IMPORT_TOKEN` in `ablage/.env` auf einen langen Zufallswert setzen und uvicorn neu starten. Der Tunnel steht offen im Netz; ohne Token könnte jeder, der die Adresse kennt, Daten in die Ablage schreiben.
4. In Gmail ein Label anlegen, z. B. `SiteTwin`, und einen Gmail-Filter, der dieses Label **beim Eingang** setzt (z. B. für bestimmte Absender oder für eine Plus-Adresse wie `name+sitetwin@…`). Mails, die erst später von Hand ein Label bekommen, sieht der Trigger nicht (siehe Grenzen).
5. In Google Drive einen Ordner, dessen Dateien in die Ablage sollen.

## Einrichtung in n8n

**1. Drei Credentials anlegen** (links „Credentials“ → „Add credential“). Am besten vor dem Import, dann setzt n8n sie in den Gmail- und Drive-Nodes selbst ein.

| Name (Vorschlag) | Typ in n8n | Inhalt |
|---|---|---|
| `Gmail SiteTwin` | Gmail OAuth2 API | „Sign in with Google“, das Postfach mit dem Label |
| `Google Drive SiteTwin` | Google Drive OAuth2 API | „Sign in with Google“, das Konto mit dem Ordner |
| `Ablage Token` | Header Auth | Name: `X-Ablage-Token`, Value: derselbe Wert wie `ABLAGE_IMPORT_TOKEN` |

**2. Abläufe importieren:** neuen Workflow öffnen → Menü „…“ oben rechts → „Import from File…“ → `gmail_zu_ablage.json` wählen. Für `drive_zu_ablage.json` einen zweiten Workflow anlegen und genauso importieren. Wer die alte Gmail-Fassung (mit „Mail im Rohformat holen“) schon importiert hat: diesen Workflow deaktivieren oder löschen und die neue Datei als neuen Workflow importieren, sonst laufen beide.

**3. Credentials zuordnen.** n8n übernimmt beim Import keine Credential-Verweise aus fremden Instanzen. Jeder Node mit Warnsymbol braucht die passende Credential:
- Gmail: nur „Gmail: Mail mit Label“ → `Gmail SiteTwin`. Kein anderer Node braucht einen Google-Zugang.
- Drive: „Drive: neue Datei“, „Drive: geänderte Datei“, „Datei herunterladen“ → `Google Drive SiteTwin`
- beide: „An Ablage senden“ → `Ablage Token`. Die HTTP-Request-Nodes setzt n8n nie automatisch, hier immer von Hand wählen.

**4. Label bzw. Ordner wählen.**
- Gmail: Node „Gmail: Mail mit Label“ → Filters → Search: steht auf `label:sitetwin`. Bei anderem Label-Namen anpassen (Kleinschreibung reicht; Leerzeichen und `/` im Namen werden in der Gmail-Suche zu `-`, aus `Bau/SiteTwin` wird `label:bau-sitetwin`). Alternativ das Suchfeld leeren und unter „Label Names or IDs“ das Label aus der Liste wählen. Im selben Node muss „Simplify“ **aus** sein und unter Options „Download Attachments“ **an** (so steht es in der Datei). Mit „Simplify“ an kommt nur ein gekürzter `snippet` statt des Texts; die Ablage antwortet dann mit 422.
- Drive: in **beiden** Triggern unter „Folder“ denselben Ordner aus der Liste wählen (oder die Auswahl daneben auf „Link“ umstellen und den Ordner-Link aus dem Browser einfügen).

**5. Konfiguration anpassen.** Node „Konfiguration“ öffnen, das ist die einzige Stelle mit Einstellungen:
- `ablage_url`: Tunnel-Adresse ohne Pfad, z. B. `https://abcd-1234.ngrok-free.app`
- `projekt`: für Tests `Test Santino`. Nicht leer lassen: ohne Wert nimmt die Ablage `DEFAULT_PROJEKT` aus ihrer `.env`, also im Zweifel `BV Simmering`
- nur Drive: `kanal` (Standard `Google Drive`), `ordner_praefix` (Standard leer; gesetzt wird er vor den Dateinamen gestellt, z. B. `Plaene` ergibt `pfad = Plaene/Plan_E-05.pdf`)

**6. Einmal von Hand ausführen:** „Execute workflow“. Im Testlauf holt der Gmail Trigger die neueste Mail mit dem Label, der Drive Trigger die neueste Datei im Ordner, unabhängig vom Zeitpunkt. Ist keine passende Mail oder Datei da, bricht der Trigger mit einem Hinweis ab.

**7. Aktivieren:** Workflow speichern und oben rechts aktivieren (in neueren n8n-Versionen „Publish“). Ab dann fragt n8n jede Minute nach. Mails und Dateien von **vor** der Aktivierung werden nicht nachgeholt.

## Prüfen, ob es ankam

- In n8n den Node „An Ablage senden“ öffnen. Die Antwort der Ablage sieht so aus: `{"gelesen": 1, "neu": 1, "duplikate": 0, "fehler": []}`. Bei Mails mit Anhängen ist `gelesen` größer, weil jeder Anhang eine eigene Zeile ist.
- Ein zweiter Lauf mit derselben Mail oder Datei ergibt `neu: 0, duplikate: 1`. Das ist gewollt.
- In der Ablage: `.venv\Scripts\python -m ablage zeige --projekt "Test Santino"`
- Antwort `401`: Token in der Credential `Ablage Token` passt nicht zu `ABLAGE_IMPORT_TOKEN`, oder der Headername ist nicht genau `X-Ablage-Token`.
- Antwort `422`: Die Ablage konnte die Mail nicht verwerten; der Text nennt, was fehlt (siehe „Erster echter Lauf“).
- Fehlgeschlagene Läufe stehen in n8n unter „Executions“ und lassen sich dort erneut ausführen. „An Ablage senden“ versucht es vorher selbst dreimal im Abstand von 5 Sekunden.

## Wie es funktioniert

- **Gmail:** Der Gmail Trigger liefert die Mail nur zerlegt, nicht als Original: mit „Simplify“ aus stehen im Item `subject`, `text`, `html`, `date`, `messageId`, `from`/`to`/`cc` und die Kopfzeilen unter `headers`, die Anhänge hängen als Binärdaten `attachment_0`, `attachment_1`, … am Item. Der Code-Node „Mail für Ablage aufbereiten“ liest jeden Anhang mit `this.helpers.getBinaryDataBuffer` (n8n Cloud hält Binärdaten außerhalb des Items, `binary[…].data` ist dort nicht verlässlich), kodiert ihn als base64 und baut `{mail, anhaenge}`. „Konfiguration“ ergänzt `ablage_url` und `projekt`, „An Ablage senden“ schickt `{projekt, mail, anhaenge}` als JSON an `/import/email/gmail-felder`.
- Die Ablage baut daraus dieselben Zeilen wie beim `.eml`-Import: Die Kopfzeilen aus `headers` laufen durch denselben Python-Parser, Body und Anhänge gehen in dieselbe Funktion (`eml.items`). Fehlt `headers`, nimmt sie die Einzelfelder. Dieselbe Mail als `.eml`, über den alten Rohweg und über diesen Weg ergibt denselben `content_hash`, also keine zweite Zeile. `meta.gmail_weg = "felder"` zeigt, über welchen Weg eine Zeile kam.
- **Drive:** „Datei herunterladen“ lädt normale Dateien unverändert. Google-eigene Formate haben keine Datei-Bytes und werden beim Download umgewandelt: Docs, Slides und Zeichnungen in PDF, Sheets in CSV. Der Name in Drive hat dann keine Endung; der Ablauf hängt sie für `pfad` an (`.pdf` bzw. `.csv`), damit die Ablage den Typ erkennt und Text auslesen kann. Ein `/` im Dateinamen wird zu `_`.
- Neue Dateien lösen oft beide Drive Trigger aus. Die Ablage bekommt die Datei dann zweimal und zählt den zweiten Eingang als Duplikat.

## Grenzen

- **Polling statt Echtzeit:** n8n fragt jede Minute nach. Eine Mail oder Datei kommt mit bis zu etwa einer Minute Verzögerung an, bei vielen Mails pro Minute über mehrere Durchläufe verteilt (höchstens 10 Mails pro Durchlauf).
- **Label beim Eingang:** Der Gmail Trigger sucht nur Mails, die seit dem letzten Durchlauf eingegangen sind. Wer eine ältere Mail nachträglich mit dem Label versieht, löst nichts aus. Das Label muss per Gmail-Filter beim Eingang gesetzt werden.
- **Nur ein Ordner, keine Unterordner:** Die Drive Trigger beobachten nur Dateien direkt im gewählten Ordner. Dateien in Unterordnern lösen nichts aus (laut n8n-Quellcode, die Suche fragt nur direkte Kinder des Ordners ab).
- **Google-Formate:** Sheets kommen als CSV, damit nur das erste Tabellenblatt. Google begrenzt den Export umgewandelter Dateien auf etwa 10 MB. Formulare, Verknüpfungen (Shortcuts) und andere Google-Typen lassen sich nicht so exportieren; der Lauf schlägt dann für diese Datei fehl.
- **Geänderte Dateien:** Jede Änderung mit neuem Inhalt wird eine neue Zeile in der Ablage (Identität ist Pfad + Inhalt). Wird eine Datei in Drive umbenannt, entsteht ebenfalls eine neue Zeile.
- **Große Mails:** Die Mail geht mit allen Anhängen als base64 in einem JSON an die Ablage. Bei sehr großen Anhängen (über etwa 20 MB) kann n8n Cloud an seine Speichergrenze kommen.
- **Gleicher Hash nur, wenn n8n denselben Text liefert.** In den Hash der Mail-Zeile gehen Absender, To-Adresse, Zeitpunkt und `Betreff + Body`. Absender, Adresse, Zeit und Betreff kommen aus den Rohkopfzeilen und sind damit gleich. Den Body liest n8n mit mailparser, die Ablage beim `.eml`-Import mit Python. Zeilenenden und Leerraum am Anfang und Ende gleicht die Ablage aus; bei diesen Fällen kann der Text trotzdem abweichen und es entsteht eine zweite Zeile, wenn dieselbe Mail auch als `.eml` importiert wird:
  - reine HTML-Mail ohne Text-Teil, die nicht als einzelner `text/html`-Teil kommt (z. B. `multipart/alternative` nur mit HTML): mailparser erzeugt einen eigenen Text, die Ablage nimmt ihn statt ihres HTML-zu-Text-Wegs;
  - Mails mit `format=flowed` (mailparser fügt umbrochene Zeilen zusammen, Python nicht) oder mit mehreren Text-Teilen (mailparser hängt sie aneinander, Python nimmt den ersten).
  Anhang-Zeilen hängen nur am Dateiinhalt und sind davon nicht betroffen. Eingebettete Bilder (`cid:`) in `multipart/related` liefert n8n als Anhänge, der `.eml`-Import je nach Aufbau nicht; dann gibt es auf dem n8n-Weg zusätzliche Anhang-Zeilen.
- **Text in der Mail-Zeile:** Zeilenenden im Body speichert dieser Weg immer als `\n`. Beim `.eml`-Import bleiben sie, wie sie in der Datei stehen (bei den Testdaten auch `\n`). Der Hash ist davon nicht betroffen.

## Erster echter Lauf

**Ergebnis vom 14.11.2026** (n8n Cloud, ein Lauf von Hand, fiktive Testmail ohne Anhang, Projekt „Test Santino“): alle vier Nodes liefen ohne Änderung am importierten Ablauf, Antwort der Ablage `{"gelesen":1,"neu":1,"duplikate":0,"fehler":[]}`. Das Item des Triggers hatte die Felder `id, threadId, labelIds, sizeEstimate, headers, html, text, textAsHtml, subject, date, to, from, messageId`; `headers` ist ein Objekt mit kleingeschriebenen Schlüsseln und Werten samt Kopfnamen (`"subject": "Subject: =?UTF-8?Q?…?="`, `"message-id": "Message-Id: <…>"`), `from`/`to` haben `value`, `html`, `text`. Punkt 1 der Liste unten ist damit bestätigt. **Nicht geprüft:** Punkte 2 und 3 (Anhänge), der zweite Lauf aus Punkt 4 und die Gegenprobe aus Punkt 5.

Die Form des n8n-Items war aus dem n8n-Quellcode (`parseRawEmail` im Gmail-Node, mailparser) abgeleitet. Die Tests (`../tests/test_gmail_felder.py`) bauen das Item aus den sechs `.eml` in `fake_data/email/` nach und prüfen, dass Zeilen und Hashes gleich sind wie beim `.eml`-Import. Beim ersten Lauf in n8n prüfen:

1. Im Trigger-Output (Tab „JSON“) gibt es `headers` mit Einträgen wie `"subject": "Subject: …"`, dazu `text`, `date` (ISO), `messageId` mit spitzen Klammern, `from`/`to` als `{value: [{address, name}], text}` und `id`. Fehlt `headers`, geht es über die Einzelfelder; das ist ebenfalls getestet.
2. Im Tab „Binary“ des Triggers stehen die Anhänge als `attachment_0`, … mit Dateiname und MIME-Typ.
3. Im Code-Node hat `anhaenge` so viele Einträge wie die Mail Anhänge hat, `base64` ist nicht leer.
4. Antwort der Ablage `{"gelesen": 1 + Anzahl Anhänge, "neu": …}`; zweiter Lauf mit derselben Mail `neu: 0`.
5. Gegenprobe Hash: dieselbe Mail in Gmail als `.eml` herunterladen („Original anzeigen“ → „Original herunterladen“) und mit `python -m ablage import email <datei> --projekt "Test Santino"` importieren. Erwartet: `neu: 0`. Kommt eine neue Mail-Zeile, weicht der Body ab (siehe Grenzen).

Was eine 422-Antwort sagt (steht in n8n im Fehler von „An Ablage senden“):
- `Mail kommt vereinfacht an (nur snippet …)`: „Simplify“ im Trigger ist an.
- `from und date fehlen … Gefundene Felder: …`: Das Item hat eine andere Form als erwartet; die Liste der gefundenen Felder zeigt, welche.
- `messageId … und Gmail-id fehlen beide`: weder `messageId` noch `headers["message-id"]` noch `id` im Item.
- `mail fehlt oder ist kein JSON-Objekt` bzw. Pydantic-Fehler zu `mail`: Der Body von „An Ablage senden“ ist nicht `{projekt, mail, anhaenge}`.
- `anhaenge[n].base64 (<Name>) ist kein gültiges base64url`: Der Code-Node hat einen Anhang nicht richtig gelesen.
- **Sprachnachrichten werden nicht transkribiert.** Audio-Anhänge oder Audio-Dateien aus Drive kommen als Datei mit leerem `text` an.
- **Tunnel:** Ändert sich die Tunnel-Adresse (bei kostenlosem ngrok nach jedem Neustart), muss `ablage_url` in beiden Abläufen neu eingetragen werden. Solange die Ablage nicht erreichbar ist, schlagen die Läufe fehl; sie lassen sich unter „Executions“ wiederholen.
