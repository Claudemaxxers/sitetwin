# Talona als Vorlage (Ground Truth für Frontend und Design)

> Quelle: talona.ai, Startseite inkl. animierter Produkt-Demo im Hero, 12 Produktseiten, /brand, /pricing, /solutions. Stand 13.11.2026.
> **Regel:** Bei jeder Design- oder Funktionsentscheidung im Frontend zuerst hier nachsehen. Nichts on top, so nah wie möglich am Original. Unser Zusatz (3D-Zwilling, Telefonagent) wird in ihre Struktur eingehängt, nicht daneben gebaut.

## 1. Das "Produktvideo"

Kein Video-File, sondern eine Animation im Hero der Startseite (ca. 16 s Schleife, HTML). Sechs Szenen, eine Geschichte: **Mark schickt eine Sprachnachricht, die Küchenwand in Unit 3 wurde 2 ft versetzt. Talona erkennt einen Change ohne Unterschrift.**

| # | Szene | Was man sieht |
|---|---|---|
| 1 | **Capture from site** | Drop-Zone "Drop site files", vier Dateien fliegen rein: `voice_note.ogg`, `IMG_0412.jpg`, `A-201_RevD.pdf`, `site_chat.txt` (blaue Pills, Dateityp-Kästchen) |
| 2 | **Analyse-Board** | Tablet mit Plan A-201 Rev D, die versetzte Wand orange schraffiert mit Warndreieck. Drumherum kleine Karten mit Eck-Markern: "Reading Rev D" (Revisionsliste A Permit, B Tender, C Construction, D Kitchen wall), "Matching…", "Searching site chat…" (Liste von Nachrichten, eine wird grün), "Checking contract" (Scope · U3, Contract §7, Spec 06 10, Allowances), "Routed to the PM" |
| 3 | **Change record** | Dokument "170 Bernard St · Change record" (Raised by Mark L., Unit 3 Level 2, CN-014, Positionen Framing labor 14 h $980, Electrical relocate 4 h $440, Materials $370, Markup 10 %, Total $1,969). Karten: "Matching to RFI… RFI-014 ↔ CN-014 Matched", "Checking sign-off… Flagged for review (Client sign-off: None, Answer by 10/23/26)", "Auto-tagging" (Memo, Amount, Trade, Unit, Cost code) |
| 4 | **App: Changes** | Desktop-Fenster (Mac-Punkte, Titel "Talona"). Seite "Changes", Tabs Overview · By trade · By unit · + New view, Suche, Karte "Last 90 days · Changes caught ›" mit Value caught $62,850 und Not yet written up $14,600, gestapeltes Flächendiagramm nach Gewerk mit Tooltip ("Wk of Mar 9 · $48,250 caught", Framing/Electrical/Plumbing/HVAC/Drywall/4 others). Buttons rechts oben: "Ask Talona" (outline) und "+ Write up change" (orange) |
| 4b | **App: Exposure** | Tabellen-Ansicht: Project 170 Bernard St, Time 13 weeks, Group Trade, Caught this quarter $62,850 ($48,250 written up), Status 31 of 38 written up. Pivot Gewerk × Tag mit +/- Beträgen |
| 5 | **App: Change-Detail** | Linke Liste "Missing info" (Kitchen wall move · No client sign-off, Floor 3 drywall · Photo needed, Riser 2 sleeve · Price missing) und "Ready for review" (Window W4 swap $1,240, Stair nosing $380), jeweils mit 2-Buchstaben-Kürzel-Badge (KW, F3, R2…). Rechts: "Draft · CN-014", Titel "Kitchen wall move", Tabs Overview · Activity, Karte **Source** (Projekt, "Voice note and photo from Mark · Tue 14:12", "See thread"), **Change details** (Raised *, Answer by *, "Drawing is A-201 Rev D · Change", Description, Estimate), "Send to client" |
| 6 | **App: Inbox** | Links Inbox mit Suche "Search site chat", Nachrichten gruppiert nach Person (Mark L.: Voice note 0:42, Delivery Thu 7am; Ana K.: Photo · U3 kitchen; Pete W.: Floor 3 ready?). Rechts "Voice note from Mark", Meta-Zeile (Person · Projekt · Datum), grün umrandete Box **"Write-up recommended"** mit 2 Bullets und Link "+ Ask Talona", darunter aufklappbar **"Change record · Drafted"** mit Unit, Trade, Drawing, Sign-off ("Request from client") |

