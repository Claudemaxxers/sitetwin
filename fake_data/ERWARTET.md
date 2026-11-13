# Lösungsschlüssel (Golden Set)

**Nicht** in einen Prompt geben, nur zum Vergleichen.

Maßstab ist `KONZEPT.md`: Der Prüf-Agent erkennt **Abweichungen vom aktuellen Plan** und ruft den Vorarbeiter an, **bevor** es zu Nacharbeit kommt. Abschnitt 1–3 sind dafür der Schlüssel. Abschnitt 4 (nicht abgerechnete Mehrleistungen) ist ein Nebenprodukt derselben Daten und kein Signal.

Daten: Basisdaten (`whatsapp/`, `email/`, `drive/`, `calls/`, 10.–13.11.) plus Szenario [`szenarien/wand_top5/`](szenarien/wand_top5/README.md) (13.11. abends bis 14.11. früh). Begriffe für `art`, `schwere` und `status` wie in `uebersetzer/schema.sql`.

## 1. Signale – was der Prüf-Agent finden muss (2)

Gewertet wird: richtiger Ort, früh genug, richtige Person angerufen. Die `art` ist ein Richtwert.

| ID | art · schwere | Was | Wo | Frühester Auslöser | Belege | Anruf an | Kern des Anrufs |
|---|---|---|---|---|---|---|---|
| S1 | `reihenfolge` · kritisch | Trockenbau will die Wand schließen, bevor die Elektro-Verrohrung für den Wohnungsverteiler (Plan E-05 **Index C**) drin ist. Elektro hat den Umbau erst für Montag geplant. | Top 5, Abstellraum | **Fr 13.11. 17:20**, Sprachnachricht PTT-20261113-WA0022 („Samstag um sieben machen wir zu“) | PTT-20261113-WA0022, Foto IMG-20261113-WA0021, Mail Planer 10.11. + Plan Index C, Call 13.11. 16:10 („Umbau machen wir Montag“), WA 12.11. 15:50 („Trockenbau Top 5 erst nächste Woche“) | Stefan Huber (Vorarbeiter Elektro) | „Nicht zumachen lassen: Im Abstellraum Top 5 müssen vorher eure Rohre für den Verteiler rein.“ |
| S2 | `plan_veraltet` · hoch (Ursache: `nicht_weitergegeben`) | Wohnungsverteiler wurde nach **Index B** im Vorraum gesetzt und verrohrt, obwohl seit 10.11. 09:12 Index C gilt (Abstellraum). Die Mail des Planers hat die Crew nicht erreicht. | Top 5, Vorraum / Abstellraum | **Do 12.11. 10:47–10:52** („Am Plan ist Vorraum“, „Laut unserem Plan Vorraum“) – knapp 5 Stunden bevor es das Büro selbst merkt (15:38) | WA 12.11. 10:47, 10:52, 15:38, 15:41, PTT-20261112-WA0015, Mail Planer 10.11. + Plan Index C, Plan Index B (Drive) | Stefan Huber | „Für Top 5 gilt Index C, der Verteiler gehört in den Abstellraum. Im Vorraum nicht weiterbauen.“ |

## 2. Lebenszyklus der Signale

| Signal | offen | in_bearbeitung | geloest |
|---|---|---|---|
| S1 | Fr 13.11. 17:20 (Sprachnachricht) | Fr 13.11. 17:31, Signal-Anruf `call_3b91d7f2` ist durch | **Sa 14.11. 06:52–06:55**: Foto IMG-20261114-WA0004 + „Verteilerkasten gesetzt und 3x M25 … nach Index C“ + PTT-20261114-WA0005 („Wand kann zu“). Vor 07:00, also rechtzeitig. |
| S2 | Do 12.11. 10:47 | sobald der Vorarbeiter angerufen wurde (in den Basisdaten gibt es dazu keinen Anruf) | **Sa 14.11. 06:52**: Arbeit nach dem gültigen Index C am selben Ort |

Die Nachricht vom 14.11. 06:05 („ziehen jetzt die Verrohrung ein“) löst noch **nichts**: Die Arbeit läuft erst an.

## 3. Kein Signal – Fallen für den Prüf-Agent

| ID | Was | Warum kein Signal |
|---|---|---|
| F1 | „Top 4 Vorraum und Küche machen wir am Montag zu“ (13.11. 17:22) | Elektro ist dort fertig: Vorraum verrohrt am 10.11. (Foto), 3 zusätzliche Küchensteckdosen gesetzt am 12.11. |
| F2 | „Passt danke, wir machen jetzt zu“ (14.11. 07:03) | Wand Top 5 geht erst zu, nachdem Elektro fertig gemeldet hat |
| F3 | Wartezeit Top 3, Trockenbau nicht fertig (13.11. 07:02–10:05) | Behinderung: Niemand baut falsch, der Vorarbeiter meldet es selbst. Kaufmännisch relevant (Abschnitt 4), kein Anruf. |
| F4 | „Geht inzwischen in Top 8“ / „Top 8 hat noch keinen Estrich“ (13.11. 07:20–07:22) | Die Crew geht nicht hinein, es wird nichts außer Reihenfolge gearbeitet |
| F5 | Angeordnete Änderungen: 3 Steckdosen Top 4 Küche, Deckenauslass Top 2 versetzt, Wallbox-Leerverrohrung TG | Vom GU angeordnet und so ausgeführt. Müssen als Einträge erfasst sein (`anweisung`, `entschieden_von`), sind aber keine Abweichung, die einen Anruf braucht. |
| F6 | Sonderwunsch Top 7, zusätzliche Datendose | Noch nicht ausgeführt, Kostenfreigabe ausständig. Solange niemand baut: kein Signal. |
| F7 | Top 6 Bad: 2 Steckdosen IP44 | Steht so im LV 02.02.020 |
| F8 | Rauchmelder Top 1/2 noch nicht montiert | Laut LV 02.07.010 erst nach dem Maler |
| F9 | Lieferungen FI/LS, M32, UP-Dosen | Material |
| F10 | „Diese Nachricht wurde gelöscht.“ und Systemzeilen | Kein Inhalt. Systemzeilen filtert schon die Ablage. |

