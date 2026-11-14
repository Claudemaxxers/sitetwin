/**
 * Types mirror Hendrik's schema (uebersetzer/schema.sql). Values are used as they are,
 * nothing new is invented here: everything below is derived for display only.
 */

export interface Projekt {
  projekt: string;
  name: string | null;
  adresse: string | null;
  angelegt_am: string;
}

export interface Top {
  projekt: string;
  top: string;
  geschoss: string | null;
  raeume: string | null;
  kaeufer_status: string | null;
}

export type EintragArt =
  | "arbeit_erledigt"
  | "arbeit_geplant"
  | "anweisung"
  | "planaenderung"
  | "soll_aenderung"
  | "abnahme"
  | "behinderung"
  | "lieferung"
  | "bestaetigung"
  | "problem_behoben"
  | "frage"
  | "sonstiges";

export interface Eintrag {
  id: string;
  projekt: string;
  quelle_hash: string;
  nr: number;
  zeitpunkt: string | null;
  art: EintragArt;
  person: string | null;
  firma: string | null;
  gewerk: string | null;
  top: string | null;
  raum: string | null;
  element: string | null;
  zusammenfassung: string;
  taetigkeit: string | null;
  menge: number | null;
  einheit: string | null;
  lv_pos_nr: string | null;
  plan_nr: string | null;
  plan_index: string | null;
  entschieden_von: string | null;
  wartet_auf: string | null;
  zitat: string | null;
  konfidenz: number | null;
  unklar: boolean;
  rueckfrage: string | null;
  quelle_typ: "whatsapp" | "email" | "drive" | "call" | null;
  quelle_kanal: string | null;
  quelle_absender: string | null;
  quelle_anhang_pfad: string | null;
  quelle_text: string | null;
}

export type SignalStatus = "offen" | "in_bearbeitung" | "geloest";
export type SignalArt = "nicht_weitergegeben" | "plan_veraltet" | "reihenfolge" | "abweichung_plan" | "unklar" | "sonstiges";

export interface Signal {
  id: string;
  projekt: string;
  schluessel: string;
  art: SignalArt;
  schwere: "kritisch" | "hoch" | "mittel";
  titel: string;
  begruendung: string | null;
  anruf_text: string | null;
  top: string | null;
  raum: string | null;
  element: string | null;
  eintrag_ids: string[];
  quelle_hashes: string[];
  status: SignalStatus;
  zustaendig: string | null;
  telefon: string | null;
  anruf_id: string | null;
  angerufen_am: string | null;
  geloest_am: string | null;
  geloest_durch: string | null;
  bewertung: "berechtigt" | "fehlalarm" | null;
  erstellt_am: string;
  aktualisiert_am: string;
}

export interface Plan {
  plan_nr: string;
  plan_index: string;
  bezeichnung: string | null;
  top: string | null;
  aenderung: string | null;
  gueltig_ab: string | null;
  quelle_hash?: string | null;
}

export interface LvPosition {
  pos_nr: string;
  kurztext: string;
  einheit: string;
  menge: number;
  einheitspreis_eur: number;
}

export interface SignalVerlauf {
  id: number;
  signal_id: string;
  status: SignalStatus;
  zeitpunkt: string;
}

/** Raw message as Santino's Ablage stored it (table `quellen`). */
export interface Quelle {
  typ: "whatsapp" | "email" | "drive" | "call";
  kanal: string | null;
  absender: string | null;
  zeitpunkt: string | null;
  text: string;
  anhang_pfad: string | null;
  anhang_typ: string | null;
  anhang_name: string | null;
  content_hash: string;
}

/** Change ordered during construction (Hendrik: soll_aenderungen). Only the site management may approve. */
export interface SollAenderung {
  id: string;
  titel: string;
  neues_soll: string | null;
  top: string | null;
  raum: string | null;
  status: "vorgeschlagen" | "freigegeben" | "abgelehnt";
  vorgeschlagen_von: string | null;
  vorgeschlagen_am: string | null;
  freigegeben_von: string | null;
  freigegeben_am: string | null;
  nachweis_status: "fehlt" | "vorhanden";
  nachweis_am: string | null;
  signal_ids: string[];
}

