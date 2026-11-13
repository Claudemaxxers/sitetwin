/**
 * View helpers that put our data into Talona's shapes (see TALONA.md §5).
 * Pure functions, safe on client and server.
 */
import { ts, type Eintrag, type EintragArt, type Mehrkosten, type ProjektDaten, type Signal, type SignalStatus, type Zwilling } from "./twin-model";

/** Talona's record tags, German. */
export const TAG: Record<EintragArt, { label: string; tone: "accent" | "ok" | "info" | "plain" }> = {
  arbeit_erledigt: { label: "Erledigt gemeldet", tone: "plain" },
  abnahme: { label: "Geprüft", tone: "ok" },
  lieferung: { label: "Lieferung", tone: "info" },
  planaenderung: { label: "Planänderung", tone: "accent" },
  behinderung: { label: "Behinderung", tone: "accent" },
  frage: { label: "Anfrage", tone: "info" },
  problem_behoben: { label: "Behoben", tone: "ok" },
  anweisung: { label: "Anweisung", tone: "plain" },
  arbeit_geplant: { label: "Geplant", tone: "plain" },
  bestaetigung: { label: "Bestätigt", tone: "ok" },
  sonstiges: { label: "Notiz", tone: "plain" },
};

const EXTRA: Record<string, { label: string; tone: "accent" | "ok" | "info" | "plain" }> = { soll_aenderung: { label: "Änderung angeordnet", tone: "accent" } };
export const tag = (art: string) => TAG[art as EintragArt] ?? EXTRA[art] ?? { label: art.replace(/_/g, " "), tone: "plain" as const };

export const SIGNAL_STATUS: Record<SignalStatus, { label: string; tone: "accent" | "info" | "ok" }> = {
  offen: { label: "Prüfen", tone: "accent" },
  in_bearbeitung: { label: "Beim Vorarbeiter", tone: "info" },
  geloest: { label: "Gelöst", tone: "ok" },
};

export const GEWERK_LABEL: Record<string, string> = {
  elektro: "Elektro",
  gu: "Generalunternehmer",
  planung: "Planung",
  trockenbau: "Trockenbau",
  hkls: "HKLS",
  sanitaer: "Sanitär",
  maler: "Maler",
  estrich: "Estrich",
};
export const gewerkLabel = (g: string | null | undefined) => (g ? GEWERK_LABEL[g] ?? g.charAt(0).toUpperCase() + g.slice(1) : "Sonstige");

export function initials(name: string | null | undefined) {
  if (!name) return "··";
  const clean = name.replace(/\(.*?\)/g, "").trim();
  const parts = clean.split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** "Mark L." like Talona's inbox. */
export function kurzName(name: string | null | undefined) {
  if (!name) return "Unbekannt";
  const clean = name.replace(/\(.*?\)/g, "").trim();
  const [a, b] = clean.split(/\s+/);
  return b ? `${a} ${b[0]}.` : a;
}

export const istFoto = (p: string | null) => !!p && /\.(jpe?g|png|webp|heic)$/i.test(p);
export const istAudio = (p: string | null) => !!p && /\.(opus|ogg|m4a|mp3|wav)$/i.test(p);

export function quelleLabel(e: Eintrag) {
  if (istAudio(e.quelle_anhang_pfad)) return "Sprachnachricht";
  if (istFoto(e.quelle_anhang_pfad)) return "Foto";
  return { whatsapp: "Nachricht", email: "E-Mail", call: "Anruf", drive: "Datei" }[e.quelle_typ ?? "whatsapp"] ?? "Nachricht";
}

export const ort = (top: string | null, raum: string | null) => [top, raum].filter(Boolean).join(" · ") || "Baustelle";

export function zeitKurz(iso: string | number | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("de-AT", { weekday: "short", timeZone: "Europe/Vienna" }).replace(".", "") +
    " " +
    d.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Vienna" })
  );
}
export const uhrzeit = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Vienna" }) : "");
export const tagKey = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Vienna" }) : "ohne Datum");
export const tagTitel = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("de-AT", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "Europe/Vienna" }) : "Ohne Datum";

/* ------------------------------------------------------------------ */
/* Messages (Inbox): one message = one source, with its entries        */
/* ------------------------------------------------------------------ */

export interface Nachricht {
  hash: string;
  person: string;
  zeit: string | null;
  typ: Eintrag["quelle_typ"];
  anhang: string | null;
  text: string | null;
  eintraege: Eintrag[];
}

