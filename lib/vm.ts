/**
 * View model: puts Hendrik's structured data into the shapes of Talona's product
 * (TALONA.md §2/§3): changes with CN numbers, requests, done vs. verified, daily log,
 * morning digest, alert rules, exposure. Pure functions, no I/O.
 */
import { DEMO_SCHAETZUNG } from "./demo-preise";
import { raeume, ts, type Eintrag, type LvPosition, type Plan, type ProjektDaten, type Quelle, type Signal, type SignalArt } from "./twin-model";

/* ------------------------------------------------------------------ */
/* People and companies (from Projekt.md in the drive folder)          */
/* ------------------------------------------------------------------ */

export interface Person {
  name: string;
  kurz: string; // "Stefan H."
  vorname: string;
  initialen: string;
  firma: string | null;
  rolle: string | null;
  farbe: string;
}

const FARBEN = ["#d9c7b3", "#c9d6e6", "#cfe0cf", "#e6d0c9", "#d7cfe6", "#e3dcc0", "#c7dcdc"];

export function personenVerzeichnis(d: ProjektDaten) {
  const md = d.quellen.find((q) => q.typ === "drive" && /\|\s*Rolle\s*\|\s*Firma\s*\|\s*Person/i.test(q.text))?.text ?? "";
  const rows: { rolle: string; firma: string; person: string }[] = [];
  let firma = "";
  let rolle = "";
  for (const line of md.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 5 || /^-+$/.test(cells[1]) || cells[1] === "Rolle") continue;
    if (cells[1]) rolle = cells[1];
    if (cells[2]) firma = cells[2];
    const person = cells[3].split(",")[0].trim();
    if (person && person !== "–") rows.push({ rolle, firma, person });
  }
  const cache = new Map<string, Person>();
  return (raw: string | null | undefined): Person => {
    const name = (raw ?? "Unbekannt").replace(/<.*?>/g, "").trim() || "Unbekannt";
    const hit = cache.get(name);
    if (hit) return hit;
    const klammer = name.match(/\((.*?)\)/)?.[1] ?? null;
    const clean = name.replace(/\(.*?\)/g, "").replace(/^(DI|Ing\.|Dr\.)\s+/, "").trim();
    const row = rows.find((r) => clean.includes(r.person.replace(/^(DI|Ing\.|Dr\.)\s+/, "")) || r.person.includes(clean));
    const teile = clean.split(/\s+/);
    const p: Person = {
      name: clean,
      vorname: teile[0],
      kurz: teile[1] ? `${teile[0]} ${teile[1][0]}.` : teile[0],
      initialen: ((teile[0]?.[0] ?? "") + (teile[1]?.[0] ?? "")).toUpperCase(),
      firma: row?.firma ?? klammer,
      rolle: row?.rolle?.split(/[(/]/)[0].trim() ?? null,
      farbe: FARBEN[[...clean].reduce((a, c) => a + c.charCodeAt(0), 0) % FARBEN.length],
    };
    cache.set(name, p);
    return p;
  };
}
export type Personen = ReturnType<typeof personenVerzeichnis>;

/** Company for a role in Projekt.md, e.g. the developer who gets change confirmations. */
export function firmaFuerRolle(d: ProjektDaten, re: RegExp) {
  const md = d.quellen.find((q) => q.typ === "drive" && /\|\s*Rolle\s*\|/i.test(q.text))?.text ?? "";
  for (const line of md.split("\n")) {
    const c = line.split("|").map((x) => x.trim());
    if (c.length > 3 && re.test(c[1])) return c[2];
  }
  return null;
}

/** The general contractor is who the office works for; their written word is a sign-off. */
const istGU = (p: Person) => /krenn|generalunternehm/i.test(`${p.firma} ${p.rolle}`);

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

export const istFoto = (p: string | null | undefined) => !!p && /\.(jpe?g|png|webp|heic)$/i.test(p);
export const istAudio = (p: string | null | undefined) => !!p && /\.(opus|ogg|m4a|mp3|wav)$/i.test(p);

export interface Belege {
  nachrichten: number;
  sprache: boolean;
  foto: boolean;
  mail: boolean;
  anruf: boolean;
  text: string; // "2 Nachr. · Sprache · Foto"
}

