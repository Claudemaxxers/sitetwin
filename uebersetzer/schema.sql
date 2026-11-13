-- SiteTwin – Schema der strukturierten Datenbank (Hendrik)
-- Schritte 2 + 3 aus KONZEPT.md, ausgerichtet am Talona-Brief:
--   "Keep one live record of the site: what changed, who decided it, what's waiting on whom."
--   "Flag issues as they happen: a change that never reached the crew, work done out of
--    sequence, a drawing that's out of date."
--
-- Läuft im selben Supabase-Projekt wie `quellen` (ablage/SPEC.md §5, gehört Santino).
-- Wiederholbar: kann jederzeit erneut ausgeführt werden. ACHTUNG: Ein erneuter Lauf
-- ändert bestehende Tabellen NICHT (create ... if not exists). Spaltenänderungen
-- brauchen ein eigenes alter table.
--
-- Datenfluss:
--   quellen (Rohdaten, Santino)
--     └─► Übersetzer (Hendrik) liest neue Quellen + Projekt-Zeitachse
--           ├─► eintraege   was / wo / wer / wann / nach welchem Plan (1..n pro Quelle)
--           └─► plaene      neue Plan-Indizes aus Mails und Drive
--   Prüf-Agent liest eintraege + plaene_aktuell
--     └─► signale           Abweichung erkannt: offen → in_bearbeitung → geloest
--           └─► signal_verlauf (automatisch bei jedem Statuswechsel)
--   Zwilling (Melih) liest alles, Telefon-Agent liest signale

-- ---------------------------------------------------------------------------
-- Aufräumen: erster Entwurf (Nachtrags-Modell) – ersetzt durch eintraege/signale
-- ---------------------------------------------------------------------------
drop view  if exists aenderungen_mit_belegen;
drop table if exists aenderung_belege;
drop table if exists meldungen;
drop table if exists aenderungen;

-- ---------------------------------------------------------------------------
-- Stammdaten
-- ---------------------------------------------------------------------------

-- Projekte (der Zwilling zeigt mehrere). `projekt` ist derselbe String wie in quellen.projekt.
create table if not exists projekte (
  projekt     text primary key,              -- "BV Simmering"
  name        text,
  adresse     text,
  angelegt_am timestamptz not null default now()
);

-- Wohnungen / Bereiche, Spalten wie in Tops.csv.
create table if not exists tops (
  projekt        text not null default 'BV Simmering',
  top            text not null,              -- "Top 5", "TG"
  geschoss       text,
  raeume         text,                       -- kommagetrennt
  kaeufer_status text,
  primary key (projekt, top)
);

-- Leistungsverzeichnis: was vertraglich gebaut wird (z. B. 6 Steckdosen je Küche).
-- Grundlage für "gebaut ≠ vereinbart". Spalten wie LV_Elektro.csv.
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

-- Pläne mit Index. "Welcher Plan gilt?" = jüngster Index je plan_nr (Sicht plaene_aktuell).
-- Befüllt vom Übersetzer, sobald eine Mail oder Drive-Datei einen neuen Index bringt.
create table if not exists plaene (
  id            uuid primary key default gen_random_uuid(),
  projekt       text not null,
  plan_nr       text not null,               -- "E-05"
  plan_index    text not null,               -- "B", "C"
  bezeichnung   text,                        -- "Elektro Top 5"
  top           text,
  aenderung     text,                        -- was sich gegenüber dem Vorindex ändert
  gueltig_ab    timestamptz,                 -- wann der Index ausgegeben wurde (Mail-Datum)
  quelle_hash   text,                        -- = quellen.content_hash (Mail oder Drive-Datei)
  erstellt_am   timestamptz not null default now(),
  unique (projekt, plan_nr, plan_index)
);

-- ---------------------------------------------------------------------------
-- Bauteil-Register: Soll-Zustand, automatisch aus Plänen gelesen
-- ---------------------------------------------------------------------------
-- Ein Bauteil = etwas, das gebaut wird und dessen Zustand zählt: Wand, Leitung, Dose,
-- Verteiler, Auslass, Schalter, Melder. Der Übersetzer legt Bauteile an, sobald er einen
-- Plan liest, und ordnet jede Nachricht einem Bauteil zu (eintraege.element_id).
-- Gibt ein neuer Plan-Index ein Bauteil nicht mehr her, wird es soll_aktiv = false
-- (z. B. Verteiler im Vorraum nach Index C) – Arbeit daran ist dann eine Abweichung.

