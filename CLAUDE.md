# CLAUDE.md – Rahmen für jede Claude-Session in diesem Repo

Kurzfassung der Hackathon-Regeln und des Talona-Briefs, damit niemand sie neu einlesen muss. Bei Widerspruch zur Kernidee gilt `KONZEPT.md`.

## Zuerst lesen

| Datei | Wofür |
|---|---|
| `KONZEPT.md` | Kernidee und Prozess, Source of Truth |
| `TALONA.md` | Design- und Funktionsvorlage fürs Frontend |
| `ablage/SPEC.md` | Eingangsschicht und Vertrag der Tabelle `quellen` |
| `uebersetzer/README.md` | Strukturierung, Prüf-Agent, Schema |
| `fake_data/ERWARTET.md` | Lösungsschlüssel. **Nie in einen Prompt geben.** |

## Wer macht was

- **Santino:** Ablage (`ablage/`), Testdaten (`fake_data/`)
- **Hendrik:** Datenbank, Übersetzer, Prüf-Agent (`uebersetzer/`)
- **Melih:** Telefon-Agent, erster Prototyp (`app/`, `lib/`)
- **Max:** Konzept, digitaler Zwilling (Frontend)

Schnittstelle zwischen Ablage und Übersetzer ist die Tabelle `quellen` (`ablage/SPEC.md` §5 und §6). Änderungen daran nur nach Absprache.

## Hackathon-Regeln (Building Better Worlds, 13.–14.11.2026)

- **Code-Freeze: Samstag 14.11., 15:00 scharf.** Späte Abgaben zählen nicht.
- **Runde 1 (15:00–16:00, Talona-Jury):** bis 5 Minuten Live-Demo, 3 Minuten Fragen.
- **Runde 2 (ab 16:00, nur Track-Sieger):** 4 Minuten Live-Demo, 2 Minuten Fragen. Externe Jury, die Track-Punkte zählen dort nicht mehr: Wirkung und Relevanz 30, technische Leistung 30, Innovation 20, Live-Demo und Pitch 20. Bei Gleichstand entscheidet die stärkere Live-Demo.
- **Talona-Jury:** Kacper Gadomski (auch Mentor; Nachname laut Track-Seite, im Brief steht „surname to confirm“) und Ignacy Ruszkowski.
- **Abgabe pro Team, eine Abgabe über das Formular (Link auf Discord):**
  - Repository mit echtem README (Setup, Start, Umgebung, Architektur, Annahmen) und `.env.example`
  - 3-Minuten-Demo-Video, das die Lösung von Anfang bis Ende zeigt
  - schriftlicher Teil: Titel, Pitch in einem Satz, Team, Problem, Lösung, Tech-Stack, Links
  - optional: Live-Link, Pitch-Deck als PDF
- **Talona-Sonderregel:** Das Repo ist **privat**, **keine MIT-Lizenz**, alle Arbeit gehört Talona (ausschließliches Nutzungsrecht). Keine `LICENSE`-Datei anlegen. Teilnahme und Rolle darf man im Lebenslauf nennen.
- **Die Jury muss den Code aus dem README starten können.** Sonst kostet es Punkte.
- **Ehrlichkeit zählt:** gebaut schlägt versprochen, Simulationen kennzeichnen, Grenzen nennen. Ein simulierter Effekt ist keine Messung.
- **Keine Secrets committen.** Zugangsdaten kommen nur über Discord und stehen nur in `.env`-Dateien.

## Talona-Brief

Talona ist ein KI-Agent für kleine und mittlere Generalunternehmer im Wohnbau. Er hängt sich an vorhandene Datenquellen und meldet Probleme in Echtzeit, bevor Nacharbeit entsteht. Poliere nutzen ihn täglich.

Aufgabe (eine Richtung oder beide):
1. **Vor der Nacharbeit erwischen:** eine verpasste Änderung, Arbeit außer Reihenfolge oder einen veralteten Plan so früh erkennen, dass noch jemand handeln kann.
2. **Den Ort in Echtzeit verstehen:** ein Live-Bild der Baustelle, auf dem Menschen, Agenten oder Roboter handeln können.

