# n8n: Gmail und Google Drive an die Ablage

> **Stand:** Beide Abläufe sind nach der Dokumentation und dem Quellcode von n8n geschrieben und **noch nicht in einer echten n8n-Instanz gelaufen**. Beim ersten Import kann n8n einzelne Felder anders anzeigen als hier beschrieben.

Die zwei Dateien hier reichen echte Eingänge an die Ablage weiter, ohne dass jemand seine Arbeitsweise ändert: Mails mit einem bestimmten Gmail-Label und Dateien aus einem bestimmten Google-Drive-Ordner. Die Google-Anmeldung liegt komplett in n8n. Die Ablage bekommt nur fertige Daten über `POST /import/email/gmail` und `POST /import/drive/datei` (Vertrag: `../SPEC.md` §7.7 und §7.8) und erkennt Wiederholungen selbst.

| Datei | Ablauf |
|---|---|
| `gmail_zu_ablage.json` | Gmail Trigger (jede Minute, nur Label) → Konfiguration → Mail im Rohformat über die Gmail-API holen → `POST /import/email/gmail` |
| `drive_zu_ablage.json` | zwei Drive Trigger (neue und geänderte Dateien, ein Ordner) → Konfiguration → Datei herunterladen → `POST /import/drive/datei` |

Für Tests `projekt` auf `Test Santino` lassen, damit nichts im Demo-Projekt `BV Simmering` landet.

## Voraussetzungen

1. Ablage-API läuft: im Ordner `ablage` `.venv\Scripts\python -m uvicorn ablage.api:app --port 8000`.
2. Die API ist öffentlich erreichbar, weil n8n Cloud nicht auf `localhost` zugreifen kann, z. B. mit `ngrok http 8000`. Die angezeigte `https://…`-Adresse ist später `ablage_url`.
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

**2. Abläufe importieren:** neuen Workflow öffnen → Menü „…“ oben rechts → „Import from File…“ → `gmail_zu_ablage.json` wählen. Für `drive_zu_ablage.json` einen zweiten Workflow anlegen und genauso importieren.

**3. Credentials zuordnen.** n8n übernimmt beim Import keine Credential-Verweise aus fremden Instanzen. Jeder Node mit Warnsymbol braucht die passende Credential:
- Gmail: „Gmail: Mail mit Label“ und „Mail im Rohformat holen“ → `Gmail SiteTwin`
- Drive: „Drive: neue Datei“, „Drive: geänderte Datei“, „Datei herunterladen“ → `Google Drive SiteTwin`
- beide: „An Ablage senden“ → `Ablage Token`. Die HTTP-Request-Nodes setzt n8n nie automatisch, hier immer von Hand wählen.

**4. Label bzw. Ordner wählen.**
- Gmail: Node „Gmail: Mail mit Label“ → Filters → Search: steht auf `label:sitetwin`. Bei anderem Label-Namen anpassen (Kleinschreibung reicht; Leerzeichen und `/` im Namen werden in der Gmail-Suche zu `-`, aus `Bau/SiteTwin` wird `label:bau-sitetwin`). Alternativ das Suchfeld leeren und unter „Label Names or IDs“ das Label aus der Liste wählen.
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
- Fehlgeschlagene Läufe stehen in n8n unter „Executions“ und lassen sich dort erneut ausführen. „An Ablage senden“ versucht es vorher selbst dreimal im Abstand von 5 Sekunden.

## Wie es funktioniert

- **Gmail:** Der Gmail-Node von n8n liefert die Mail nur zerlegt (Felder, Text, Anhänge als Binärdaten), nicht als Original. Die Ablage braucht aber die rohe Mail, damit sie durch denselben Parser läuft wie `.eml`-Dateien. Deshalb holt ein HTTP-Request-Node die Mail direkt über die Gmail-API (`users.messages.get` mit `format=raw`) mit derselben Gmail-Credential und reicht das Feld `raw` unverändert weiter.
- **Drive:** „Datei herunterladen“ lädt normale Dateien unverändert. Google-eigene Formate haben keine Datei-Bytes und werden beim Download umgewandelt: Docs, Slides und Zeichnungen in PDF, Sheets in CSV. Der Name in Drive hat dann keine Endung; der Ablauf hängt sie für `pfad` an (`.pdf` bzw. `.csv`), damit die Ablage den Typ erkennt und Text auslesen kann. Ein `/` im Dateinamen wird zu `_`.
- Neue Dateien lösen oft beide Drive Trigger aus. Die Ablage bekommt die Datei dann zweimal und zählt den zweiten Eingang als Duplikat.

## Grenzen

- **Polling statt Echtzeit:** n8n fragt jede Minute nach. Eine Mail oder Datei kommt mit bis zu etwa einer Minute Verzögerung an, bei vielen Mails pro Minute über mehrere Durchläufe verteilt (höchstens 10 Mails pro Durchlauf).
- **Label beim Eingang:** Der Gmail Trigger sucht nur Mails, die seit dem letzten Durchlauf eingegangen sind. Wer eine ältere Mail nachträglich mit dem Label versieht, löst nichts aus. Das Label muss per Gmail-Filter beim Eingang gesetzt werden.
- **Nur ein Ordner, keine Unterordner:** Die Drive Trigger beobachten nur Dateien direkt im gewählten Ordner. Dateien in Unterordnern lösen nichts aus (laut n8n-Quellcode, die Suche fragt nur direkte Kinder des Ordners ab).
- **Google-Formate:** Sheets kommen als CSV, damit nur das erste Tabellenblatt. Google begrenzt den Export umgewandelter Dateien auf etwa 10 MB. Formulare, Verknüpfungen (Shortcuts) und andere Google-Typen lassen sich nicht so exportieren; der Lauf schlägt dann für diese Datei fehl.
- **Geänderte Dateien:** Jede Änderung mit neuem Inhalt wird eine neue Zeile in der Ablage (Identität ist Pfad + Inhalt). Wird eine Datei in Drive umbenannt, entsteht ebenfalls eine neue Zeile.
- **Große Mails:** Die Mail geht als ein JSON-Feld an die Ablage. Bei sehr großen Anhängen (über etwa 20 MB) kann n8n Cloud an seine Speichergrenze kommen.
- **Sprachnachrichten werden nicht transkribiert.** Audio-Anhänge oder Audio-Dateien aus Drive kommen als Datei mit leerem `text` an.
- **Tunnel:** Ändert sich die Tunnel-Adresse (bei kostenlosem ngrok nach jedem Neustart), muss `ablage_url` in beiden Abläufen neu eingetragen werden. Solange die Ablage nicht erreichbar ist, schlagen die Läufe fehl; sie lassen sich unter „Executions“ wiederholen.