export function belege(list: Eintrag[]): Belege {
  const hashes = new Set(list.map((e) => e.quelle_hash));
  const b = {
    nachrichten: hashes.size,
    sprache: list.some((e) => istAudio(e.quelle_anhang_pfad)),
    foto: list.some((e) => istFoto(e.quelle_anhang_pfad)),
    mail: list.some((e) => e.quelle_typ === "email"),
    anruf: list.some((e) => e.quelle_typ === "call"),
  };
  const parts = [`${b.nachrichten} ${b.nachrichten === 1 ? "Nachr." : "Nachr."}`];
  if (b.sprache) parts.push("Sprache");
  if (b.foto) parts.push("Foto");
  if (b.mail) parts.push("Mail");
  if (b.anruf) parts.push("Anruf");
  return { ...b, text: parts.join(" · ") };
}

/* ------------------------------------------------------------------ */
/* Themes: what an entry is about, so messages about one thing group   */
/* ------------------------------------------------------------------ */

const THEMEN: { key: string; re: RegExp; label: string }[] = [
  { key: "wallbox", re: /wallbox|m32/i, label: "Leerverrohrung Wallbox" },
  { key: "verteiler", re: /verteiler/i, label: "Wohnungsverteiler versetzen" },
  { key: "datendose", re: /datendose|cat ?6/i, label: "Zusätzliche Datendose" },
  { key: "steckdose", re: /steckdose/i, label: "Zusätzliche Steckdosen" },
  { key: "auslass", re: /auslass/i, label: "Deckenauslass versetzen" },
  { key: "rauchmelder", re: /rauchwarn|rauchmelder/i, label: "Rauchwarnmelder" },
  { key: "leerverrohrung", re: /leerverrohr|verrohr|leerrohr/i, label: "Leerverrohrung" },
  { key: "wand", re: /\bwand|ständerwerk|zumach/i, label: "Wand schließen" },
];

export function thema(e: Eintrag): string | null {
  const text = `${e.element ?? ""} ${e.taetigkeit ?? ""}`;
  for (const t of THEMEN) if (t.re.test(text)) return t.key;
  const lang = e.zusammenfassung;
  for (const t of THEMEN.slice(0, 5)) if (t.re.test(lang)) return t.key;
  return null;
}
const themaLabel = (key: string) => THEMEN.find((t) => t.key === key)?.label ?? key;

/* ------------------------------------------------------------------ */
/* Changes (Talona: potential change orders, CN-014 …)                 */
/* ------------------------------------------------------------------ */

export type Ton = "grau" | "blau" | "gruen" | "orange" | "amber" | "rot";

export interface Schaetzung {
  betrag: number;
  grundlage: string;
  quelle: "lv" | "regie" | "kalkulation";
}

export interface Aenderung {
  key: string;
  nr: string; // CN-001
  art: "aenderung" | "planaenderung" | "wartezeit";
  titel: string;
  kuerzel: string;
  beschreibung: string;
  top: string | null;
  raum: string | null;
  ort: string;
  gewerk: string;
  von: Person;
  imAuftrag: Person | null;
  erhoben: string;
  antwortBis: string;
  plan: Plan | null;
  schaetzung: Schaetzung | null;
  freigabe: { von: Person; zeit: string | null; wie: string } | null;
  fehlend: string[];
  status: { label: string; ton: Ton };
  bereit: boolean; // "written up": priced and signed off
  eintraege: Eintrag[];
  belege: Belege;
  signale: Signal[];
}

export const GRUND = {
  freigabe: "Keine schriftliche Freigabe",
  bauleitung: "Freigabe durch Bauleitung fehlt",
  nachweis: "Schriftlicher Nachweis fehlt",
  abgelehnt: "Von der Bauleitung abgelehnt",
  preis: "Preis fehlt",
  foto: "Foto fehlt",
  kosten: "Kostenübernahme offen",
  abweichung: "Abweichung in Bearbeitung",
};

/**
 * Signal lifecycle as the office sees it (KONZEPT.md): every signal triggers the phone agent,
 * so anything not solved is "in Bearbeitung". `angerufen` is set once the agent wrote back.
 */