Immer daneben: **Handy** mit der WhatsApp-Gruppe "170 Bernard St Apartments" (Pete: "Floor 3 ready for drywall tmrw?", Mark: Sprachnachricht 0:42, Ana: Foto "U3 kitchen, wall's up", grüne eigene Nachricht "Who okayed moving that wall?") und **Tablet** mit "‹ Sheets · A-201 · Level 2 plan · Rev D" und Banner "Kitchen wall moved 2 ft · Rev D · issued Oct 21 · 1 change · C ↔ D".

## 2. Produktaufbau (Click-through)

**Zwei Oberflächen:**
1. **WhatsApp** (Hauptkanal fürs Feld): Talona liest die Site-Gruppen, schreibt aus eigener Nummer, beantwortet Fragen ("Ask Talona"), schickt Morning digest und Pings. Kein Login, nichts Neues zu lernen.
2. **Web-App** fürs Büro: schmale Icon-Sidebar links (Logo, Changes/Charts, Inbox, Kalender, Ebenen/Record, Glocke), Inhalt rechts.

**Web-App-Ebenen:**
```
Projekt (Header: "170 Bernard St Apartments")
├── Changes            Overview-Chart · By trade · By unit · eigene Views
│   └── Change (CN-014) Overview | Activity · Source · Change details · Send to client
├── Inbox              Nachrichten nach Person → Nachricht → "Write-up recommended" + Change record
├── Record             Tageszeitleiste: Uhrzeit · Fakt · Ort · Gewerk · Person · Tag
├── Sheets             Pläne mit Revision, Änderung im Plan markiert (C ↔ D)
└── Alerts             "When someone mentions a change · If work is already built · Alert PM/SU · Log to Unit"
```
Multi-Site: Morning digest über alle Jobs (Status pro Job: "2 need you", "Unconfirmed", "On track").

## 3. Welche Informationen sie zeigen

| Feature | Informationen |
|---|---|
| **Project record** | pro Tag: Uhrzeit, Fakt in einem Satz, Ort (Unit/Floor · Gewerk), Person, Tag (Delivery, Change order, Progress, Issue, Request, Reported done, Fix reported). "8 entries", jede mit Quelle |
| **Changes** | Value caught, Not yet written up, nach Gewerk/Unit. Pro Change: Location, Trade, From, Evidence ("1 msg · voice · photo"), Status (Needs review, Missing price, Reviewed by …) |
| **Inbox / Write-up** | Original-Nachricht, Zusammenfassung in 2 Bullets, Unit, Trade, Drawing, Sign-off |
| **Requests** | "What you're waiting on · 4 open": was, von wem, seit wie lange, Answered/Open. Öffnet und schließt sich selbst |
| **Done vs. verified** | Reported done (Name, Zeit) vs. Verified (Name, Zeit), "Check before drywall" |
| **Check first** | Was morgen verdeckt wird: Starts (Uhrzeit, Ort · Gewerk, Person, Status Check first / At risk / Clear / Too soon) |
| **Daily log** | Weather, Manpower, Work performed, Deliveries, Inspections, Photos, Delays, Visitors → Draft → Approved |
| **Morning digest** | Needs you · Waiting on others · Decided yesterday · New on the job |
| **Ask Talona** | Antwort plus Quellen ("Pete · site group, Tue 08:40") |
| **Drafts** | RFI, Change confirmation, Notice, Owner update: Text aus dem Record, Preise bleiben leer, ein Mensch sendet |
| **Notice deadlines** | Vertragsfrist (AIA A201 21 Tage), Erinnerung 7/3/1 Tage |