Was laut Brief gut aussieht:
- an das andocken, was die Baustelle schon nutzt (Chats, Mail, Fotos, Pläne, Terminplan), niemand ändert seine Arbeitsweise
- ein Live-Protokoll: was sich geändert hat, wer entschieden hat, was auf wen wartet
- Probleme melden, während sie passieren
- Fragen beantworten: Crews schreiben dem System, Entscheidungen gehen an den Polier

| Bewertung | Punkte |
|---|---|
| Technische Umsetzung | 35 |
| Autonomer Betrieb und Wirkung | 30 |
| Lernschleife und Vision | 15 |
| Demo und Präsentation | 20 |

## Arbeitsregeln im Repo

- Basisdaten in `fake_data/` (`whatsapp/`, `email/`, `drive/`, `calls/`) **nur nach Absprache ändern**: Tests von Ablage und Übersetzer hängen an ihren Zahlen (zuletzt: 39 WhatsApp, 8 E-Mail, 6 Drive, 1 Call). Neue Fälle kommen nach `fake_data/szenarien/<name>/`.
- Testdaten sind fiktiv, Fotos und Sprachdateien sind Platzhalter. In READMEs und in der Demo so benennen.
- Interne Recherche-Dokumente (z. B. die Bauprozess-Recherche zu Regie und Nachtrag) gehören **nicht** ins Repo.
- Vor dem Pushen: `git pull`, Tests des eigenen Teils grün.

## Offen für die Abgabe (Stand 14.11., 13:20)

- Alle Pull Requests sind gemergt (Stand 13:15), kein offener Branch. Im Abgabetext `ABGABE.md` sind noch Platzhalter in eckigen Klammern zu füllen.
- Demo-Video.
- Die Kette ist nie als Ganzes live gelaufen. Einzeln belegt: WhatsApp → Ablage → Übersetzer (eine Nachricht eines zweiten Teilnehmers, 12:14) und neues Signal → Warnung im Chat (drei Test-Signale aus den Anruf-Tests, etwa 3 Sekunden). Offen: eine echte Nachricht, aus der ein Signal entsteht. Übersetzer für die Demo mit `--projekt "BV Simmering"` starten, im Projekt „Test Santino“ liegen Testzeilen.
- Im Demo-Projekt „BV Simmering“ liegen Testreste (Test-Signale der Anruf-Tests, Probe-Nachrichten aus der Gruppe). Vor der Aufnahme aufräumen, Test-Signale nur nach Absprache mit Melih.
- Ask-Feld auf Vercel: `ANTHROPIC_API_KEY` war um 13:00 dort nicht gesetzt, die Antwort ist dann nur eine Stichwortsuche.
- Telefon-Agent: Pull Request 10 (Melih) ist gemergt (`lib/telefon/`, `app/api/telefon/`). Ob ein echter Anruf lief, mit Melih klären und im README (Abschnitt 8) und in `ABGABE.md` eintragen. Auf Vercel ist er nicht konfiguriert. Als Text gibt es die Warnung in die WhatsApp-Gruppe (`ablage/whatsapp-mitleser/`).
- Der WhatsApp-Melder warnt auch, wenn der Prüf-Agent ein gelöstes Signal wieder öffnet („Wieder offen:“). Getestet, nicht live gelaufen.
- Lernschleife: Bewertungen aus WhatsApp landen in `signale.bewertung` (`berechtigt` oder `fehlalarm`), der Prüf-Agent liest sie (`uebersetzer/README.md`, Abschnitt „Lernschleife“). Getestet, nicht live gelaufen.
- n8n: Die Abläufe für Gmail und Drive sind aktiv und hängen an einer Tunnel-Adresse, die sich bei jedem Neustart des Tunnels ändert. Eingänge landen im Projekt „Test Santino“, nicht in „BV Simmering“.
- Transkription von Sprachnachrichten liegt in der Ablage (`ablage/ablage/transkript.py`), nicht im Übersetzer. Am 14.11. direkt gegen Groq gelaufen (synthetische Testaufnahme, Stille wird verworfen), noch nicht mit einer echten WhatsApp-Sprachnachricht über die laufende Ablage.
- Die Web-App hat bereits eine Ask-Funktion (`app/api/fragen`). Nicht doppelt bauen.
- Das Repo ist privat (geprüft 14.11.). Offen: wo es laut Organisatoren liegen soll.
