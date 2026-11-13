-- SiteTwin – Schema des Übersetzers (Hendrik)
-- Läuft im selben Supabase-Projekt wie `quellen` (ablage/SPEC.md §5).
-- Einmal im SQL-Editor ausführen. Die Ablage liest diese Tabellen nicht.
--
-- Datenfluss:  quellen (Rohdaten, Santino)
--                └─► Übersetzer liest die ganze Projekt-Zeitachse
--                      ├─► aenderungen        (eine Zeile pro erkannter Änderung)
--                      ├─► aenderung_belege   (n:m auf quellen.content_hash)
--                      └─► meldungen          (Warnungen für Bauleitung / Zwilling)
--              lv_positionen + tops = Stammdaten zum Abgleich

-- ---------------------------------------------------------------------------
-- Stammdaten
-- ---------------------------------------------------------------------------

-- Leistungsverzeichnis. Spalten wie in fake_data/drive/Projekt_Simmering/LV_Elektro.csv.
-- Befüllen: uebersetzer/stammdaten_bv_simmering.sql (die CSV nutzt ';', das mag der Table-Editor-Import evtl. nicht).
create table lv_positionen (
  projekt          text not null default 'BV Simmering',
  pos_nr           text not null,
  kurztext         text not null,
  langtext         text,
  einheit          text not null,
  menge            numeric not null default 0,
  einheitspreis_eur numeric(10,2) not null,
  primary key (projekt, pos_nr)
);

-- Wohnungen / Bereiche. Spalten wie in Tops.csv; raeume als kommagetrennter Text.
create table tops (
  projekt        text not null default 'BV Simmering',
  top            text not null,              -- "Top 5", "TG"
  geschoss       text,
  raeume         text,
  kaeufer_status text,
  primary key (projekt, top)
);

-- ---------------------------------------------------------------------------
-- Änderungen (Kern des Übersetzers)
-- ---------------------------------------------------------------------------

create table aenderungen (
  id               uuid primary key default gen_random_uuid(),
  projekt          text not null,
  -- Stabiler Schlüssel, damit ein erneuter Übersetzer-Lauf dieselbe Änderung
  -- aktualisiert statt sie doppelt anzulegen, z. B. "top5-verteiler-versetzt".
  schluessel       text not null,

  titel            text not null,            -- "Wohnungsverteiler Vorraum → Abstellraum"
  beschreibung     text,
  art              text not null check (art in (
                     'mengenmehrung',        -- mehr Stück als im LV (A1)
                     'zusatzleistung',       -- keine LV-Position, neue Leistung (A3)
                     'planaenderung',        -- Lage/Ausführung geändert, Plan oder mündlich (A4, A6)
                     'sonderwunsch',         -- Käuferwunsch über GU (A2)
                     'behinderung',          -- Wartezeit durch Vorgewerk (A5)
                     'sonstiges')),

  -- Wo
  top              text,                     -- "Top 5", "TG"
  raum             text,                     -- "Abstellraum", "Stellplatz 12"
  ort_detail       text,

  -- Wer hat es angeordnet, wann
  angeordnet_von   text,                     -- wie im Original: "Thomas Meier (Krenn Bau)"
  angeordnet_am    timestamptz,

  -- Abgleich mit dem LV
  lv_pos_nr        text,                     -- null = keine passende Position
  menge            numeric,
  einheit          text,
  einheitspreis_eur numeric(10,2),
  betrag_eur       numeric(10,2),
  betrag_geschaetzt boolean not null default false,

  -- Stand der Freigabe durch den Auftraggeber
  freigabe         text not null default 'ausstaendig' check (freigabe in (
                     'muendlich',            -- nur Anruf / Sprachnachricht
                     'chat',                 -- nur WhatsApp
                     'protokolliert',        -- im Baubesprechungsprotokoll
                     'schriftlich',          -- Mail / unterschriebener Auftrag
                     'ausstaendig',          -- angefragt, noch keine Antwort
                     'strittig')),
  ausfuehrung      text not null default 'offen' check (ausfuehrung in ('offen','laufend','erledigt')),
  naechster_schritt text,                    -- "Regiebericht schicken"
  frist            date,                     -- "bis 20.11."

  -- Nachvollziehbarkeit (die Jury belohnt Ehrlichkeit)
  konfidenz        numeric(3,2) check (konfidenz between 0 and 1),
  begruendung      text,                     -- warum der Übersetzer das so einordnet

  -- Entscheidung durch den Menschen (Lernschleife)
  status           text not null default 'offen' check (status in ('offen','bestaetigt','verworfen','abgerechnet')),
  entschieden_von  text,
  entschieden_am   timestamptz,
  kommentar        text,

  erstellt_am      timestamptz not null default now(),
  aktualisiert_am  timestamptz not null default now(),
  unique (projekt, schluessel)
);
create index aenderungen_projekt_idx on aenderungen (projekt, status);

