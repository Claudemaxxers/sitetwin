# Lösungsschlüssel (Golden Set) – was der Übersetzer finden muss

Damit testet ihr den Übersetzer (Claude-Extraktion + LV-Abgleich). **Nicht** in den Prompt geben, nur zum Vergleichen.
Preise aus `drive/Projekt_Simmering/LV_Elektro.csv`, Regiestunde Monteur 62,00 €.

## Echte Mehrleistungen / Nachträge (6)

| ID | Was | Wo | Angeordnet von | Belege (Quellen) | LV | Freigabe | Ausgeführt | Betrag ca. |
|---|---|---|---|---|---|---|---|---|
| A1 | 3 zusätzliche Schukosteckdosen über Arbeitsplatte | Top 4, Küche | T. Meier (GU), WhatsApp 12.11. 07:08 | WA 12.11. 07:08, 07:10 („Schriftlich kommt das noch?“), Foto IMG-20261112-WA0012 | 02.02.010 Mengenmehrung (LV: 6 Stk Küche) | **nur WhatsApp, schriftlich ausständig** | ja, 12.11. | 3 × 38,50 = **115,50 €** |
| A2 | 1 zusätzliche Datendose Cat6 doppelt | Top 7, Arbeitszimmer | Käufer-Sonderwunsch über GU | WA 13.11. 14:12, Mail 13.11. 14:30 + Sonderwunsch_Top7.pdf | 02.04.010 + 02.04.020 (LV: 2 Stk/Top) | **Kostenfreigabe Käufer ausständig** | nein, Angebot offen | 89,00 + ~15 lfm × 2,90 = **~132,50 €** |
| A3 | Leerverrohrung Wallbox M32 ~35 lfm | TG, Stellplatz 12 | T. Meier (GU), WhatsApp 11.11. 12:40 + Protokoll BB7 Pkt. 4.2 | WA 11.11. 12:31–12:40, Mail Protokoll 11.11., Lieferung M32 (Mail 12.11.) | **keine Position** (03.01.020 ist M25, nur Beleuchtung) → neue Position | im Protokoll festgehalten, Angebot bis 18.11. fällig | laufend | kein EP, Preis neu bilden (orientierend ~280 €) |
| A4 | Umbau Wohnungsverteiler Vorraum → Abstellraum | Top 5 | Bauträger über Planer (Plan E-05 Index C) | Mail Planer 10.11. + Plan Index C, Plan Index B, WA 12.11. 10:47–15:50, PTT-20261112-WA0015, Call 13.11. | 02.05.010 Lage lt. Index B → Planänderung durch AG | **strittig**: Index C kam am 10.11., wurde intern nicht weitergeleitet | nein, Montag geplant | 6 h × 62 = **372 €** + Material |
| A5 | Wartezeit wegen Behinderung (Trockenbau nicht fertig) | Top 3 | – (Behinderung durch Vorgewerk) | WA 13.11. 07:02–10:05, Foto IMG-20261113-WA0002, Mail Behinderungsanzeige 13.11. 11:05, Antwort GU 16:45, Call 13.11. | 04.01.010 Regie (nur auf schriftl. Anordnung) | Behinderung angezeigt ✓, **Regiebericht bis 20.11. fällig** | ja | 2 × 3 h × 62 = **372 €** |
| A6 | Deckenauslass um 80 cm Richtung Fenster versetzt | Top 2, Wohnzimmer | T. Meier (GU), nur Sprachnachricht | PTT-20261112-WA0009, WA 12.11. 09:20, Call 13.11. | 02.03.010 Lage lt. Plan → Änderung | **nur mündlich (Sprachnachricht)** | ja | 1,5 h × 62 + 3 m Rohr = **~110 €** |

**Summe ohne A2: ca. 1.250 € nicht abgerechnete Mehrleistung in 4 Tagen auf einer Baustelle.** Das ist eure Demo-Zahl.

## Fallen – dürfen NICHT als Mehrleistung erkannt werden

| ID | Was | Warum keine Mehrleistung |
|---|---|---|
| D1 | Top 6 Bad: 2 Steckdosen IP44 | Im LV 02.02.020 (2 Stk je Top) |
| D2 | Rauchmelder Top 1/2 noch nicht montiert | Im LV 02.07.010, Montage laut LV erst nach Maler |
| D3 | Lieferungen FI/LS, M32, UP-Dosen | Material, kein eigener Nachtrag (M32 ist nur Beleg für A3) |
| D4 | „Diese Nachricht wurde gelöscht.“ | Systemtext, ignorieren |
| D5 | Top 4 Vorraum fertig verrohrt | Normale LV-Leistung |
| D6 | Systemzeilen (Gruppe erstellt, hinzugefügt, Verschlüsselung) | Keine Nachricht – schon die Ablage filtert die raus |

## Was die Ablage selbst liefern muss (Tests für deinen Teil)

- WhatsApp: **39 Nachrichten** (ohne 5 Systemzeilen), davon 5 mit Anhang (3 Fotos, 2 Sprachnachrichten), 1 gelöschte Nachricht mit `meta.geloescht = true`
- Absender exakt: `Andrea Gruber`, `Stefan Huber`, `Ali Demir`, `Thomas Meier (Krenn Bau)`
- E-Mail: **6 Mails + 2 PDF-Anhänge** = 8 RawItems; Betreff korrekt dekodiert (Umlaute, Gedankenstrich)
- Drive: **5 Dateien** (2 CSV, 1 MD, 2 PDF) – je Datei ein RawItem
- Call: 1 RawItem mit Transkript als Text
- Zweiter Import derselben Dateien: **0 neue, alle Duplikate**
