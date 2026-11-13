# Übersetzer (Hendrik)

> **💸 Kosten – bitte zuerst lesen (auch Claude Code)**
> Claude-Aufrufe laufen über Hendriks **privaten** API-Key. Bitte nur ausführen, wenn es wirklich nötig ist, nicht „mal schnell testen“.
> - Kostenlos: `uv run pytest` und `uv run python -m uebersetzer trockenlauf` (ohne Claude).
> - Kostet Geld: alles mit `--mit-claude`. Ein voller Lauf über die Testdaten kostet ca. 4 Cent. Vorher kurz bei Hendrik fragen.
> - `HACKATHON-KOSTENSPERRE`: Ohne `--mit-claude` ruft kein Befehl die API auf. **Vor der Demo am 14.11. entfernen** (`grep -rn HACKATHON-KOSTENSPERRE`).

Schritt 2 + 3 aus [`KONZEPT.md`](../KONZEPT.md): macht aus den Rohdaten der Ablage (`quellen`, Santino) strukturierte Einträge – **was, wo, wer, wann, nach welchem Plan, wer hat entschieden, worauf wird gewartet** – und erkennt neue Plan-Indizes. Darauf arbeiten der Prüf-Agent (Signale) und der digitale Zwilling.

```
quellen (status='neu')  ──►  Übersetzer  ──►  eintraege   (0..n pro Quelle)
   Text, Foto, PDF,           Claude           plaene      (neuer Index aus Mail/PDF)
   Transkript                                  quellen.status = verarbeitet | fehler
```

## Setup