export function signalStand(s: Signal) {
  const geloest = s.status === "geloest";
  return {
    aktiv: !geloest,
    label: geloest ? "Gelöst" : "In Bearbeitung",
    ton: (geloest ? "gruen" : "blau") as Ton,
    schritt: geloest ? 2 : 1, // 0 erkannt, 1 Vorarbeiter angerufen, 2 gelöst
    angerufen: s.angerufen_am,
  };
}

/** Theme from free text (titles of Hendrik's soll_aenderungen). */
function themaText(text: string): string | null {
  for (const t of THEMEN) if (t.re.test(text)) return t.key;
  return null;
}

function rechne(list: Eintrag[], lv: LvPosition[]): Schaetzung | null {
  const regie = lv.find((p) => p.pos_nr === "04.01.010")?.einheitspreis_eur ?? 0;
  for (const e of list) {
    if (e.menge && e.einheit === "h" && regie) return { betrag: e.menge * regie, grundlage: `${e.menge} h × ${regie.toFixed(2)} € Regie`, quelle: "regie" };
    const pos = e.lv_pos_nr ? lv.find((p) => p.pos_nr === e.lv_pos_nr) : null;
    if (e.menge && pos && (!e.einheit || e.einheit.toLowerCase().startsWith(pos.einheit.toLowerCase().slice(0, 2)))) {
      return { betrag: e.menge * pos.einheitspreis_eur, grundlage: `${e.menge} ${pos.einheit} × ${pos.einheitspreis_eur.toFixed(2)} € (LV ${pos.pos_nr})`, quelle: "lv" };
    }
  }
  return null;
}

const plus3 = (iso: string) => new Date(ts(iso) + 3 * 86400000).toISOString();
const kurzTop = (top: string | null, fallback: string) => (top ? top.replace(/^Top\s*/i, "T").replace(/\s+/g, "").slice(0, 3).toUpperCase() : fallback.slice(0, 2).toUpperCase());