## 4. Nebenprodukt: nicht abgerechnete Mehrleistungen (6)

Kein Signal, kein Anruf. Zeigt, was dieselben Daten zusätzlich hergeben. Preise aus `drive/Projekt_Simmering/LV_Elektro.csv`, Regiestunde Monteur 62,00 €.

| ID | Was | Wo | Angeordnet von | Belege (Quellen) | LV | Freigabe | Ausgeführt | Betrag ca. |
|---|---|---|---|---|---|---|---|---|
| A1 | 3 zusätzliche Schukosteckdosen über Arbeitsplatte | Top 4, Küche | T. Meier (GU), WhatsApp 12.11. 07:08 | WA 12.11. 07:08, 07:10 („Schriftlich kommt das noch?“), Foto IMG-20261112-WA0012 | 02.02.010 Mengenmehrung (LV: 6 Stk Küche) | **nur WhatsApp, schriftlich ausständig** | ja, 12.11. | 3 × 38,50 = **115,50 €** |
| A2 | 1 zusätzliche Datendose Cat6 doppelt | Top 7, Arbeitszimmer | Käufer-Sonderwunsch über GU | WA 13.11. 14:12, Mail 13.11. 14:30 + Sonderwunsch_Top7.pdf | 02.04.010 + 02.04.020 (LV: 2 Stk/Top) | **Kostenfreigabe Käufer ausständig** | nein, Angebot offen | 89,00 + ~15 lfm × 2,90 = **~132,50 €** |
| A3 | Leerverrohrung Wallbox M32 ~35 lfm | TG, Stellplatz 12 | T. Meier (GU), WhatsApp 11.11. 12:40 + Protokoll BB7 Pkt. 4.2 | WA 11.11. 12:31–12:40, Mail Protokoll 11.11., Lieferung M32 (Mail 12.11.) | **keine Position** (03.01.020 ist M25, nur Beleuchtung) → neue Position | im Protokoll festgehalten, Angebot bis 18.11. fällig | laufend | kein EP, Preis neu bilden (orientierend ~280 €) |
| A4 | Umbau Wohnungsverteiler Vorraum → Abstellraum (Folge von S2) | Top 5 | Bauträger über Planer (Plan E-05 Index C) | Mail Planer 10.11. + Plan Index C, Plan Index B, WA 12.11. 10:47–15:50, PTT-20261112-WA0015, Call 13.11. | 02.05.010 Lage lt. Index B → Planänderung durch AG | **strittig**: Index C kam am 10.11., wurde intern nicht weitergeleitet | Wandseite am 14.11., Rest Montag | 6 h × 62 = **372 €** + Material |
| A5 | Wartezeit wegen Behinderung (Trockenbau nicht fertig) | Top 3 | – (Behinderung durch Vorgewerk) | WA 13.11. 07:02–10:05, Foto IMG-20261113-WA0002, Mail Behinderungsanzeige 13.11. 11:05, Antwort GU 16:45, Call 13.11. | 04.01.010 Regie (nur auf schriftl. Anordnung) | Behinderung angezeigt ✓, **Regiebericht bis 20.11. fällig** | ja | 2 × 3 h × 62 = **372 €** |
| A6 | Deckenauslass um 80 cm Richtung Fenster versetzt | Top 2, Wohnzimmer | T. Meier (GU), nur Sprachnachricht | PTT-20261112-WA0009, WA 12.11. 09:20, Call 13.11. | 02.03.010 Lage lt. Plan → Änderung | **nur mündlich (Sprachnachricht)** | ja | 1,5 h × 62 + 3 m Rohr = **~110 €** |

**Summe ohne A2: ca. 1.250 € nicht abgerechnete Mehrleistung in 4 Tagen auf einer Baustelle.**

## 5. Was die Ablage liefern muss (Tests für die Ablage)

Basisdaten:
- WhatsApp: **39 Nachrichten** (ohne 5 Systemzeilen), davon 5 mit Anhang (3 Fotos, 2 Sprachnachrichten), 1 gelöschte Nachricht mit `meta.geloescht = true`
- Absender exakt: `Andrea Gruber`, `Stefan Huber`, `Ali Demir`, `Thomas Meier (Krenn Bau)`
- E-Mail: **6 Mails + 2 PDF-Anhänge** = 8 RawItems; Betreff korrekt dekodiert (Umlaute, Gedankenstrich)
- Drive: **5 Dateien** (2 CSV, 1 MD, 2 PDF) – je Datei ein RawItem
- Call: 1 RawItem mit Transkript als Text
- Zweiter Import derselben Dateien: **0 neue, alle Duplikate**

Szenario `szenarien/wand_top5/`:
- WhatsApp: **10 Nachrichten** (ohne 1 Systemzeile), davon 4 mit Anhang (2 Fotos, 2 Sprachnachrichten mit Sidecar-Transkript); neuer Absender `Marko Novak (Novak Trockenbau)`; gleicher Kanal wie die Basisdaten
- Call: 1 RawItem (`call_3b91d7f2`)
- Nach Basisdaten importiert: **11 neue**, keine Kollision mit den 53 vorhandenen; zusammen 64