create table if not exists elemente (
  id               uuid primary key default gen_random_uuid(),
  projekt          text not null,
  schluessel       text not null,               -- normalisiert: "top 3|bad|wand b1"
  top              text,
  raum             text,
  art              text not null check (art in ('wand','leitung','dose','verteiler','auslass','schalter','melder','sonstiges')),
  bezeichnung      text not null,               -- "Wand B1 (Bad/Schlafzimmer)", "Steckdose Waschtisch"
  lage             text,                         -- wie im Plan beschrieben
  anzahl           int  not null default 1,
  gehoert_zu       uuid references elemente (id) on delete set null,  -- z. B. Leitung → Wand
  soll_plan_nr     text,
  soll_plan_index  text,                         -- Index, der dieses Bauteil zuletzt bestätigt hat
  soll_aktiv       boolean not null default true,
  quelle_hash      text,                         -- Plan-Dokument (quellen.content_hash)
  erstellt_am      timestamptz not null default now(),
  aktualisiert_am  timestamptz not null default now(),
  unique (projekt, schluessel)
);
create index if not exists elemente_ort_idx on elemente (projekt, top, raum);

-- ---------------------------------------------------------------------------
-- Strukturierte Einträge (Schritt 3: "die eine Wahrheit über die Baustelle")
-- ---------------------------------------------------------------------------
-- Eine Quelle (Nachricht, Mail, Anruf) ergibt 0..n Einträge.
-- Idempotenz: Verarbeitet der Übersetzer eine Quelle neu, löscht er deren Einträge
-- (where quelle_hash = …) und schreibt sie neu. Kein Fremdschlüssel auf quellen,
-- weil Santino für die Demo leert und neu importiert (SPEC §6); der Hash bleibt gleich.

create table if not exists eintraege (
  id             uuid primary key default gen_random_uuid(),
  projekt        text not null,
  quelle_hash    text not null,              -- = quellen.content_hash
  nr             int  not null default 1,    -- laufende Nummer innerhalb der Quelle

  zeitpunkt      timestamptz,                -- wann es passiert ist / gesagt wurde
  art            text not null check (art in (
                   'arbeit_erledigt',        -- "Top 4 Vorraum fertig verrohrt"
                   'arbeit_geplant',         -- "mache morgen zu"  → früh genug zum Eingreifen
                   'anweisung',              -- jemand ordnet etwas an / entscheidet
                   'planaenderung',          -- neuer Plan-Index / geänderte Ausführung
                   'abnahme',                -- Prüfung bestanden oder nicht
                   'behinderung',            -- kann nicht arbeiten, wartet auf Vorgewerk
                   'lieferung',
                   'bestaetigung',           -- "Rev C gesehen", "ok, machen wir"
                   'problem_behoben',        -- Rückmeldung zur Lösung eines Signals
                   'frage',
                   'sonstiges',
                   'soll_aenderung',         -- "das haben wir geändert, Keller nur 3x3" → Soll ändert sich
                   'freigabe',               -- Bauleitung bestätigt/lehnt eine vorgeschlagene Soll-Änderung ab
                   'nachweis')),             -- Foto/PDF eines Dokuments, das eine Soll-Änderung schriftlich belegt

  -- Wer
  person         text,                       -- wie im Original: "Thomas Meier (Krenn Bau)"
  firma          text,
  gewerk         text,                       -- "elektro", "gu", "planung", "trockenbau", …

  -- Wo
  top            text,                       -- "Top 5", "TG"
  raum           text,                       -- "Abstellraum", "Stellplatz 12"
  element        text,                       -- "Wohnungsverteiler", "Wand 12", "Deckenauslass"

  -- Was
  zusammenfassung text not null,             -- ein Satz, deutsch
  taetigkeit     text,                       -- normalisiert: "Verteiler montieren"
  menge          numeric,
  einheit        text,
  lv_pos_nr      text,                       -- passende LV-Position, falls erkennbar

  -- Nach welchem Plan / wer hat entschieden / wer wartet
  plan_nr        text,
  plan_index     text,                       -- Index, nach dem gearbeitet wird oder der genannt ist
  entschieden_von text,                      -- bei anweisung/planaenderung: wer hat es entschieden
  wartet_auf     text,                       -- "Trockenbau", "Freigabe GU", …

  -- Nachvollziehbarkeit
  zitat          text,                       -- die relevante Stelle aus der Quelle
  konfidenz      numeric(3,2) check (konfidenz between 0 and 1),
  unklar         boolean not null default false,
  rueckfrage     text,                       -- was man nachfragen müsste, statt zu raten

  erstellt_am    timestamptz not null default now(),
  unique (quelle_hash, nr)
);
create index if not exists eintraege_projekt_zeit_idx on eintraege (projekt, zeitpunkt);
create index if not exists eintraege_ort_idx on eintraege (projekt, top, raum);

