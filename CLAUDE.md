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
- **Talona-Jury:** Kacper Nowakowski (auch Mentor) und Ignacy Ruszkowski.
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

## Offen für die Abgabe (Stand 13.11., nachts)

- Root-`README.md` beschreibt noch vor allem den ersten Prototyp. Es fehlen die Gesamtkette (Ablage → Übersetzer → Prüf-Agent → Telefon-Agent → Zwilling), die Umgebung für alle Teile und ein Abschnitt Annahmen und Grenzen.
- Demo-Video und schriftlicher Abgabetext.
- Prüfen, ob das Repo privat ist und wo es laut Organisatoren liegen soll.
- Echte Sprachnachrichten werden noch von niemandem transkribiert.
