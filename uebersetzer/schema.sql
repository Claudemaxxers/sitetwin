-- SiteTwin – schema of the structured database (Hendrik)
-- Steps 2 + 3 in KONZEPT.md, aligned with the Talona brief:
--   "Keep one live record of the site: what changed, who decided it, what's waiting on whom."
--   "Flag issues as they happen: a change that never reached the crew, work done out of
--    sequence, a drawing that's out of date."
--
-- Runs in the same Supabase project as `quellen` (ablage/SPEC.md §5, owned by Santino).
-- Repeatable: can be run again at any time. CAUTION: a repeated run does
-- NOT change existing tables (create ... if not exists). Column changes
-- need their own alter table.
--
-- Data flow:
--   quellen (raw data, Santino)
--     └─► Übersetzer (Hendrik) reads new sources + project timeline
--           ├─► eintraege   what / where / who / when / to which plan (1..n per source)
--           └─► plaene      new plan indices from mails and Drive
--   Checking agent reads eintraege + plaene_aktuell
--     └─► signale           deviation detected: offen → in_bearbeitung → geloest
--           └─► signal_verlauf (automatically on every status change)
--   Twin (Melih) reads everything, phone agent reads signale

-- ---------------------------------------------------------------------------
-- Cleanup: first draft (change-order model) – replaced by eintraege/signale
-- ---------------------------------------------------------------------------
drop view  if exists aenderungen_mit_belegen;
drop table if exists aenderung_belege;
drop table if exists meldungen;
drop table if exists aenderungen;

-- ---------------------------------------------------------------------------
-- Master data
-- ---------------------------------------------------------------------------

-- Projects (the twin shows several). `projekt` is the same string as in quellen.projekt.
create table if not exists projekte (
  projekt     text primary key,              -- "BV Simmering"
  name        text,
  adresse     text,
  angelegt_am timestamptz not null default now()
);

-- Apartments / areas, columns as in Tops.csv.
create table if not exists tops (
  projekt        text not null default 'BV Simmering',
  top            text not null,              -- "Top 5", "TG"
  geschoss       text,
  raeume         text,                       -- comma-separated
  kaeufer_status text,
  primary key (projekt, top)
);

-- Bill of quantities (LV): what is contractually built (e.g. 6 sockets per kitchen).
-- Basis for "built ≠ agreed". Columns as in LV_Elektro.csv.
create table if not exists lv_positionen (
  projekt           text not null default 'BV Simmering',
  pos_nr            text not null,
  kurztext          text not null,
  langtext          text,
  einheit           text not null,
  menge             numeric not null default 0,
  einheitspreis_eur numeric(10,2) not null,
  primary key (projekt, pos_nr)
);

-- Plans with index. "Which plan is valid?" = most recent index per plan_nr (view plaene_aktuell).
-- Filled by the Übersetzer as soon as a mail or Drive file brings a new index.
create table if not exists plaene (
  id            uuid primary key default gen_random_uuid(),
  projekt       text not null,
  plan_nr       text not null,               -- "E-05"
  plan_index    text not null,               -- "B", "C"
  bezeichnung   text,                        -- "Elektro Top 5"
  top           text,
  aenderung     text,                        -- what changes compared to the previous index
  gueltig_ab    timestamptz,                 -- when the index was issued (mail date)
  quelle_hash   text,                        -- = quellen.content_hash (mail or Drive file)
  erstellt_am   timestamptz not null default now(),
  unique (projekt, plan_nr, plan_index)
);

-- ---------------------------------------------------------------------------
-- Component register: target state (Soll), read automatically from plans
-- ---------------------------------------------------------------------------
-- A component = something that gets built and whose state matters: wall, line, socket,
-- distribution board, outlet, switch, detector. The Übersetzer creates components as soon as it
-- reads a plan, and assigns every message to a component (eintraege.element_id).
-- If a new plan index no longer contains a component, it becomes soll_aktiv = false
-- (e.g. distribution board in the Vorraum after index C) – work on it is then a deviation.

