-- Stammdaten BV Simmering, erzeugt aus fake_data/drive/Projekt_Simmering/*.csv
-- Nach schema.sql ausführen. Wiederholbar (on conflict do nothing).
-- Pläne (plaene) befüllt der Übersetzer aus den Quellen, weil er dafür den content_hash braucht.

insert into projekte (projekt, name, adresse) values
  ('BV Simmering', 'BV Simmeringer Hauptstraße 112 (fiktiv)', 'Simmeringer Hauptstraße 112, 1110 Wien')
on conflict do nothing;

insert into lv_positionen (projekt, pos_nr, kurztext, langtext, einheit, menge, einheitspreis_eur) values
  ('BV Simmering', '01.01.010', 'Baustelleneinrichtung', 'Einrichten und Räumen der Baustelle inkl. Container und Lager', 'PA', 1, 1850.00),
  ('BV Simmering', '02.01.010', 'Leerverrohrung UP M20', 'Flexibles Installationsrohr M20 unter Putz, inkl. Befestigung, Wohnungen', 'lfm', 1200, 4.80),
  ('BV Simmering', '02.01.020', 'Unterputzdose Standard', 'Geräte-/Abzweigdose UP 60 mm', 'Stk', 420, 3.90),
  ('BV Simmering', '02.02.010', 'Schukosteckdose UP komplett', 'Schutzkontaktsteckdose UP inkl. Dose, Zuleitung und Abdeckung. Menge lt. Plan Index B: je Top 21 Stk, davon Küche 6 Stk', 'Stk', 168, 38.50),
  ('BV Simmering', '02.02.020', 'Steckdose Bad IP44', 'Feuchtraumsteckdose IP44 im Bad, je Top 2 Stk (Waschtisch, Waschmaschine)', 'Stk', 16, 52.00),
  ('BV Simmering', '02.02.030', 'Herdanschlussdose', 'Herdanschlussdose 5-polig inkl. Zuleitung 5x2,5', 'Stk', 8, 64.00),
  ('BV Simmering', '02.03.010', 'Lichtauslass Decke', 'Deckenauslass inkl. Dose und Zuleitung, Lage lt. Plan Index B', 'Stk', 64, 41.00),
  ('BV Simmering', '02.03.020', 'Schalter UP', 'Aus-/Wechselschalter UP komplett', 'Stk', 72, 34.00),
  ('BV Simmering', '02.04.010', 'Datendose Cat6 doppelt', 'Datendose 2x RJ45 Cat6 UP, je Top 2 Stk (Wohnzimmer, Schlafzimmer)', 'Stk', 16, 89.00),
  ('BV Simmering', '02.04.020', 'Netzwerkkabel Cat6', 'Installationskabel Cat6 S/FTP, verlegt im Rohr', 'lfm', 900, 2.90),
  ('BV Simmering', '02.05.010', 'Wohnungsverteiler UP 3-reihig', 'Wohnungsverteiler UP 3-reihig komplett bestückt, Lage lt. Plan Index B', 'Stk', 8, 640.00),
  ('BV Simmering', '02.05.020', 'FI/LS-Schalter', 'FI/LS-Kombischalter 1+N 30 mA', 'Stk', 64, 72.00),
  ('BV Simmering', '02.06.010', 'Wohnungsstation Gegensprechanlage', 'Video-Wohnungsstation inkl. Verkabelung', 'Stk', 8, 210.00),
  ('BV Simmering', '02.07.010', 'Rauchwarnmelder', 'Rauchwarnmelder nach ÖNORM, Montage nach Malerarbeiten', 'Stk', 32, 39.00),
  ('BV Simmering', '03.01.010', 'TG-Beleuchtung LED Feuchtraum', 'LED-Feuchtraumleuchte Tiefgarage inkl. Montage', 'Stk', 24, 118.00),
  ('BV Simmering', '03.01.020', 'Leerverrohrung TG M25', 'Installationsrohr M25 Aufputz Tiefgarage, nur für Beleuchtung', 'lfm', 180, 6.20),
  ('BV Simmering', '04.01.010', 'Regiestunde Monteur', 'Nur auf schriftliche Anordnung des AG, Nachweis durch Regiebericht', 'h', 0, 62.00),
  ('BV Simmering', '04.01.020', 'Regiestunde Helfer', 'Nur auf schriftliche Anordnung des AG, Nachweis durch Regiebericht', 'h', 0, 48.00),
  ('BV Simmering', '05.01.010', 'Erdung und Potentialausgleich', 'Fundamenterder, Haupterdungsschiene, Potentialausgleich', 'PA', 1, 2400.00),
  ('BV Simmering', '05.01.020', 'Prüfung und E-Befund je Top', 'Erstprüfung und Befund je Wohnung', 'Stk', 8, 180.00)
on conflict do nothing;

insert into tops (projekt, top, geschoss, raeume, kaeufer_status) values
  ('BV Simmering', 'Top 1', 'EG', 'Vorraum,Wohnzimmer,Küche,Schlafzimmer,Bad,WC,Abstellraum', 'verkauft'),
  ('BV Simmering', 'Top 2', 'EG', 'Vorraum,Wohnzimmer,Küche,Schlafzimmer,Bad,WC', 'verkauft'),
  ('BV Simmering', 'Top 3', '1. OG', 'Vorraum,Wohnzimmer,Küche,Schlafzimmer,Kinderzimmer,Bad,WC', 'frei'),
  ('BV Simmering', 'Top 4', '1. OG', 'Vorraum,Wohnzimmer,Küche,Schlafzimmer,Bad,WC', 'verkauft'),
  ('BV Simmering', 'Top 5', '1. OG', 'Vorraum,Wohnzimmer,Küche,Schlafzimmer,Bad,WC,Abstellraum', 'verkauft'),
  ('BV Simmering', 'Top 6', '2. OG', 'Vorraum,Wohnzimmer,Küche,Schlafzimmer,Bad,WC', 'frei'),
  ('BV Simmering', 'Top 7', '2. OG', 'Vorraum,Wohnzimmer,Küche,Schlafzimmer,Arbeitszimmer,Bad,WC', 'verkauft'),
  ('BV Simmering', 'Top 8', '2. OG', 'Vorraum,Wohnzimmer,Küche,Schlafzimmer,Bad,WC,Abstellraum', 'frei'),
  ('BV Simmering', 'TG', 'UG', 'Fahrgasse,Stellplätze 1-24,Technikraum', '-')
on conflict do nothing;

-- Personen und Rollen (aus fake_data/drive/Projekt_Simmering/Projekt.md).
-- Nur die Bauleitung des GU darf das Soll ändern (Entscheidung Team, 13.11.).
insert into personen (projekt, name, aliase, firma, rolle, darf_soll_aendern, telefon) values
  ('BV Simmering', 'Thomas Meier', '{"Thomas Meier (Krenn Bau)","Thomas Meier <t.meier@krenn-bau.example>","Meier"}', 'Krenn Bau GmbH', 'bauleitung', true, null),
  ('BV Simmering', 'Andrea Gruber', '{"Andrea Gruber <a.gruber@elektro-gruber.example>","Gruber"}', 'Elektro Gruber GmbH', 'projektleitung', false, null),
  ('BV Simmering', 'Stefan Huber', '{"Stefan"}', 'Elektro Gruber GmbH', 'vorarbeiter', false, '+43 660 0000000'),
  ('BV Simmering', 'Ali Demir', '{}', 'Elektro Gruber GmbH', 'monteur', false, null),
  ('BV Simmering', 'Martin Lechner', '{"DI Martin Lechner","DI Martin Lechner <m.lechner@tb-lechner.example>"}', 'TB Lechner Elektroplanung', 'planer', false, null),
  ('BV Simmering', 'Marko Novak', '{"Marko Novak (Novak Trockenbau)","Marko","Novak"}', 'Novak Trockenbau', 'vorarbeiter', false, null)
on conflict do nothing;