-- Belege: welche Rohdaten eine Änderung stützen. n:m.
-- Bewusst KEIN Fremdschlüssel auf quellen: Santino leert für die Demo die Tabelle
-- und importiert neu (SPEC §6). Der content_hash bleibt dabei gleich.
create table aenderung_belege (
  aenderung_id  uuid not null references aenderungen (id) on delete cascade,
  quelle_hash   text not null,             -- = quellen.content_hash
  rolle         text check (rolle in ('anordnung','bestaetigung','ausfuehrung','nachweis','plan','widerspruch')),
  zitat         text,                      -- die relevante Stelle, kurz
  primary key (aenderung_id, quelle_hash)
);
create index aenderung_belege_hash_idx on aenderung_belege (quelle_hash);

-- ---------------------------------------------------------------------------
-- Meldungen (Abgleich Soll/Ist – Owner noch offen)
-- ---------------------------------------------------------------------------
-- Probleme, solange noch jemand eingreifen kann (Talona-Brief): Änderung nicht
-- weitergegeben, veralteter Plan, Arbeit außer Reihenfolge, Freigabe fehlt, Frist läuft ab.

create table meldungen (
  id            uuid primary key default gen_random_uuid(),
  projekt       text not null,
  schluessel    text not null,             -- wie bei aenderungen, gegen Duplikate
  aenderung_id  uuid references aenderungen (id) on delete set null,
  art           text not null check (art in (
                  'nicht_weitergegeben',   -- z. B. Plan Index C kam, Monteure haben Index B
                  'plan_veraltet',
                  'reihenfolge',
                  'freigabe_fehlt',
                  'frist',
                  'abweichung_plan',       -- gebaut ≠ Plan, z. B. Steckdose wo keine hingehört
                  'sonstiges')),
  schwere       text not null default 'mittel' check (schwere in ('kritisch','hoch','mittel')),
  titel         text not null,
  text          text,
  top           text,
  raum          text,
  quelle_hashes text[] not null default '{}',
  status        text not null default 'offen' check (status in ('offen','erledigt','ignoriert')),
  erstellt_am   timestamptz not null default now(),
  aktualisiert_am timestamptz not null default now(),
  unique (projekt, schluessel)
);
create index meldungen_projekt_idx on meldungen (projekt, status);

-- ---------------------------------------------------------------------------
-- aktualisiert_am automatisch setzen
-- ---------------------------------------------------------------------------

create or replace function setze_aktualisiert_am() returns trigger
language plpgsql as $$
begin
  new.aktualisiert_am := now();
  return new;
end;
$$;

create trigger aenderungen_aktualisiert before update on aenderungen
  for each row execute function setze_aktualisiert_am();
create trigger meldungen_aktualisiert before update on meldungen
  for each row execute function setze_aktualisiert_am();

-- ---------------------------------------------------------------------------
-- Sicht für Dashboard / Zwilling (Melih): Änderung inkl. Belegen in einer Zeile
-- ---------------------------------------------------------------------------

create view aenderungen_mit_belegen with (security_invoker = true) as
select
  a.*,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'quelle_hash', b.quelle_hash,
        'rolle',       b.rolle,
        'zitat',       b.zitat,
        'typ',         q.typ,
        'absender',    q.absender,
        'zeitpunkt',   q.zeitpunkt,
        'anhang_pfad', q.anhang_pfad
      ) order by q.zeitpunkt
    ) filter (where b.quelle_hash is not null),
    '[]'::jsonb
  ) as belege
from aenderungen a
left join aenderung_belege b on b.aenderung_id = a.id
left join quellen q          on q.content_hash = b.quelle_hash
group by a.id;
