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