export function aenderungen(d: ProjektDaten, pers: Personen, signale: Signal[]): Aenderung[] {
  const entries = [...d.eintraege].filter((e) => e.zeitpunkt).sort((a, b) => ts(a.zeitpunkt) - ts(b.zeitpunkt));
  const gruppen = new Map<string, { art: Aenderung["art"]; list: Eintrag[] }>();
  const keyOf = (e: Eintrag) => {
    const t = thema(e);
    if (e.art === "behinderung" && !(t === "wallbox")) return e.top ? `${e.top}|wartezeit` : null;
    if (!t || !e.top || t === "wand" || t === "rauchmelder" || t === "leerverrohrung") return null;
    return `${e.top}|${t}`;
  };
  const startet = (e: Eintrag) =>
    e.art === "soll_aenderung" ||
    e.art === "planaenderung" ||
    (e.art === "behinderung" && !!e.top) ||
    ((e.art === "sonstiges" || e.art === "anweisung") && /zusätzlich|freigabe|angebot|auftrag/i.test(`${e.zusammenfassung} ${e.wartet_auf ?? ""}`));
  // pass 1: open groups; pass 2: attach every other entry about the same thing as evidence
  for (const e of entries) {
    const k = keyOf(e);
    if (!k || !startet(e)) continue;
    if (!gruppen.has(k)) gruppen.set(k, { art: e.art === "planaenderung" ? "planaenderung" : e.art === "behinderung" ? "wartezeit" : "aenderung", list: [] });
  }
  for (const e of entries) {
    const k = keyOf(e);
    if (k && gruppen.has(k)) gruppen.get(k)!.list.push(e);
  }

  const out: Aenderung[] = [];
  let n = 0;
  for (const [key, g] of [...gruppen.entries()].sort((a, b) => ts(a[1].list[0].zeitpunkt) - ts(b[1].list[0].zeitpunkt))) {
    n++;
    const [top, t] = key.split("|");
    const list = g.list;
    const erster = list.find((e) => e.art === "soll_aenderung" || e.art === "planaenderung" || e.art === "behinderung") ?? list[0];
    const von = pers(erster.person);
    const auftraggeber = erster.entschieden_von && !erster.entschieden_von.includes(von.vorname) ? pers(erster.entschieden_von) : null;
    const raum = list.find((e) => e.raum && e.art !== "behinderung")?.raum ?? erster.raum;
    const plan = d.plaene.filter((p) => p.top === top && p.gueltig_ab).sort((a, b) => ts(b.gueltig_ab) - ts(a.gueltig_ab))[0] ?? d.plaene.find((p) => p.top === top) ?? null;
    const schaetzung = rechne(list, d.lv) ?? DEMO_SCHAETZUNG[key] ?? null;
    // sign-off: Hendrik's soll_aenderungen when it knows this change, otherwise a written order by the GC
    const soll = d.sollAenderungen.find((sa) => sa.top === top && themaText(`${sa.titel} ${sa.neues_soll ?? ""}`) === t);
    const freigabeE = soll
      ? null
      : list.find((e) => {
          const p = pers(e.person);
          return istGU(p) && e.quelle_typ === "email" && ["anweisung", "bestaetigung", "soll_aenderung", "planaenderung"].includes(e.art) && !/freigabe|kosten/i.test(e.wartet_auf ?? "");
        });
    const freigabe: Aenderung["freigabe"] =
      soll?.status === "freigegeben"
        ? { von: pers(soll.freigegeben_von), zeit: soll.freigegeben_am, wie: soll.nachweis_status === "vorhanden" ? "schriftlich" : "mündlich, Nachweis fehlt" }
        : freigabeE
          ? { von: pers(freigabeE.person), zeit: freigabeE.zeitpunkt, wie: "per Mail" }
          : null;
    const sig = signale.filter(
      (s) => (soll?.signal_ids.includes(s.id) ?? false) || (s.top === top && (t === "wartezeit" ? s.art === "reihenfolge" : `${s.element ?? ""} ${s.titel}`.toLowerCase().includes(t.slice(0, 6)))),
    );
    const fehlend: string[] = [];
    if (soll?.status === "abgelehnt") fehlend.push(GRUND.abgelehnt);
    else if (soll?.status === "vorgeschlagen") fehlend.push(GRUND.bauleitung);
    else if (soll?.status === "freigegeben" && soll.nachweis_status === "fehlt") fehlend.push(GRUND.nachweis);
    else if (!soll && g.art !== "wartezeit" && !freigabeE) fehlend.push(GRUND.freigabe);
    if (!schaetzung) fehlend.push(GRUND.preis);
    if (list.some((e) => e.art === "arbeit_erledigt") && !list.some((e) => istFoto(e.quelle_anhang_pfad))) fehlend.push(GRUND.foto);
    if (list.some((e) => e.art === "frage" && /kost/i.test(`${e.wartet_auf} ${e.zusammenfassung}`))) fehlend.push(GRUND.kosten);
    if (sig.some((s) => s.status !== "geloest")) fehlend.unshift(GRUND.abweichung);
    const status: Aenderung["status"] = !fehlend.length
      ? { label: "Bereit zur Prüfung", ton: "orange" }
      : fehlend[0] === GRUND.preis
        ? { label: "Preis fehlt", ton: "amber" }
        : fehlend[0] === GRUND.abweichung
          ? { label: "Abweichung in Bearbeitung", ton: "blau" }
          : { label: fehlend[0], ton: "orange" };
    const titel =
      g.art === "wartezeit"
        ? `Wartezeit ${top}${erster.wartet_auf ? ` · ${erster.wartet_auf.replace(/\(.*?\)/g, "").trim()}` : ""}`
        : themaLabel(t);
    out.push({
      key,
      nr: `CN-${String(n).padStart(3, "0")}`,
      art: g.art,
      titel,
      kuerzel: kurzTop(top, titel),
      beschreibung: erster.zusammenfassung,
      top,
      raum,
      ort: [top, raum].filter(Boolean).join(" · "),
      gewerk: gewerkLabel(list.find((e) => e.gewerk && e.gewerk !== "planung")?.gewerk ?? erster.gewerk),
      von,
      imAuftrag: auftraggeber,
      erhoben: erster.zeitpunkt!,
      antwortBis: plus3(erster.zeitpunkt!),
      plan,
      schaetzung,
      freigabe,
      fehlend,
      status,
      bereit: !fehlend.length,
      eintraege: list,
      belege: belege(list),
      signale: sig,
    });
  }
  return out.sort((a, b) => ts(b.erhoben) - ts(a.erhoben));
}