-- Prüf-Agent: wann dieser Eintrag geprüft wurde (null = noch nicht). Der Übersetzer
-- schreibt Einträge bei Neuverarbeitung neu → sie werden automatisch erneut geprüft.
alter table eintraege add column if not exists geprueft_am timestamptz;
create index if not exists eintraege_ungeprueft_idx on eintraege (projekt) where geprueft_am is null;

-- Bauteil-Zuordnung: welches Bauteil, welcher Arbeitsschritt.
alter table eintraege add column if not exists element_id uuid references elemente (id) on delete set null;
alter table eintraege add column if not exists schritt text check (schritt in (
  'staenderwerk','verrohrung','leitung_eingezogen','gesetzt','angeschlossen','abnahme',
  'beplankung','spachteln','malen','montage','rueckbau','sonstiges'));
create index if not exists eintraege_element_idx on eintraege (element_id);

-- Soll-Änderungen: Details aus der Nachricht (Bezug, ja/nein, neues Soll, betroffene Bauteile).
alter table eintraege add column if not exists soll jsonb;

-- Für bestehende Datenbanken: neue Arten im Check zulassen.
alter table eintraege drop constraint if exists eintraege_art_check;
alter table eintraege add constraint eintraege_art_check check (art in (
  'arbeit_erledigt','arbeit_geplant','anweisung','planaenderung','abnahme','behinderung','lieferung',
  'bestaetigung','problem_behoben','frage','sonstiges','soll_aenderung','freigabe','nachweis'));

-- ---------------------------------------------------------------------------
-- Personen und Rollen: wer darf das Soll ändern?
-- ---------------------------------------------------------------------------
-- Nur Personen mit darf_soll_aendern (Bauleitung des GU, "Superintendent") können eine
-- Soll-Änderung anordnen oder freigeben. Alle anderen können sie nur vorschlagen.
create table if not exists personen (
  id                uuid primary key default gen_random_uuid(),
  projekt           text not null,
  name              text not null,               -- "Thomas Meier"
  aliase            text[] not null default '{}', -- Schreibweisen in den Quellen, z. B. "Thomas Meier (Krenn Bau)"
  firma             text,
  rolle             text not null check (rolle in ('bauleitung','projektleitung','vorarbeiter','monteur','planer','kaeufer','sonstige')),
  darf_soll_aendern boolean not null default false,
  telefon           text,
  unique (projekt, name)
);

-- ---------------------------------------------------------------------------
-- Soll-Änderungen während der Bauphase
-- ---------------------------------------------------------------------------
-- Ablauf (ÖNORM B 2110: Anordnung des AG, aus Beweisgründen schriftlich):
--   Bauleitung meldet Änderung          → status freigegeben, nachweis fehlt
--   Arbeiter meldet "wurde geändert"   → status vorgeschlagen → Bauleitung gibt frei / lehnt ab
--   Freigegeben                         → Bauteil-Register wird angepasst, zugehörige Signale gelöst
--   Foto/PDF eines Dokuments der Bauleitung → nachweis vorhanden
create table if not exists soll_aenderungen (
  id                    uuid primary key default gen_random_uuid(),
  projekt               text not null,
  schluessel            text not null,          -- "sa|<quelle_hash>|<nr>"
  titel                 text not null,
  neues_soll            text,                   -- was jetzt gilt
  top                   text,
  raum                  text,
  element_ids           uuid[] not null default '{}',   -- betroffene Bauteile
  bauteile_neu          jsonb not null default '[]',    -- neue Soll-Bauteile (wie SollElement)
  bauteile_entfallen    text[] not null default '{}',   -- Schlüssel der Bauteile, die wegfallen
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
  signal_ids            uuid[] not null default '{}',   -- Signale, die diese Änderung betrifft
  erstellt_am           timestamptz not null default now(),
  aktualisiert_am       timestamptz not null default now(),
  unique (projekt, schluessel)
);
create index if not exists soll_aenderungen_status_idx on soll_aenderungen (projekt, status, nachweis_status);