create table if not exists elemente (
  id               uuid primary key default gen_random_uuid(),
  projekt          text not null,
  schluessel       text not null,               -- normalised: "top 3|bad|wand b1"
  top              text,
  raum             text,
  art              text not null check (art in ('wand','leitung','dose','verteiler','auslass','schalter','melder','sonstiges')),
  bezeichnung      text not null,               -- "Wand B1 (Bad/Schlafzimmer)", "Steckdose Waschtisch"
  lage             text,                         -- as described in the plan
  anzahl           int  not null default 1,
  gehoert_zu       uuid references elemente (id) on delete set null,  -- e.g. line → wall
  soll_plan_nr     text,
  soll_plan_index  text,                         -- index that last confirmed this component
  soll_aktiv       boolean not null default true,
  quelle_hash      text,                         -- plan document (quellen.content_hash)
  erstellt_am      timestamptz not null default now(),
  aktualisiert_am  timestamptz not null default now(),
  unique (projekt, schluessel)
);
create index if not exists elemente_ort_idx on elemente (projekt, top, raum);

-- ---------------------------------------------------------------------------
-- Structured entries (step 3: "the one truth about the site")
-- ---------------------------------------------------------------------------
-- One source (message, mail, call) yields 0..n entries.
-- Idempotency: when the Übersetzer reprocesses a source, it deletes that source's entries
-- (where quelle_hash = …) and writes them again. No foreign key on quellen,
-- because Santino empties and re-imports for the demo (SPEC §6); the hash stays the same.

create table if not exists eintraege (
  id             uuid primary key default gen_random_uuid(),
  projekt        text not null,
  quelle_hash    text not null,              -- = quellen.content_hash
  nr             int  not null default 1,    -- running number within the source

  zeitpunkt      timestamptz,                -- when it happened / was said
  art            text not null check (art in (
                   'arbeit_erledigt',        -- "Top 4 Vorraum fertig verrohrt"
                   'arbeit_geplant',         -- "mache morgen zu"  → early enough to intervene
                   'anweisung',              -- someone orders / decides something
                   'planaenderung',          -- new plan index / changed execution
                   'abnahme',                -- inspection passed or not
                   'behinderung',            -- cannot work, waiting for the preceding trade
                   'lieferung',
                   'bestaetigung',           -- "Rev C gesehen", "ok, machen wir"
                   'problem_behoben',        -- feedback on the resolution of a signal
                   'frage',
                   'sonstiges',
                   'soll_aenderung',         -- "das haben wir geändert, Keller nur 3x3" → the Soll changes
                   'freigabe',               -- site management confirms/rejects a proposed Soll change
                   'nachweis')),             -- photo/PDF of a document that proves a Soll change in writing

  -- Who
  person         text,                       -- as in the original: "Thomas Meier (Krenn Bau)"
  firma          text,
  gewerk         text,                       -- "elektro", "gu", "planung", "trockenbau", …

  -- Where
  top            text,                       -- "Top 5", "TG"
  raum           text,                       -- "Abstellraum", "Stellplatz 12"
  element        text,                       -- "Wohnungsverteiler", "Wand 12", "Deckenauslass"

  -- What
  zusammenfassung text not null,             -- one sentence, German
  taetigkeit     text,                       -- normalised: "Verteiler montieren"
  menge          numeric,
  einheit        text,
  lv_pos_nr      text,                       -- matching LV position, if recognisable

  -- To which plan / who decided / who is waiting
  plan_nr        text,
  plan_index     text,                       -- index that is being worked to or that is mentioned
  entschieden_von text,                      -- for anweisung/planaenderung: who decided it
  wartet_auf     text,                       -- "Trockenbau", "Freigabe GU", …

  -- Traceability
  zitat          text,                       -- the relevant passage from the source
  konfidenz      numeric(3,2) check (konfidenz between 0 and 1),
  unklar         boolean not null default false,
  rueckfrage     text,                       -- what one would have to ask instead of guessing

  erstellt_am    timestamptz not null default now(),
  unique (quelle_hash, nr)
);
create index if not exists eintraege_projekt_zeit_idx on eintraege (projekt, zeitpunkt);
create index if not exists eintraege_ort_idx on eintraege (projekt, top, raum);