export const GEWERK: Record<string, string> = {
  elektro: "Elektro",
  gu: "Generalunternehmer",
  planung: "Planung",
  trockenbau: "Trockenbau",
  grosshandel: "Großhandel",
  hkls: "HKLS",
  maler: "Maler",
  estrich: "Estrich",
};
export const gewerkLabel = (g: string | null | undefined) => (g ? GEWERK[g] ?? g.charAt(0).toUpperCase() + g.slice(1) : "Allgemein");

/* ------------------------------------------------------------------ */
/* Requests: "what you're waiting on"                                  */
/* ------------------------------------------------------------------ */

export interface Anfrage {
  id: string;
  titel: string;
  top: string | null;
  gefragtVon: Person;
  seit: string;
  alterTage: number;
  beantwortet: Eintrag | null;
  eintrag: Eintrag;
}

export function anfragen(d: ProjektDaten, pers: Personen, jetzt: number): Anfrage[] {
  const seen = new Set<string>();
  const out: Anfrage[] = [];
  const entries = d.eintraege.filter((e) => e.zeitpunkt).sort((a, b) => ts(a.zeitpunkt) - ts(b.zeitpunkt));
  for (const e of entries) {
    if (e.art === "behinderung") continue;
    const offen = e.art === "frage" || (!!e.wartet_auf && /freigabe|anordnung|angebot|auftrag|klärung|kosten|regiebericht|bestätigung/i.test(e.wartet_auf));
    if (!offen) continue;
    const k = `${e.top}|${(e.wartet_auf ?? e.zusammenfassung).toLowerCase().split(/\s+/).slice(0, 2).join(" ")}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const t = thema(e);
    const antwort = entries.find(
      (x) =>
        ts(x.zeitpunkt) > ts(e.zeitpunkt) &&
        x.top === e.top &&
        x.person !== e.person &&
        (t ? thema(x) === t : true) &&
        ["bestaetigung", "problem_behoben", "anweisung", "planaenderung"].includes(x.art),
    );
    const titel = e.wartet_auf ? `${e.wartet_auf.replace(/\.$/, "")}${e.top ? ` · ${e.top}` : ""}` : e.zusammenfassung;
    out.push({
      id: e.id,
      titel: titel.charAt(0).toUpperCase() + titel.slice(1),
      top: e.top,
      gefragtVon: pers(e.person),
      seit: e.zeitpunkt!,
      alterTage: Math.max(0, Math.floor((jetzt - ts(e.zeitpunkt)) / 86400000)),
      beantwortet: antwort ?? null,
      eintrag: e,
    });
  }
  return out.sort((a, b) => Number(!!a.beantwortet) - Number(!!b.beantwortet) || ts(a.seit) - ts(b.seit));
}

export const alterLabel = (tage: number, seit: string, jetzt: number) => {
  if (tage >= 1) return `${tage} ${tage === 1 ? "Tag" : "Tage"}`;
  const h = Math.max(1, Math.round((jetzt - ts(seit)) / 3600000));
  return `${h} ${h === 1 ? "Stunde" : "Stunden"}`;
};
export const alterTon = (tage: number): Ton => (tage >= 3 ? "rot" : tage >= 2 ? "amber" : "grau");

/* ------------------------------------------------------------------ */
/* Done vs. verified, check first                                      */
/* ------------------------------------------------------------------ */

export interface Leistung {
  id: string;
  top: string;
  titel: string;
  gewerk: string;
  gemeldet: { von: Person; zeit: string };
  geprueft: { von: Person; zeit: string } | null;
  pruefenVor: { person: string | null; zeitpunkt: string | null } | null; // closing the wall would cover it
}

export function leistungen(d: ProjektDaten, pers: Personen): Leistung[] {
  const entries = d.eintraege.filter((e) => e.zeitpunkt && e.top).sort((a, b) => ts(a.zeitpunkt) - ts(b.zeitpunkt));
  const map = new Map<string, Leistung>();
  for (const e of entries) {
    if (e.art !== "arbeit_erledigt") continue;
    const t = thema(e) ?? e.gewerk ?? "arbeit";
    const k = `${e.top}|${e.raum ?? ""}|${t}|${e.gewerk}`;
    const titel = `${e.raum ? `${e.raum} · ` : ""}${e.element ?? e.taetigkeit ?? gewerkLabel(e.gewerk)}`;
    map.set(k, { id: k, top: e.top!, titel, gewerk: gewerkLabel(e.gewerk), gemeldet: { von: pers(e.person), zeit: e.zeitpunkt! }, geprueft: null, pruefenVor: null });
  }
  for (const l of map.values()) {
    const [top, raum] = l.id.split("|");
    const pruef = entries.find(
      (e) => e.top === top && ts(e.zeitpunkt) > ts(l.gemeldet.zeit) && (e.art === "abnahme" || (e.art === "bestaetigung" && istGU(pers(e.person)))) && (!raum || !e.raum || e.raum === raum),
    );
    if (pruef) l.geprueft = { von: pers(pruef.person), zeit: pruef.zeitpunkt! };
    // check first: Hendrik's view check_first when available ("At risk" = closing while installation is missing)
    if (d.checkFirst) {
      const risk = d.checkFirst.find((c) => c.status === "At risk" && c.top === top && (!raum || !c.raum || c.raum === raum) && l.gewerk !== "Trockenbau");
      if (risk && !l.geprueft) l.pruefenVor = risk;
      continue;
    }
    const deckt = entries.find(
      (e) =>
        e.top === top &&
        e.art === "arbeit_geplant" &&
        e.gewerk === "trockenbau" &&
        l.gewerk !== "Trockenbau" &&
        ts(e.zeitpunkt) >= ts(l.gemeldet.zeit) &&
        (!raum || !e.raum || e.raum === raum),
    );
    if (deckt && !l.geprueft) l.pruefenVor = deckt;
  }
  return [...map.values()].sort((a, b) => a.top.localeCompare(b.top, "de", { numeric: true }) || ts(b.gemeldet.zeit) - ts(a.gemeldet.zeit));
}

/* ------------------------------------------------------------------ */
/* Daily log                                                           */
/* ------------------------------------------------------------------ */

export const tagKey = (iso: string | number | null) => (iso ? new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Vienna" }) : "");

export interface Tagesbericht {
  tag: string;
  datum: string;
  arbeiten: { titel: string; text: string; status: { label: string; ton: Ton }; person: Person }[];
  personal: { firma: string; personen: string[] }[];
  fotos: string[];
  behinderungen: Eintrag[];
  lieferungen: Eintrag[];
  aenderungen: Eintrag[];
  entscheidungen: Eintrag[];
  anzahl: number;
}

export function tagesberichte(d: ProjektDaten, pers: Personen): Tagesbericht[] {
  const tage = [...new Set(d.eintraege.filter((e) => e.zeitpunkt).map((e) => tagKey(e.zeitpunkt)))].sort();
  return tage.map((tag) => {
    const list = d.eintraege.filter((e) => tagKey(e.zeitpunkt) === tag).sort((a, b) => ts(a.zeitpunkt) - ts(b.zeitpunkt));
    const arbeitMap = new Map<string, Tagesbericht["arbeiten"][number]>();
    for (const e of list) {
      if (e.art !== "arbeit_erledigt" && e.art !== "arbeit_geplant") continue;
      if (!e.top) continue;
      const k = `${e.top}|${e.gewerk}`;
      const prev = arbeitMap.get(k);
      const erledigt = e.art === "arbeit_erledigt" || prev?.status.label === "Erledigt gemeldet";
      arbeitMap.set(k, {
        titel: `${e.top}${e.raum ? ` · ${e.raum}` : ""} · ${gewerkLabel(e.gewerk)}`,
        text: e.zusammenfassung,
        status: erledigt ? { label: "Erledigt gemeldet", ton: "amber" } : { label: "Geplant", ton: "grau" },
        person: pers(e.person),
      });
    }
    const firmen = new Map<string, Set<string>>();
    for (const e of list) {
      const p = pers(e.person);
      if (!p.firma || e.quelle_typ === "drive") continue;
      if (!firmen.has(p.firma)) firmen.set(p.firma, new Set());
      firmen.get(p.firma)!.add(p.name);
    }
    const fotos = [...new Set(list.map((e) => e.quelle_anhang_pfad).filter((p): p is string => istFoto(p)))];
    return {
      tag,
      datum: list[0]?.zeitpunkt ?? tag,
      arbeiten: [...arbeitMap.values()],
      personal: [...firmen.entries()].map(([firma, s]) => ({ firma, personen: [...s] })),
      fotos,
      behinderungen: list.filter((e) => e.art === "behinderung"),
      lieferungen: list.filter((e) => e.art === "lieferung"),
      aenderungen: list.filter((e) => e.art === "soll_aenderung" || e.art === "planaenderung"),
      entscheidungen: list.filter((e) => e.art === "bestaetigung" || (e.art === "anweisung" && !!e.entschieden_von)),
      anzahl: list.length,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Morning digest                                                      */
/* ------------------------------------------------------------------ */

export function morgen(d: ProjektDaten, pers: Personen, ch: Aenderung[], req: Anfrage[], signale: Signal[], jetzt: number) {
  const heute = tagKey(jetzt);
  const tage = [...new Set(d.eintraege.map((e) => tagKey(e.zeitpunkt)))].filter(Boolean).sort();
  const gestern = tage.filter((t) => t < heute).pop() ?? "";
  const ersteVon = new Map<string, number>();
  for (const e of d.eintraege) {
    const n = e.person ?? "";
    const t = ts(e.zeitpunkt);
    if (t && (!ersteVon.has(n) || t < ersteVon.get(n)!)) ersteVon.set(n, t);
  }
  return {
    heute,
    empfaenger: pers(d.eintraege.find((e) => istGU(pers(e.person)))?.person ?? "Bauleitung"),
    braucht: [
      ...signale.filter((s) => s.status !== "geloest").map((s) => ({ text: s.titel, pill: { label: "In Bearbeitung", ton: "blau" as Ton } })),
      ...ch.filter((c) => c.fehlend.some((f) => f === GRUND.freigabe || f === GRUND.bauleitung || f === GRUND.nachweis)).slice(0, 3).map((c) => ({ text: `${c.titel}${c.top ? ` (${c.top})` : ""}: ${c.fehlend.find((f) => f !== GRUND.abweichung)?.toLowerCase() ?? "Freigabe fehlt"}`, pill: { label: c.nr, ton: "rot" as Ton } })),
    ],
    wartet: req.filter((r) => !r.beantwortet).slice(0, 4),
    entschieden: d.eintraege.filter((e) => tagKey(e.zeitpunkt) === gestern && (e.art === "bestaetigung" || (e.art === "anweisung" && !!e.entschieden_von))).slice(0, 3),
    heuteGeplant: d.eintraege.filter((e) => tagKey(e.zeitpunkt) === heute && e.art === "arbeit_geplant").slice(0, 4),
    neu: [...ersteVon.entries()].filter(([, t]) => tagKey(t) >= gestern && gestern).map(([n]) => pers(n)).slice(0, 2),
  };
}

/* ------------------------------------------------------------------ */
/* Alert rules (Talona's "When someone mentions a change … Alert …")   */
/* ------------------------------------------------------------------ */

export interface Regel {
  wenn: string;
  bedingung: [string, string];
  anrufen: { kuerzel: string; label: string }[];
  protokoll: string;
  arten: SignalArt[];
}

export const REGELN: Regel[] = [
  { wenn: "Wenn jemand nach einem Plan arbeitet", bedingung: ["Plan-Index", "veraltet"], anrufen: [{ kuerzel: "VA", label: "Vorarbeiter" }, { kuerzel: "BL", label: "Bauleitung" }], protokoll: "Top-Akte", arten: ["plan_veraltet"] },
  { wenn: "Wenn eine Wand zugemacht werden soll", bedingung: ["Installation", "nicht fertig"], anrufen: [{ kuerzel: "VA", label: "Vorarbeiter" }], protokoll: "Top-Akte", arten: ["reihenfolge"] },
  { wenn: "Wenn eine Änderung die Crew nicht erreicht", bedingung: ["Änderung", "nicht bestätigt"], anrufen: [{ kuerzel: "VA", label: "Vorarbeiter" }], protokoll: "Top-Akte", arten: ["nicht_weitergegeben", "abweichung_plan"] },
  { wenn: "Wenn eine Nachricht unklar ist", bedingung: ["Ort", "nicht eindeutig"], anrufen: [{ kuerzel: "AB", label: "Absender" }], protokoll: "Protokoll", arten: ["unklar"] },
];

/* ------------------------------------------------------------------ */
/* Exposure & trend                                                    */
/* ------------------------------------------------------------------ */

export function tage(von: number, bis: number) {
  const out: string[] = [];
  for (let t = von; tagKey(t) <= tagKey(bis); t += 86400000) out.push(tagKey(t));
  return [...new Set(out)];
}

export function exposure(ch: Aenderung[], gruppe: "gewerk" | "top") {
  const keyOf = (c: Aenderung) => (gruppe === "gewerk" ? c.gewerk : c.top ?? "Allgemein");
  const zeilen = [...new Set(ch.map(keyOf))];
  const spalten = [...new Set(ch.map((c) => tagKey(c.erhoben)))].sort();
  const zelle = (z: string, s: string) => {
    const items = ch.filter((c) => keyOf(c) === z && tagKey(c.erhoben) === s && c.schaetzung);
    if (!items.length) return null;
    return items.reduce((a, c) => a + (c.bereit ? 1 : -1) * c.schaetzung!.betrag, 0);
  };
  return { zeilen, spalten, zelle };
}

export function verlauf(ch: Aenderung[], von: number, bis: number, schritte = 16) {
  const gewerke = [...new Set(ch.map((c) => c.gewerk))];
  const span = Math.max(1, bis - von);
  const punkte = Array.from({ length: schritte + 1 }, (_, i) => von + (span * i) / schritte);
  return {
    punkte,
    serien: gewerke.map((g) => ({
      gewerk: g,
      werte: punkte.map((t) => ch.filter((c) => c.gewerk === g && ts(c.erhoben) <= t).reduce((a, c) => a + (c.schaetzung?.betrag ?? 0), 0)),
    })),
    offen: punkte.map((t) => ch.filter((c) => ts(c.erhoben) <= t && !c.bereit).reduce((a, c) => a + (c.schaetzung?.betrag ?? 0), 0)),
  };
}

/* ------------------------------------------------------------------ */
/* Messages (inbox, thread)                                            */
/* ------------------------------------------------------------------ */

export interface Nachricht {
  hash: string;
  person: Person;
  zeit: string | null;
  typ: Quelle["typ"];
  anhang: string | null;
  text: string;
  eintraege: Eintrag[];
}

export function nachrichten(d: ProjektDaten, pers: Personen): Nachricht[] {
  const byHash = new Map<string, Nachricht>();
  for (const q of d.quellen) {
    if (q.typ === "drive" || !q.zeitpunkt) continue;
    byHash.set(q.content_hash, { hash: q.content_hash, person: pers(q.absender), zeit: q.zeitpunkt, typ: q.typ, anhang: q.anhang_pfad, text: q.text, eintraege: [] });
  }
  for (const e of d.eintraege) {
    let n = byHash.get(e.quelle_hash);
    if (!n) {
      n = { hash: e.quelle_hash, person: pers(e.quelle_absender ?? e.person), zeit: e.zeitpunkt, typ: e.quelle_typ ?? "whatsapp", anhang: e.quelle_anhang_pfad, text: e.quelle_text ?? "", eintraege: [] };
      byHash.set(e.quelle_hash, n);
    }
    n.eintraege.push(e);
  }
  return [...byHash.values()].sort((a, b) => ts(b.zeit) - ts(a.zeit));
}

export function nachrichtTitel(n: Nachricht) {
  if (istAudio(n.anhang)) return "Sprachnachricht";
  const e = n.eintraege[0];
  if (istFoto(n.anhang)) return `Foto${e?.top ? ` · ${e.top}${e.raum ? ` ${e.raum}` : ""}` : ""}`;
  if (n.typ === "call") return "Anruf";
  if (n.typ === "email") return (n.text.match(/Betreff:\s*(.+)/)?.[1] ?? "E-Mail").replace(/^(AW|RE|WG|FW):\s*/i, "").slice(0, 40);
  const t = n.text.replace(/\s+/g, " ").trim();
  return t.length > 34 ? t.slice(0, 33) + "…" : t || "Nachricht";
}

export const raumListe = raeume;