export function nachrichten(eintraege: Eintrag[]): Nachricht[] {
  const map = new Map<string, Nachricht>();
  for (const e of eintraege) {
    let n = map.get(e.quelle_hash);
    if (!n) {
      n = { hash: e.quelle_hash, person: e.quelle_absender ?? e.person ?? "Unbekannt", zeit: e.zeitpunkt, typ: e.quelle_typ, anhang: e.quelle_anhang_pfad, text: e.quelle_text, eintraege: [] };
      map.set(e.quelle_hash, n);
    }
    n.eintraege.push(e);
  }
  return [...map.values()].sort((a, b) => ts(b.zeit) - ts(a.zeit));
}

/* ------------------------------------------------------------------ */
/* Changes: signals plus extra work, as Talona's "potential changes"   */
/* ------------------------------------------------------------------ */

export interface Aenderung {
  id: string;
  kind: "signal" | "mehrkosten";
  titel: string;
  ort: string;
  top: string | null;
  gewerk: string;
  von: string;
  belege: string;
  status: { label: string; tone: "accent" | "info" | "ok" | "plain" };
  betrag: number | null;
  zeit: number;
  signal?: Signal;
  mehrkosten?: Mehrkosten;
  eintraege: Eintrag[];
}

function belegText(list: Eintrag[]) {
  const hashes = new Set(list.map((e) => e.quelle_hash));
  const parts = [`${hashes.size} ${hashes.size === 1 ? "Nachricht" : "Nachrichten"}`];
  if (list.some((e) => istAudio(e.quelle_anhang_pfad))) parts.push("Sprache");
  if (list.some((e) => istFoto(e.quelle_anhang_pfad))) parts.push("Foto");
  if (list.some((e) => e.quelle_typ === "email")) parts.push("Mail");
  if (list.some((e) => e.quelle_typ === "call")) parts.push("Anruf");
  return parts.join(" · ");
}

export function aenderungen(d: ProjektDaten, z: Zwilling): Aenderung[] {
  const out: Aenderung[] = [];
  for (const s of z.signale.concat(z.geloest)) {
    const list = d.eintraege.filter((e) => s.eintrag_ids.includes(e.id));
    out.push({
      id: s.id,
      kind: "signal",
      titel: s.titel,
      ort: ort(s.top, s.raum),
      top: s.top,
      gewerk: gewerkLabel(list.find((e) => e.gewerk)?.gewerk),
      von: list[0]?.person ?? s.zustaendig ?? "–",
      belege: list.length ? belegText(list) : "–",
      status: SIGNAL_STATUS[s.status],
      betrag: null,
      zeit: Math.max(0, ...list.map((e) => ts(e.zeitpunkt))) || ts(s.erstellt_am),
      signal: s,
      eintraege: list,
    });
  }
  for (const m of z.mehrkosten) {
    const list = d.eintraege.filter((e) => e.quelle_hash === m.eintrag.quelle_hash || e.id === m.eintrag.id);
    out.push({
      id: `mk-${m.eintrag.id}`,
      kind: "mehrkosten",
      titel: m.titel,
      ort: ort(m.top, m.eintrag.raum),
      top: m.top,
      gewerk: gewerkLabel(m.eintrag.gewerk),
      von: m.eintrag.person ?? "–",
      belege: belegText(list),
      status: m.betrag === null ? { label: "Preis fehlt", tone: "accent" } : { label: "Zum Abrechnen", tone: "plain" },
      betrag: m.betrag,
      zeit: ts(m.eintrag.zeitpunkt),
      mehrkosten: m,
      eintraege: list,
    });
  }
  return out.sort((a, b) => b.zeit - a.zeit);
}

/* ------------------------------------------------------------------ */
/* Stacked area series: extra costs over time per trade                */
/* ------------------------------------------------------------------ */

export const TRADE_COLORS = ["#EE783B", "#5683D2", "#6FA77F", "#9A86C9", "#D9B04C", "#B8B2AB"];

export function kostenVerlauf(z: Zwilling, schritte = 24) {
  const gewerke = [...new Set(z.mehrkosten.map((m) => gewerkLabel(m.eintrag.gewerk)))];
  const span = Math.max(1, z.bis - z.von);
  const punkte = Array.from({ length: schritte + 1 }, (_, i) => z.von + (span * i) / schritte);
  const serien = gewerke.map((g) => ({
    gewerk: g,
    werte: punkte.map((t) => z.mehrkosten.filter((m) => gewerkLabel(m.eintrag.gewerk) === g && ts(m.eintrag.zeitpunkt) <= t).reduce((a, m) => a + (m.betrag ?? 0), 0)),
  }));
  return { punkte, serien };
}