-- Checking agent: when this entry was checked (null = not yet). The Übersetzer
-- rewrites entries on reprocessing → they are automatically checked again.
alter table eintraege add column if not exists geprueft_am timestamptz;
create index if not exists eintraege_ungeprueft_idx on eintraege (projekt) where geprueft_am is null;

-- Component assignment: which component, which work step.
alter table eintraege add column if not exists element_id uuid references elemente (id) on delete set null;
alter table eintraege add column if not exists schritt text check (schritt in (
  'staenderwerk','verrohrung','leitung_eingezogen','gesetzt','angeschlossen','abnahme',
  'beplankung','spachteln','malen','montage','rueckbau','sonstiges'));
create index if not exists eintraege_element_idx on eintraege (element_id);

-- Soll changes: details from the message (reference, yes/no, new Soll, affected components).
alter table eintraege add column if not exists soll jsonb;

-- For existing databases: allow new kinds in the check.
alter table eintraege drop constraint if exists eintraege_art_check;
alter table eintraege add constraint eintraege_art_check check (art in (
  'arbeit_erledigt','arbeit_geplant','anweisung','planaenderung','abnahme','behinderung','lieferung',
  'bestaetigung','problem_behoben','frage','sonstiges','soll_aenderung','freigabe','nachweis'));

