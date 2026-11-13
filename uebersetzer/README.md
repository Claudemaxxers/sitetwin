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
uv run python -m uebersetzer lauf --mit-claude                 # kostet Geld: neue Quellen in Supabase übersetzen
uv run python -m uebersetzer lauf --mit-claude --dauerhaft 30  # für die Demo: alle 30 s nachsehen
```

## Wie es arbeitet

- **Eine Quelle pro Claude-Aufruf**, chronologisch. Mitgeschickt werden die letzten 40 Quellen als Zeitachse (damit „ok machen wir“ oder „laut unserem Plan“ zuordenbar sind), die gültigen Pläne und die Stammdaten (Tops, LV). Extrahiert wird nur aus der neuen Quelle.
- **Anhänge:** Fotos gehen als Bild an Claude. PDFs als Text (`pypdf`), falls die Ablage `text` leer lässt; PDFs ohne Textebene als Dokument. Sprachnachrichten nur über das Transkript in `text` – fehlt es, entsteht ein Eintrag mit `unklar = true` und Rückfrage statt geratenem Inhalt.
- **Ohne Claude erledigt:** gelöschte Nachrichten, Stammdaten-Dateien aus dem Drive (CSV, MD, TXT), leere Quellen.
- **Idempotent:** Wird eine Quelle erneut verarbeitet, werden ihre Einträge ersetzt (`unique (quelle_hash, nr)`), nicht verdoppelt. Pläne werden gemergt; gültig ist der jüngste Index (Sicht `plaene_aktuell`).
- **Fehler:** Rate Limit / Netzwerk → Quelle bleibt `neu`, nächster Lauf versucht es wieder. Sonst `status = fehler` mit Grund in `meta.fehler`.
- **Modell:** `claude-haiku-5-5` mit Structured Outputs (Pydantic, `modell.py`), Effort `medium`. Umstellbar über `UEBERSETZER_MODELL`. Der stabile Teil des Prompts (Regeln + Stammdaten) wird gecacht.

## Vertrag mit der Ablage (ablage/SPEC.md §5)

- Liest `quellen` direkt mit dem Service-Key, schreibt dort nur `status` und `meta.fehler`.
- Belege über `content_hash`, nie über `id` – kein Fremdschlüssel, damit die Ablage leeren und neu importieren kann.
- `fake_data/ERWARTET.md` (Lösungsschlüssel) geht nie in den Prompt; ein Test prüft das.

## Annahmen und Grenzen

- `testquellen.py` baut `quellen`-Zeilen direkt aus `fake_data/`, nur für Tests und Trockenläufe. Vereinfachtes Parsing und vereinfachter `content_hash` – ersetzt die Ablage nicht.
- Keine eigene Audio-Transkription (siehe offene Frage an die Ablage).
- Der Prüf-Agent (Signale) ist nicht Teil des Übersetzers.