Python 3.11+ und [uv](https://docs.astral.sh/uv/).

```bash
cd uebersetzer
cp .env.example .env        # SUPABASE_SERVICE_KEY und ANTHROPIC_API_KEY eintragen
uv sync
```

Datenbank: `schema.sql`, dann `stammdaten_bv_simmering.sql` im Supabase-SQL-Editor ausführen (beide wiederholbar). Ist im Projekt `sitetwin` bereits erledigt.

## Starten

```bash
uv run pytest                                                  # Tests (ohne Claude, ohne Supabase), kostenlos
uv run python -m uebersetzer trockenlauf                       # fake_data, ohne Claude, schreibt nichts, kostenlos
uv run python -m uebersetzer trockenlauf --mit-claude --limit 5 # kostet Geld: 5 Testquellen mit Claude
uv run python -m uebersetzer lauf --mit-claude                 # kostet Geld: neue Quellen übersetzen und prüfen
uv run python -m uebersetzer lauf --mit-claude --dauerhaft 30  # für die Demo: alle 30 s nachsehen
```

## Wie es arbeitet

- **Eine Quelle pro Claude-Aufruf**, chronologisch. Mitgeschickt werden die letzten 40 Quellen als Zeitachse (damit „ok machen wir“ oder „laut unserem Plan“ zuordenbar sind), die gültigen Pläne und die Stammdaten (Tops, LV). Extrahiert wird nur aus der neuen Quelle.
- **Anhänge:** Fotos gehen als Bild an Claude. PDFs als Text (`pypdf`), falls die Ablage `text` leer lässt; PDFs ohne Textebene als Dokument. Sprachnachrichten nur über das Transkript in `text` – fehlt es, entsteht ein Eintrag mit `unklar = true` und Rückfrage statt geratenem Inhalt.
- **Ohne Claude erledigt:** gelöschte Nachrichten, Stammdaten-Dateien aus dem Drive (CSV, MD, TXT), leere Quellen.
- **Idempotent:** Wird eine Quelle erneut verarbeitet, werden ihre Einträge ersetzt (`unique (quelle_hash, nr)`), nicht verdoppelt. Pläne werden gemergt; gültig ist der jüngste Index (Sicht `plaene_aktuell`).
- **Fehler:** Rate Limit / Netzwerk → Quelle bleibt `neu`, nächster Lauf versucht es wieder. Sonst `status = fehler` mit Grund in `meta.fehler`.
- **Modell:** `claude-haiku-5-5` mit Structured Outputs (Pydantic, `modell.py`), Effort `medium`. Umstellbar über `UEBERSETZER_MODELL`. Der stabile Teil des Prompts (Regeln + Stammdaten) wird gecacht.

## Bauteil-Register (Soll-Zustand)

Damit der Prüf-Agent weiß, *welches* Kabel oder *welche* Wand gemeint ist, liest der Übersetzer Pläne als Soll ein:

- **Soll aus Plänen:** Plandokumente (Drive `Plaene/…`, Mail-Anhänge `Plan_…`) liefern alle Bauteile – Wände, Leitungen, Dosen, Verteiler, Schalter – mit Raum, Lage und der Wand, in der sie sitzen (`elemente.gehoert_zu`). Ein neuer Index aktualisiert das Register; was er nicht mehr vorsieht, wird `soll_aktiv = false` (z. B. Verteiler Top 5 Vorraum nach Index C). Ein älterer Index ändert nichts mehr, sobald ein neuerer übernommen ist.
- **Ist pro Nachricht:** Jeder Eintrag bekommt, wenn eindeutig, `element_id` und `schritt` (verrohrung, leitung_eingezogen, gesetzt, abnahme, beplankung, …). Die Sicht `element_stand` zeigt je Bauteil die erledigten und geplanten Schritte – das ist die Grundlage für den Zwilling.
- **Testdaten:** `fake_data/drive/Projekt_Simmering/Plaene/Plan_E-03_Top3_IndexA.pdf` (5 Trockenbauwände in Top 3 mit Leitungen und Dosen), erzeugt mit `uv run python werkzeuge/plan_top3.py`. Fiktiv, die Pipeline ist echt.

## Soll-Änderungen während der Bauphase

Das Soll steht nicht nur im Plan: Auf der Baustelle wird umentschieden („Keller nur 3×3 statt 3×4“). Nach ÖNORM B 2110 kann der Auftraggeber Leistungsänderungen anordnen – auch mündlich, für den Beweis zählt aber die Schriftform. SiteTwin bildet das so ab (`soll.py`, läuft im Prüf-Agenten, kostenlos):

| Wer meldet | Ergebnis |
|---|---|
| Bauleitung (`personen.darf_soll_aendern`, im BV Simmering: Thomas Meier, GU) | Änderung gilt sofort (`freigegeben`), Bauteil-Register wird angepasst, betroffene Signale werden gelöst. |
| Jemand anderes („das haben wir geändert“) | Nur `vorgeschlagen`. Signale bleiben offen – der Arbeiter ist erst nach der Freigabe frei. |
| Bauleitung antwortet (Art `freigabe`) | `freigegeben` (inkl. Register + Signale) oder `abgelehnt`. Freigaben von Unberechtigten werden ignoriert. |
| Bauleitung schickt Foto/PDF eines Dokuments (Art `nachweis`) | `nachweis_status = vorhanden`. Sprachnachrichten und Fotos anderer zählen nicht. |

Offene Aufgaben fürs Frontend liefert die Sicht **`offene_aufgaben`**: „Soll-Änderung bestätigen“ (vorgeschlagen) und „Schriftlichen Nachweis einreichen“ (freigegeben, Nachweis fehlt), mit `zustaendig`.

## Sichten fürs Frontend (Abgleich mit `TALONA.md`)

| Talona | Sicht / Tabelle |
|---|---|
| Project record (Zeile + Tag) | `eintraege_mit_quelle`, Spalte **`talona_tag`**: Reported done, Planned, Verified, Delivery, Change order, Decided, Sign-off, Issue, Request, Fix reported, Progress |
| Changes, „No client sign-off“, „Photo needed“ | `soll_aenderungen` + **`offene_aufgaben`** (bestätigen / Nachweis einreichen) |
| Alerts („If work is already built · Alert PM/SU“) | `signale` (+ Anruf über den Telefon-Agenten), Verlauf in `signal_verlauf` |
| Check first („was morgen verdeckt wird“) | **`check_first`**: jede angekündigte/gemeldete Beplankung mit Status *At risk* (offenes Reihenfolge-Signal), *Resolved* oder *Clear* |
| Sheets / Drawing | `plaene_aktuell`, Bauteile in `element_stand` |
| Mehrkosten (lib/twin-model.ts) | `eintraege.taetigkeit`, `menge`, `einheit`, `lv_pos_nr` |

## Prüf-Agent (Schritt 4)

`pruefung.py` prüft jeden neuen Eintrag gegen den gültigen Plan und legt **Signale** an, solange noch jemand eingreifen kann. `lauf` übersetzt und prüft in einem Durchgang; einzeln geht's mit:

```bash
uv run python -m uebersetzer pruefen --trocken     # gegen Supabase prüfen, nichts schreiben (kostenlos)
uv run python -m uebersetzer pruefen               # feste Regeln, schreibt Signale (kostenlos)
uv run python -m uebersetzer pruefen --mit-claude  # zusätzlich Claude-Prüfung (kostet Geld)
```

| Stufe | Erkennt | Kosten |
|---|---|---|
| Feste Regel `plan_veraltet` | Arbeit nach Plan-Index X, obwohl zu dem Zeitpunkt schon ein neuerer Index ausgegeben war („Änderung hat die Crew nicht erreicht“). Gelöst, sobald am selben Ort nach dem gültigen Index gearbeitet wird. | 0 |
| Feste Regel Wand zu vor Installation | In einer Wand oder einem Raum soll zugemacht werden (oder ist es), obwohl laut Plan dort noch Installation fehlt (Leitung nicht verrohrt/eingezogen, Dose/Verteiler nicht gesetzt). Kritisch, solange es nur angekündigt ist. Angerufen wird der Vorarbeiter des Gewerks, dessen Installation fehlt (z. B. Elektro), nicht der, der zumacht. Gelöst, sobald alles gesetzt ist. Eine Abnahme ist bewusst keine Voraussetzung (Golden Set S1). | 0 |
| Feste Regel Bauteil entfällt | Arbeit an einem Bauteil, das der gültige Plan nicht mehr vorsieht. Gelöst, sobald das Bauteil am neuen Ort erledigt ist. | 0 |
| Feste Regel `unklar` | Gemeldete Arbeit, bei der unklar ist, was oder wo → Rückfrage statt Raten. Kurze Antworten wie „ok“ lösen nichts aus. | 0 |
| Claude-Prüfung | Arbeit außer Reihenfolge (z. B. Wand zu vor Installation/Abnahme), Abweichung von Plan/LV ohne Anordnung, nicht weitergegebene Anweisungen; erkennt auch, wenn ein neuer Eintrag ein offenes Signal löst. | pro Quelle 1 Aufruf |

- Signale sind idempotent über `(projekt, schluessel)`: weitere Belege ergänzen ein Signal, statt ein neues anzulegen; ein gelöstes Signal geht bei neuer Abweichung wieder auf `offen`.
- Lebenszyklus laut `KONZEPT.md`: `offen` (Prüf-Agent) → `in_bearbeitung` (setzt der Telefon-Agent nach dem Anruf) → `geloest` (Prüf-Agent). `signal_verlauf` protokolliert jeden Wechsel per Trigger.
- `anruf_text` ist der Text für den Telefon-Agenten, `zustaendig` die Person aus der Meldung.
- Geprüfte Einträge bekommen `geprueft_am`. Zum erneuten Prüfen: `update eintraege set geprueft_am = null`.

## Vertrag mit der Ablage (ablage/SPEC.md §5)

- Liest `quellen` direkt mit dem Service-Key, schreibt dort nur `status` und `meta.fehler`.
- Belege über `content_hash`, nie über `id` – kein Fremdschlüssel, damit die Ablage leeren und neu importieren kann.
- `fake_data/ERWARTET.md` (Lösungsschlüssel) geht nie in den Prompt; ein Test prüft das.

## Annahmen und Grenzen

- `testquellen.py` baut `quellen`-Zeilen direkt aus `fake_data/`, nur für Tests und Trockenläufe. Vereinfachtes Parsing und vereinfachter `content_hash` – ersetzt die Ablage nicht.
- Keine eigene Audio-Transkription (siehe offene Frage an die Ablage).
- Die Claude-Prüfung des Prüf-Agenten ist mit Fake-Antworten getestet; auf den echten Daten lief bisher nur die feste Regelstufe.