/** Hendrik's view check_first: what gets covered next and whether that is safe. */
export interface CheckFirst {
  eintrag_id: string;
  zeitpunkt: string | null;
  art: string;
  top: string | null;
  raum: string | null;
  person: string | null;
  gewerk: string | null;
  zusammenfassung: string;
  status: "At risk" | "Resolved" | "Clear";
  signal_id: string | null;
  signal_titel: string | null;
}

export interface ProjektDaten {
  projekt: Projekt;
  quellen: Quelle[];
  sollAenderungen: SollAenderung[];
  checkFirst: CheckFirst[] | null; // null = view not available
  tops: Top[];
  eintraege: Eintrag[];
  signale: Signal[];
  verlauf: SignalVerlauf[];
  plaene: Plan[];
  lv: LvPosition[];
  geladen: string;
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

export const SIGNAL_ART_LABEL: Record<SignalArt, string> = {
  nicht_weitergegeben: "Änderung nicht weitergegeben",
  plan_veraltet: "Veralteter Plan",
  reihenfolge: "Reihenfolge",
  abweichung_plan: "Abweichung vom Plan",
  unklar: "Unklar, Rückfrage",
  sonstiges: "Sonstiges",
};

export const STATUS_LABEL: Record<SignalStatus, string> = {
  offen: "Offen",
  in_bearbeitung: "In Bearbeitung",
  geloest: "Gelöst",
};

export const ART_LABEL: Record<EintragArt, string> = {
  arbeit_erledigt: "Erledigt",
  arbeit_geplant: "Geplant",
  anweisung: "Anweisung",
  planaenderung: "Planänderung",
  soll_aenderung: "Änderung angeordnet",
  abnahme: "Abnahme",
  behinderung: "Behinderung",
  lieferung: "Lieferung",
  bestaetigung: "Bestätigt",
  problem_behoben: "Behoben",
  frage: "Frage",
  sonstiges: "Notiz",
};

/* ------------------------------------------------------------------ */
/* Building layout: floors from the `tops` table                       */
/* ------------------------------------------------------------------ */

const FLOOR_ORDER: Record<string, number> = { UG: -1, KG: -1, EG: 0, "1. OG": 1, "2. OG": 2, "3. OG": 3, "4. OG": 4, DG: 5 };

export function floorLevel(geschoss: string | null): number {
  if (!geschoss) return 0;
  if (geschoss in FLOOR_ORDER) return FLOOR_ORDER[geschoss];
  const m = geschoss.match(/(\d+)\.\s*OG/);
  return m ? Number(m[1]) : 0;
}

export interface Geschoss {
  name: string;
  level: number;
  tops: Top[];
}

export function geschosse(tops: Top[]): Geschoss[] {
  const map = new Map<string, Geschoss>();
  for (const t of tops) {
    const name = t.geschoss ?? "EG";
    if (!map.has(name)) map.set(name, { name, level: floorLevel(name), tops: [] });
    map.get(name)!.tops.push(t);
  }
  const list = [...map.values()].sort((a, b) => a.level - b.level);
  for (const g of list) g.tops.sort((a, b) => a.top.localeCompare(b.top, "de", { numeric: true }));
  return list;
}

export function raeume(top: Top): string[] {
  return (top.raeume ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Derived state at a point in time                                    */
/* ------------------------------------------------------------------ */

/** Work stages of the electrical trade, used for "how far is this unit". */
export const STUFEN = [
  { key: "rohr", label: "Leerverrohrung", lv: ["02.01.010", "03.01.020"], words: ["verrohr", "leerrohr", "leerverrohr"] },
  { key: "verteiler", label: "Verteiler", lv: ["02.05.010"], words: ["verteiler"] },
  { key: "dosen", label: "Dosen und Steckdosen", lv: ["02.01.020", "02.02.010", "02.02.020", "02.02.030", "02.04.010"], words: ["steckdose", "dose"] },
  { key: "licht", label: "Licht und Schalter", lv: ["02.03.010", "02.03.020", "03.01.010"], words: ["auslass", "schalter", "beleuchtung", "licht"] },
  { key: "melder", label: "Rauchwarnmelder", lv: ["02.07.010"], words: ["rauchwarn", "rauchmelder"] },
] as const;
export type StufeKey = (typeof STUFEN)[number]["key"];

function stufeVon(e: Eintrag): StufeKey | null {
  const text = `${e.taetigkeit ?? ""} ${e.element ?? ""}`.toLowerCase();
  for (const s of STUFEN) {
    if (e.lv_pos_nr && (s.lv as readonly string[]).includes(e.lv_pos_nr)) return s.key;
  }
  for (const s of STUFEN) if (s.words.some((w) => text.includes(w))) return s.key;
  return null;
}

export const ts = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : 0);

/** When did a signal "happen" in site time? The latest of its triggering entries. */
export function signalZeit(s: Signal, eintraege: Eintrag[]): number {
  const times = s.eintrag_ids.map((id) => ts(eintraege.find((e) => e.id === id)?.zeitpunkt)).filter(Boolean);
  return times.length ? Math.max(...times) : ts(s.erstellt_am);
}

export interface TopZustand {
  top: Top;
  fortschritt: number; // 0..1
  stufen: Record<StufeKey, Eintrag | null>;
  eintraege: Eintrag[];
  letzte: Eintrag | null;
  wartetAuf: Eintrag | null;
  geplant: Eintrag[];
  signale: Signal[]; // not solved
  plan: Plan | null;
}

export interface Mehrkosten {
  titel: string;
  top: string | null;
  betrag: number | null; // null = no unit price yet
  grundlage: string;
  eintrag: Eintrag;
}

export interface Zwilling {
  t: number;
  eintraege: Eintrag[];
  signale: Signal[]; // active (not solved) at t
  geloest: Signal[];
  tops: Record<string, TopZustand>;
  geschosse: Geschoss[];
  fortschritt: number;
  auftragssumme: number;
  mehrkosten: Mehrkosten[];
  mehrkostenSumme: number;
  behinderungen: TopZustand[];
  von: number;
  bis: number;
}

const REGIE_STUNDE = (lv: LvPosition[]) => lv.find((p) => p.pos_nr === "04.01.010")?.einheitspreis_eur ?? 0;

function lvFuer(e: Eintrag, lv: LvPosition[]): LvPosition | null {
  if (e.lv_pos_nr) return lv.find((p) => p.pos_nr === e.lv_pos_nr) ?? null;
  const text = `${e.taetigkeit ?? ""} ${e.element ?? ""}`.toLowerCase();
  if (text.includes("datendose")) return lv.find((p) => p.pos_nr === "02.04.010") ?? null;
  if (text.includes("steckdose")) return lv.find((p) => p.pos_nr === "02.02.010") ?? null;
  return null;
}

/**
 * Extra costs: work outside the contract that the site talked about.
 * Hours (Regie, waiting time, rework) at the contract rate; extra pieces at the unit price.
 * One line per unit and element, so the same thing reported three times counts once.
 */
function mehrkostenAus(eintraege: Eintrag[], lv: LvPosition[]): Mehrkosten[] {
  const rate = REGIE_STUNDE(lv);
  const lines = new Map<string, Mehrkosten>();
  for (const e of eintraege) {
    const text = `${e.taetigkeit ?? ""} ${e.element ?? ""}`.toLowerCase();
    const key = `${e.top ?? "-"}|${(e.element ?? e.taetigkeit ?? e.art).toLowerCase().split(" ")[0]}`;
    let line: Mehrkosten | null = null;
    if (e.einheit === "h" && e.menge && (e.art === "behinderung" || e.art === "arbeit_geplant" || e.art === "sonstiges")) {
      line = {
        titel: e.art === "behinderung" ? `Wartezeit${e.wartet_auf ? `: ${e.wartet_auf}` : ""}` : e.taetigkeit ?? e.zusammenfassung,
        top: e.top,
        betrag: e.menge * rate,
        grundlage: `${e.menge} h × ${rate.toFixed(2)} € Regie`,
        eintrag: e,
      };
    } else if (text.includes("zusätzlich") && e.menge) {
      const pos = lvFuer(e, lv);
      line = {
        titel: e.taetigkeit ?? e.zusammenfassung,
        top: e.top,
        betrag: pos ? e.menge * pos.einheitspreis_eur : null,
        grundlage: pos ? `${e.menge} ${e.einheit ?? "Stk"} × ${pos.einheitspreis_eur.toFixed(2)} € (${pos.pos_nr})` : "kein Einheitspreis",
        eintrag: e,
      };
    } else if ((e.art === "anweisung" || e.art === "sonstiges") && e.menge && !e.lv_pos_nr && !lvFuer(e, lv) && /m|lfm/.test(e.einheit ?? "")) {
      line = { titel: e.taetigkeit ?? e.zusammenfassung, top: e.top ?? e.raum, betrag: null, grundlage: `${e.menge} ${e.einheit}, keine LV-Position`, eintrag: e };
    }
    if (!line) continue;
    const prev = lines.get(key);
    if (!prev || (line.betrag ?? 0) > (prev.betrag ?? 0)) lines.set(key, line);
  }
  return [...lines.values()];
}

export function zwilling(d: ProjektDaten, bisZeit?: number): Zwilling {
  const alle = d.eintraege.filter((e) => e.zeitpunkt);
  const von = alle.length ? ts(alle[0].zeitpunkt) : Date.now();
  const letzte = alle.length ? ts(alle[alle.length - 1].zeitpunkt) : Date.now();
  const bis = Math.max(letzte, ...d.signale.map((s) => signalZeit(s, d.eintraege)));
  const t = bisZeit ?? Number.POSITIVE_INFINITY;
  const eintraege = d.eintraege.filter((e) => ts(e.zeitpunkt) <= t);
  const imZeitraum = d.signale.filter((s) => signalZeit(s, d.eintraege) <= t);
  const signale = imZeitraum.filter((s) => s.status !== "geloest");
  const geloest = imZeitraum.filter((s) => s.status === "geloest");

  const tops: Record<string, TopZustand> = {};
  for (const top of d.tops) {
    const own = eintraege.filter((e) => e.top === top.top);
    const stufen = Object.fromEntries(STUFEN.map((s) => [s.key, null])) as Record<StufeKey, Eintrag | null>;
    const topSignale = signale.filter((s) => s.top === top.top);
    for (const e of own) {
      if (e.art !== "arbeit_erledigt") continue;
      const k = stufeVon(e);
      if (!k) continue;
      // work done against an open signal (e.g. built from an outdated plan) does not count
      if (topSignale.some((s) => s.eintrag_ids.includes(e.id) || (s.element && e.element && s.element.toLowerCase().includes(e.element.toLowerCase().split(" ")[0])))) continue;
      stufen[k] = e;
    }
    const lastBlock = [...own].reverse().find((e) => e.art === "behinderung" || e.art === "problem_behoben");
    const plan = [...d.plaene].filter((p) => p.top === top.top && ts(p.gueltig_ab) <= t).sort((a, b) => ts(b.gueltig_ab) - ts(a.gueltig_ab))[0] ?? null;
    tops[top.top] = {
      top,
      fortschritt: Object.values(stufen).filter(Boolean).length / STUFEN.length,
      stufen,
      eintraege: own,
      letzte: own[own.length - 1] ?? null,
      wartetAuf: lastBlock?.art === "behinderung" ? lastBlock : null,
      geplant: own.filter((e) => e.art === "arbeit_geplant"),
      signale: topSignale,
      plan,
    };
  }

  const wohnungen = Object.values(tops).filter((z) => z.top.top !== "TG");
  const fortschritt = wohnungen.length ? wohnungen.reduce((a, z) => a + z.fortschritt, 0) / wohnungen.length : 0;
  const mehrkosten = mehrkostenAus(eintraege, d.lv);

  return {
    t: bisZeit ?? bis,
    eintraege,
    signale,
    geloest,
    tops,
    geschosse: geschosse(d.tops),
    fortschritt,
    auftragssumme: d.lv.reduce((a, p) => a + p.menge * p.einheitspreis_eur, 0),
    mehrkosten,
    mehrkostenSumme: mehrkosten.reduce((a, m) => a + (m.betrag ?? 0), 0),
    behinderungen: Object.values(tops).filter((z) => z.wartetAuf),
    von,
    bis,
  };
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export const eur = (n: number, digits = 0) =>
  n.toLocaleString("de-AT", { style: "currency", currency: "EUR", maximumFractionDigits: digits, minimumFractionDigits: digits });

export const pct = (n: number) => `${Math.round(n * 100)} %`;

export function zeitLabel(iso: string | number | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("de-AT", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "Europe/Vienna" }) +
    " " +
    d.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Vienna" })
  );
}

export const slug = (projekt: string) => encodeURIComponent(projekt);