Ton: kurze, konkrete Sätze, immer mit Name und Uhrzeit ("Mark · Tue 14:12"). Talona sagt nie mehr als der Record hergibt.

## 4. CI / Design-Tokens (aus dem CSS von talona.ai)

| Token | Wert | Verwendung |
|---|---|---|
| ink | `#0C0A08` | Text, Logo |
| accent | `#EE783B` (hover `#D9652A`) | **nur** Primär-Buttons und Markierungen |
| gray-light | `#F4F2F0` | Karten, Flächen ("warm grey") |
| gray-medium | `#D2CECB` | Rahmen stark |
| gray-dark | `#6E6A68` | Sekundärtext |
| hushed | `#0C0A0899` (60 % ink) | Labels |
| line | `#2121211A` | Trennlinien |
| tint / wash | `#2121210D` / `#21212106` | Hover, Hintergrundflächen |
| spring | `#5683D2` / light `#E4EBF6` | Dateien, Info, Avatar-Kürzel |
| grün | (Write-up-Box, "Matched", eigene WhatsApp-Bubble) | positive Bestätigung |

- **Schrift:** Hanken Grotesk (400 / **480** als Standard für Headlines / 600), IBM Plex Mono für Zahlen und Labels. Labels: 10–11 px, UPPERCASE, leicht gesperrt, 60 % ink.
- **Formen:** Radius 3 px (Buttons), Karten mit 1 px Linie, kaum Schatten, Weiß als Grundfläche, Punktraster im Hintergrund.
- **App-Typo:** Seitentitel ~28 px / 480, Tabs klein mit Unterstreichung, Listenzeilen dicht mit Kürzel-Badge links.
- **Diagramme:** gestapelte Flächen pro Gewerk in warmen, gedämpften Farben (orange, blau, grün, violett), Tooltip als schwarze Pille + weiße Karte.

## 5. So hängen wir unsere Daten ein (ohne Neues zu erfinden)

| Talona | Unsere Tabelle (Hendrik) |
|---|---|
| Record-Zeile | `eintraege_mit_quelle`: `zeitpunkt`, `zusammenfassung`, `top`/`raum` · `gewerk`, `person`, `art` → Tag |
| Tag-Mapping | `arbeit_erledigt` → Reported done · `abnahme` → Verified · `lieferung` → Delivery · `planaenderung` → Change order · `behinderung` → Issue · `frage` → Request · `problem_behoben` → Fix reported |
| Change / CN | `signale` (Titel, Begründung, `top`/`raum`/`element`, `eintrag_ids` = Evidence, Status `offen`→Needs review, `in_bearbeitung`, `geloest`) |
| Activity-Tab | `signal_verlauf` |
| Source-Karte | `quelle_typ`, `quelle_absender`, `quelle_anhang_pfad` (Foto), `zitat` |
| Drawing "A-201 Rev D" | `plaene_aktuell` (`plan_nr`, `plan_index`, `aenderung`) |
| Estimate / Value caught | LV-Positionen + Regiesatz (bereits abgeleitet als Mehrkosten) |
| Requests | `eintraege.wartet_auf`, `art = frage` |
| Check first | `arbeit_geplant` + Signal `reihenfolge` |
| Sheets (Tablet) | **hier sitzt unser 3D-Zwilling**: statt PDF-Plan das Geschoss/Top mit markierter Stelle |
| Morning digest / Ping | unser Telefonagent ist dieselbe Rolle, nur als Anruf |

Nicht in unseren Daten und daher weglassen: Notice deadlines (kein Vertrag), Manpower/Weather im Daily log, Kunden-Sign-off.
