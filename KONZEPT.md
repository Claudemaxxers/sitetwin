# SiteTwin – Konzept (Rough Outline)

> **Source of Truth für die Kernidee.** Wenn eine SPEC, README oder ein Code-Kommentar dem hier widerspricht, gilt dieses Dokument. Details (wie der Agent genau prüft, Datenformate, Prompts) werden in eigenen SPECs festgelegt und dürfen die Kernidee nicht verändern.
>
> Stand: 13.11.2026, abends · Building Better Worlds Hackathon · Talona Track 01 *Context for the Physical World*

## Die Idee in einem Satz

Was auf der Baustelle per WhatsApp, Foto, Sprachnachricht oder Mail passiert, landet automatisch in unserem System, wird strukturiert, ein Agent erkennt Abweichungen vom aktuellen Plan, **ruft den Vorarbeiter an, bevor es zu Nacharbeit kommt**, und das Büro sieht jederzeit den echten Stand des Projekts im digitalen Zwilling.

## Der Prozess

```
 Baustelle / System
 ┌──────────────────────────────────────────┐
 │ WhatsApp (Text, Sprachnachricht)         │
 │ E-Mail                                   │
 │ Fotos von der Baustelle                  │
 │ Baupläne                                 │
 │ sonst was                                │
 └──────────────────┬───────────────────────┘
                    ▼
 1. Rohdaten-Datenbank        unstrukturiert, alles unverändert mit Beleg
                    ▼
 2. Strukturierung            API-Call (LLM) macht aus Rohdaten strukturierte Einträge
                    ▼
 3. Strukturierte Datenbank   was, wo, wer, wann, nach welchem Plan
          │                         │
          ▼                         ▼
 4. Prüf-Agent              6. Frontend: digitaler Zwilling
    erkennt Abweichung         (Büro / Generalunternehmer)
    vom aktuellen Plan         mehrere Projekte, je Projekt der aktuelle Stand
          │                    = Ground Truth, immer aktuell
          ▼ Signal (Flag)
 5. Telefon-Agent
    ruft den Vorarbeiter vor Ort an
    → er weist seinen Mitarbeiter an
```

### 1. Inputs → Rohdaten-Datenbank
- Quellen: WhatsApp (Text + Sprachnachrichten), E-Mail, Fotos, Baupläne, weitere.
- Kommen von der Baustelle (Arbeiter, Vorarbeiter) oder aus Systemen (Planer, Mails).
- Alles landet **unverändert** in einer ersten Datenbank. Hier wird nichts interpretiert.

### 2. Strukturierung
- Ein API-Call (LLM) liest die Rohdaten und macht daraus strukturierte Einträge.
- Ergebnis kommt in eine **zweite, strukturierte Datenbank**.

### 3. Strukturierte Datenbank
- Die eine Wahrheit über die Baustelle: was wurde gemacht, wo, von wem, wann, welcher Plan gilt.
- Auf ihr sitzen der Prüf-Agent (4) und das Frontend (6).

### 4. Prüf-Agent (Flags)
- Sitzt auf der strukturierten Datenbank und prüft laufend gegen den aktuellen Plan.
- Löst ein **Signal** aus, wenn etwas abweicht.
- Kern-Beispiel (Talona-Use-Case): Jemand arbeitet etwas, das vom aktuellen Plan abweicht, z. B. will eine Wand schließen, obwohl noch Kabel hinein müssen. Er schickt das als Nachricht, sie wird strukturiert, der Agent erkennt: „Das ist so nicht richtig“ → Signal.

### 5. Telefon-Agent
- Das Signal ist ein **Telefonanruf** an den Verantwortlichen vor Ort, in unserer Zielgruppe meist der **Vorarbeiter**.
- Der Agent sagt, was los ist („Wand nicht zumachen, da müssen noch Kabel rein“), der Vorarbeiter weist seinen Mitarbeiter an.
- Entscheidung bleibt beim Menschen.

### 6. Frontend: digitaler Zwilling
- Für das Büro (Generalunternehmer o. ä.).
- Mehrere Projekte, pro Projekt der **aktuelle Stand**.
- Ist die Ground Truth, muss also immer aktuell sein. Flags und Anrufe sind dort ebenfalls sichtbar.

## Produktvideo (für den Pitch)

Grober Ablauf, Details folgen:

1. **Baustelle:** Kurze Sequenzen, jemand arbeitet / telefoniert. Ein Arbeiter macht ein Foto und schickt es per WhatsApp, dazu eine Sprachnachricht, z. B. *„Jo Chef, hab die Wand hochgezogen, würd sie jetzt zumachen.“*
2. **Der Weg der Nachricht:** Wir folgen der Nachricht vom Handy in unser System.
3. **Durchs Produkt:** Wie die Daten strukturiert werden, wie der Agent die Abweichung erkennt und die Flag auslöst.
4. **Anruf:** Das System ruft den Vorarbeiter an: *„Nicht zumachen, da müssen noch Kabel rein.“*
5. **Büro:** Der Stand landet im digitalen Zwilling, der Mensch im Büro sieht es auch.

## Offene Punkte

- **Keine Redundanz zwischen Vorarbeiter und Büro:** Wer bekommt was, damit nicht beide dasselbe tun? (noch zu klären)
- Video: Sequenzen genauer festlegen.
- Detail-SPECs für Strukturierung (2), Prüf-Agent (4), Telefon-Agent (5) und Frontend (6) fehlen noch.

## Was schon im Repo ist (Stand 13.11., 20:50)

| Schritt | Vorhanden | Abweichung vom Konzept |
|---|---|---|
| 1 Inputs + Rohdaten-DB | `ablage/SPEC.md` (Santino), Testdaten in `fake_data/` | passt. Achtung: Dort ist der Anruf ein *Input* (abendlicher Tagesbericht). Im Konzept ist der Anruf das *Signal* (Schritt 5). Beides ist möglich, Schritt 5 hat Priorität. |
| 2 Strukturierung | nur als Schnittstelle in `ablage/SPEC.md` §5 (Henrik) | eigene SPEC fehlt |
| 3 Strukturierte DB | Tabelle `aenderungen` erwähnt, nicht beschrieben | fehlt |
| 4 Prüf-Agent | Regeln in Melihs Entwurf `lib/rules.ts` (Wand vor Abnahme zu, veralteter Plan, Reihenfolge) | passt inhaltlich, läuft aber auf eigener SQLite statt auf der strukturierten DB |
| 5 Telefon-Agent | – | fehlt (Melihs Entwurf meldet über Telegram an den Bauleiter) |
| 6 Digitaler Zwilling | Melihs Entwurf (Next.js, 3D-Modell, Zeitregler) | nur ein Projekt, nicht an die strukturierte DB angebunden |
| Video | – | fehlt |

**Hinweis Golden Set:** `fake_data/ERWARTET.md` sucht noch nicht abgerechnete Mehrleistungen. Für dieses Konzept zählen **Abweichungen vom Plan** (z. B. Plan Index C nicht weitergeleitet, Arbeit vor Abnahme). Die Testdaten passen dafür zum Teil schon, die Musterlösung sollte darauf umgestellt werden.