-- ---------------------------------------------------------------------------
-- Signale (Schritt 4 + Lebenszyklus aus KONZEPT.md)
-- ---------------------------------------------------------------------------

create table if not exists signale (
  id              uuid primary key default gen_random_uuid(),
  projekt         text not null,
  schluessel      text not null,             -- gegen Duplikate, z. B. "top5-verteiler-index-c"
  art             text not null check (art in (
                    'nicht_weitergegeben',   -- Änderung hat die Crew nicht erreicht (Brief)
                    'plan_veraltet',         -- Arbeit nach altem Plan-Index (Brief)
                    'reihenfolge',           -- Arbeit außer Reihenfolge, z. B. Wand zu vor Abnahme (Brief)
                    'abweichung_plan',       -- gebaut ≠ Plan/LV, z. B. Steckdose wo keine hingehört
                    'unklar',                -- Nachricht nicht sicher zuordenbar → Rückfrage
                    'sonstiges')),
  schwere         text not null default 'mittel' check (schwere in ('kritisch','hoch','mittel')),
  titel           text not null,
  begruendung     text,                      -- warum der Prüf-Agent das meldet
  anruf_text      text,                      -- was der Telefon-Agent sagen soll

  top             text,
  raum            text,
  element         text,
  eintrag_ids     uuid[] not null default '{}',   -- auslösende Einträge
  quelle_hashes   text[] not null default '{}',   -- Belege (quellen.content_hash)

  -- Lebenszyklus
  status          text not null default 'offen' check (status in ('offen','in_bearbeitung','geloest')),
  zustaendig      text,                      -- wer angerufen wird (Vorarbeiter / Bauleitung)
  telefon         text,
  anruf_id        text,                      -- call_id des Telefon-Agenten
  angerufen_am    timestamptz,
  geloest_am      timestamptz,
  geloest_durch   uuid references eintraege (id) on delete set null,

  -- Lernschleife: war das Signal berechtigt? (Feedback von Vorarbeiter / Büro)
  bewertung       text check (bewertung in ('berechtigt','fehlalarm')),
  bewertung_notiz text,

  erstellt_am     timestamptz not null default now(),
  aktualisiert_am timestamptz not null default now(),
  unique (projekt, schluessel)
);
create index if not exists signale_projekt_status_idx on signale (projekt, status);
alter table signale add column if not exists element_id uuid references elemente (id) on delete set null;

-- Verlauf: jeder Statuswechsel als Zeile (für Zeitregler und Demo). Wird per Trigger gefüllt.
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
-- Sichten für Prüf-Agent und Zwilling
-- ---------------------------------------------------------------------------

-- Gültiger Plan je plan_nr: der jüngste ausgegebene Index.
create or replace view plaene_aktuell with (security_invoker = true) as
select distinct on (projekt, plan_nr) *
from plaene
order by projekt, plan_nr, gueltig_ab desc nulls last, plan_index desc;

-- Stand je Bauteil: welche Schritte erledigt bzw. geplant sind (für Zwilling und Prüf-Agent).
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

-- Offene Aufgaben fürs Frontend: was die Bauleitung noch tun muss.
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

-- Einträge mit ihrer Rohquelle (Kanal, Absender, Anhang) für Zwilling und Timeline.
create or replace view eintraege_mit_quelle with (security_invoker = true) as
select
  e.*,
  q.typ         as quelle_typ,
  q.kanal       as quelle_kanal,
  q.absender    as quelle_absender,
  q.anhang_pfad as quelle_anhang_pfad,
  q.text        as quelle_text
from eintraege e
left join quellen q on q.content_hash = e.quelle_hash;

-- ---------------------------------------------------------------------------
-- Realtime: Zwilling bekommt Änderungen live (nur serverseitig mit Secret-Key,
-- weil RLS ohne Policies den Browser-Key sperrt).
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