-- ---------------------------------------------------------------------------
-- Persons and roles: who may change the Soll?
-- ---------------------------------------------------------------------------
-- Only persons with darf_soll_aendern (the GC's site management, "Superintendent") can order
-- or approve a Soll change. Everyone else can only propose one.
create table if not exists personen (
  id                uuid primary key default gen_random_uuid(),
  projekt           text not null,
  name              text not null,               -- "Thomas Meier"
  aliase            text[] not null default '{}', -- spellings in the sources, e.g. "Thomas Meier (Krenn Bau)"
  firma             text,
  rolle             text not null check (rolle in ('bauleitung','projektleitung','vorarbeiter','monteur','planer','kaeufer','sonstige')),
  darf_soll_aendern boolean not null default false,
  telefon           text,
  unique (projekt, name)
);

-- ---------------------------------------------------------------------------
-- Soll changes during construction
-- ---------------------------------------------------------------------------
-- Flow (ÖNORM B 2110: order by the client, in writing for evidence):
--   Site management reports change      → status freigegeben, nachweis fehlt
--   Worker reports "wurde geändert"    → status vorgeschlagen → site management approves / rejects
--   Approved                            → component register is adjusted, related signals resolved
--   Photo/PDF of a site management document → nachweis vorhanden
create table if not exists soll_aenderungen (
  id                    uuid primary key default gen_random_uuid(),
  projekt               text not null,
  schluessel            text not null,          -- "sa|<quelle_hash>|<nr>"
  titel                 text not null,
  neues_soll            text,                   -- what applies now
  top                   text,
  raum                  text,
  element_ids           uuid[] not null default '{}',   -- affected components
  bauteile_neu          jsonb not null default '[]',    -- new Soll components (like SollElement)
  bauteile_entfallen    text[] not null default '{}',   -- keys of the components that are dropped
  status                text not null default 'vorgeschlagen' check (status in ('vorgeschlagen','freigegeben','abgelehnt')),
  vorgeschlagen_von     text,
  vorgeschlagen_am      timestamptz,
  vorschlag_eintrag     uuid references eintraege (id) on delete set null,
  freigegeben_von       text,
  freigegeben_am        timestamptz,
  freigabe_eintrag      uuid references eintraege (id) on delete set null,
  nachweis_status       text not null default 'fehlt' check (nachweis_status in ('fehlt','vorhanden')),
  nachweis_quelle_hash  text,                   -- Foto/PDF (quellen.content_hash)
  nachweis_am           timestamptz,
  signal_ids            uuid[] not null default '{}',   -- signals affected by this change
  erstellt_am           timestamptz not null default now(),
  aktualisiert_am       timestamptz not null default now(),
  unique (projekt, schluessel)
);
create index if not exists soll_aenderungen_status_idx on soll_aenderungen (projekt, status, nachweis_status);

-- ---------------------------------------------------------------------------
-- Signals (step 4 + lifecycle from KONZEPT.md)
-- ---------------------------------------------------------------------------

create table if not exists signale (
  id              uuid primary key default gen_random_uuid(),
  projekt         text not null,
  schluessel      text not null,             -- against duplicates, e.g. "top5-verteiler-index-c"
  art             text not null check (art in (
                    'nicht_weitergegeben',   -- change did not reach the crew (brief)
                    'plan_veraltet',         -- work to an old plan index (brief)
                    'reihenfolge',           -- work out of sequence, e.g. wall closed before inspection (brief)
                    'abweichung_plan',       -- built ≠ plan/LV, e.g. socket where none belongs
                    'unklar',                -- message cannot be assigned reliably → ask back
                    'sonstiges')),
  schwere         text not null default 'mittel' check (schwere in ('kritisch','hoch','mittel')),
  titel           text not null,
  begruendung     text,                      -- why the checking agent reports this
  anruf_text      text,                      -- what the phone agent should say

  top             text,
  raum            text,
  element         text,
  eintrag_ids     uuid[] not null default '{}',   -- triggering entries
  quelle_hashes   text[] not null default '{}',   -- evidence (quellen.content_hash)

  -- Lifecycle
  status          text not null default 'offen' check (status in ('offen','in_bearbeitung','geloest')),
  zustaendig      text,                      -- who gets called (foreman / site management)
  telefon         text,
  anruf_id        text,                      -- call_id of the phone agent
  angerufen_am    timestamptz,
  geloest_am      timestamptz,
  geloest_durch   uuid references eintraege (id) on delete set null,

  -- Learning loop: was the signal justified? (feedback from foreman / office)
  bewertung       text check (bewertung in ('berechtigt','fehlalarm')),
  bewertung_notiz text,

  erstellt_am     timestamptz not null default now(),
  aktualisiert_am timestamptz not null default now(),
  unique (projekt, schluessel)
);
create index if not exists signale_projekt_status_idx on signale (projekt, status);
alter table signale add column if not exists element_id uuid references elemente (id) on delete set null;

-- History: every status change as a row (for time slider and demo). Filled by trigger.
create table if not exists signal_verlauf (
  id          bigint generated always as identity primary key,
  signal_id   uuid not null references signale (id) on delete cascade,
  status      text not null,
  zeitpunkt   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Trigger
-- ---------------------------------------------------------------------------

create or replace function signale_vor_update() returns trigger
language plpgsql as $$
begin
  new.aktualisiert_am := now();
  if new.status is distinct from old.status then
    if new.status = 'geloest' and new.geloest_am is null then
      new.geloest_am := now();
    end if;
  end if;
  return new;
end;
$$;

create or replace function signale_verlauf_schreiben() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into signal_verlauf (signal_id, status) values (new.id, new.status);
  end if;
  return null;
end;
$$;

drop trigger if exists signale_vor_update on signale;
create trigger signale_vor_update before update on signale
  for each row execute function signale_vor_update();

drop trigger if exists signale_verlauf on signale;
create trigger signale_verlauf after insert or update on signale
  for each row execute function signale_verlauf_schreiben();

-- ---------------------------------------------------------------------------
-- Views for checking agent and twin
-- ---------------------------------------------------------------------------

-- Valid plan per plan_nr: the most recently issued index.
create or replace view plaene_aktuell with (security_invoker = true) as
select distinct on (projekt, plan_nr) *
from plaene
order by projekt, plan_nr, gueltig_ab desc nulls last, plan_index desc;

-- State per component: which steps are done or planned (for twin and checking agent).
create or replace view element_stand with (security_invoker = true) as
select
  el.*,
  coalesce(array_agg(distinct e.schritt) filter (where e.art = 'arbeit_erledigt' and e.schritt is not null), '{}') as schritte_erledigt,
  coalesce(array_agg(distinct e.schritt) filter (where e.art = 'arbeit_geplant'  and e.schritt is not null), '{}') as schritte_geplant,
  max(e.zeitpunkt) as letzte_meldung,
  (select count(*) from signale s where s.status <> 'geloest' and s.element_id = el.id) as offene_signale
from elemente el
left join eintraege e on e.element_id = el.id
group by el.id;

-- Open tasks for the frontend: what site management still has to do.
create or replace view offene_aufgaben with (security_invoker = true) as
select
  sa.projekt,
  case when sa.status = 'vorgeschlagen' then 'freigabe' else 'nachweis' end as aufgabe,
  case when sa.status = 'vorgeschlagen'
       then 'Soll-Änderung bestätigen oder ablehnen: ' || sa.titel
       else 'Schriftlichen Nachweis einreichen (Foto/PDF): ' || sa.titel end as titel,
  sa.id as soll_aenderung_id,
  sa.top, sa.raum, sa.neues_soll,
  coalesce(sa.freigegeben_von,
           (select string_agg(p.name, ', ') from personen p where p.projekt = sa.projekt and p.darf_soll_aendern)) as zustaendig,
  case when sa.status = 'vorgeschlagen' then sa.vorgeschlagen_am else sa.freigegeben_am end as seit
from soll_aenderungen sa
where sa.status = 'vorgeschlagen' or (sa.status = 'freigegeben' and sa.nachweis_status = 'fehlt');

-- Entries with their raw source (channel, sender, attachment) for twin and timeline.
-- talona_tag = tag in Talona's project record (see TALONA.md §3).
-- drop + create, because e.* changes with new columns in eintraege.
drop view if exists eintraege_mit_quelle;
create view eintraege_mit_quelle with (security_invoker = true) as
select
  e.*,
  q.typ         as quelle_typ,
  q.kanal       as quelle_kanal,
  q.absender    as quelle_absender,
  q.anhang_pfad as quelle_anhang_pfad,
  q.text        as quelle_text,
  case e.art
    when 'arbeit_erledigt' then 'Reported done'
    when 'arbeit_geplant'  then 'Planned'
    when 'abnahme'         then 'Verified'
    when 'lieferung'       then 'Delivery'
    when 'planaenderung'   then 'Change order'
    when 'soll_aenderung'  then 'Change order'
    when 'anweisung'       then 'Decided'
    when 'freigabe'        then 'Decided'
    when 'nachweis'        then 'Sign-off'
    when 'behinderung'     then 'Issue'
    when 'frage'           then 'Request'
    when 'problem_behoben' then 'Fix reported'
    else 'Progress'
  end as talona_tag
from eintraege e
left join quellen q on q.content_hash = e.quelle_hash;

-- "Check first" (Talona): what gets covered next (closing/boarding a wall) and whether that is safe.
--   At risk   = open sequence signal (installation missing per the plan)
--   Resolved  = there was a signal, resolved by now (installation caught up)
--   Clear     = no signal
create or replace view check_first with (security_invoker = true) as
select
  e.projekt,
  e.id            as eintrag_id,
  e.zeitpunkt,
  e.art,                                   -- arbeit_geplant = announced, arbeit_erledigt = already closed
  e.top, e.raum, e.element,
  e.person, e.gewerk,
  e.zusammenfassung,
  case
    when s.id is null then 'Clear'
    when s.status = 'geloest' then 'Resolved'
    else 'At risk'
  end             as status,
  s.id            as signal_id,
  s.titel         as signal_titel,
  s.zustaendig    as signal_zustaendig
from eintraege e
left join lateral (
  select x.id, x.status, x.titel, x.zustaendig from signale x
  where x.art = 'reihenfolge' and e.id = any(x.eintrag_ids)
  order by x.erstellt_am desc limit 1
) s on true
where e.schritt = 'beplankung' and e.art in ('arbeit_geplant', 'arbeit_erledigt');

-- ---------------------------------------------------------------------------
-- Realtime: twin gets changes live (server-side with secret key only,
-- because RLS without policies blocks the browser key).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'signale') then
    alter publication supabase_realtime add table signale;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'eintraege') then
    alter publication supabase_realtime add table eintraege;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'elemente') then
    alter publication supabase_realtime add table elemente;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'soll_aenderungen') then
    alter publication supabase_realtime add table soll_aenderungen;
  end if;
end $$;
