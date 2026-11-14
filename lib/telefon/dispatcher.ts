import type { TelefonConfig } from "./config";
import { telefonKonfiguriert } from "./config";
import { anrufBody, anrufStarten, type AnrufStarter } from "./elevenlabs";
import type { Person, Signal, SignalDB, VerlaufZeile } from "./types";

export interface AnrufEintrag {
  signal_id: string;
  titel: string;
  zustaendig: string | null;
  telefon: string;
  conversation_id: string | null;
  versuch: number;
}

export interface Bericht {
  zeitpunkt: string;
  trocken: boolean;
  gefunden: number;
  angerufen: AnrufEintrag[];
  uebersprungen: { signal_id: string; titel: string; grund: string }[];
}

/** "+43 660 000 00 00" → "+436600000000"; "0660…" → Landesvorwahl; sonst null. */
export function e164(roh: string | null | undefined, laendervorwahl = "+43"): string | null {
  let n = (roh ?? "").replace(/[\s\-().\/]/g, "");
  if (!n) return null;
  if (n.startsWith("00")) n = `+${n.slice(2)}`;
  else if (n.startsWith("0")) n = `${laendervorwahl}${n.slice(1)}`;
  return /^\+[1-9]\d{6,14}$/.test(n) ? n : null;
}

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();

/** Person zu `zustaendig`: Name oder Alias, notfalls Vor- oder Nachname allein. */
export function personZu(zustaendig: string | null, personen: Person[]): Person | null {
  if (!zustaendig) return null;
  const z = norm(zustaendig);
  if (!z) return null;
  const namen = (p: Person) => [p.name, ...(p.aliase ?? [])].map(norm);
  return (
    personen.find((p) => namen(p).includes(z)) ??
    personen.find((p) => namen(p).some((n) => n.includes(z) || z.includes(n))) ??
    personen.find((p) => norm(p.name).split(" ").some((teil) => teil.length > 2 && z.split(" ").includes(teil))) ??
    null
  );
}

/** Nummer aus dem Signal, sonst aus `personen`; die Testnummer gewinnt immer. */
export function telefonnummer(
  s: Signal,
  personen: Person[],
  cfg: Pick<TelefonConfig, "testnummer" | "laendervorwahl">,
): string | null {
  if (cfg.testnummer) return e164(cfg.testnummer, cfg.laendervorwahl);
  return e164(s.telefon, cfg.laendervorwahl) ?? e164(personZu(s.zustaendig, personen)?.telefon, cfg.laendervorwahl);
}

/** Bisherige Anrufversuche eines Signals = Wechsel nach in_bearbeitung im Verlauf. */
export function versuche(signalId: string, verlauf: VerlaufZeile[]): { anzahl: number; letzter: Date | null } {
  const treffer = verlauf.filter((v) => v.signal_id === signalId && v.status === "in_bearbeitung");
  const letzter = treffer.length ? new Date(treffer[treffer.length - 1].zeitpunkt) : null;
  return { anzahl: treffer.length, letzter };
}

/**
 * Ein Durchlauf: jedes offene, noch nicht angerufene Signal wird angerufen.
 * Konvention mit Prüf-Agent und ElevenLabs-Agent: status='offen' + angerufen_am null → anrufen;
 * danach status='in_bearbeitung', anruf_id = conversation_id, angerufen_am, telefon.
 * Der Agent selbst setzt nach dem Gespräch status (geloest/offen) und bewertung_notiz.
 */
export async function offeneSignaleAnrufen(
  db: SignalDB,
  cfg: TelefonConfig,
  starten: AnrufStarter = anrufStarten,
  jetzt: () => Date = () => new Date(),
): Promise<Bericht> {
  const bericht: Bericht = { zeitpunkt: jetzt().toISOString(), trocken: cfg.trocken, gefunden: 0, angerufen: [], uebersprungen: [] };
  const signale = await db.offeneSignale();
  bericht.gefunden = signale.length;
  if (!signale.length) return bericht;
  if (!cfg.trocken && !telefonKonfiguriert(cfg)) {
    for (const s of signale) {
      bericht.uebersprungen.push({ signal_id: s.id, titel: s.titel, grund: "ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID oder ELEVENLABS_PHONE_NUMBER_ID fehlt" });
    }
    return bericht;
  }

  const verlauf = await db.verlauf(signale.map((s) => s.id)).catch(() => [] as VerlaufZeile[]);
  const personenCache = new Map<string, Person[]>();

  for (const s of signale) {
    const { anzahl, letzter } = versuche(s.id, verlauf);
    if (anzahl >= cfg.maxVersuche) {
      bericht.uebersprungen.push({ signal_id: s.id, titel: s.titel, grund: `schon ${anzahl}× versucht (TELEFON_MAX_VERSUCHE=${cfg.maxVersuche})` });
      continue;
    }
    if (letzter && jetzt().getTime() - letzter.getTime() < cfg.wartezeitMin * 60_000) {
      bericht.uebersprungen.push({ signal_id: s.id, titel: s.titel, grund: `letzter Versuch vor weniger als ${cfg.wartezeitMin} Minuten` });
      continue;
    }
    if (!personenCache.has(s.projekt)) personenCache.set(s.projekt, await db.personen(s.projekt).catch(() => []));
    const nummer = telefonnummer(s, personenCache.get(s.projekt) ?? [], cfg);
    if (!nummer) {
      bericht.uebersprungen.push({ signal_id: s.id, titel: s.titel, grund: `keine Telefonnummer für "${s.zustaendig ?? "?"}"` });
      continue;
    }
    const body = anrufBody(s, nummer, cfg);
    if (cfg.trocken) {
      bericht.angerufen.push({ signal_id: s.id, titel: s.titel, zustaendig: s.zustaendig, telefon: nummer, conversation_id: null, versuch: anzahl + 1 });
      continue;
    }
    const angerufenAm = jetzt().toISOString();
    if (!(await db.signalBeanspruchen(s.id, angerufenAm))) {
      bericht.uebersprungen.push({ signal_id: s.id, titel: s.titel, grund: "wird gerade von einem anderen Lauf angerufen" });
      continue;
    }
    try {
      const antwort = await starten(body, cfg);
      await db.signalAendern(s.id, { status: "in_bearbeitung", anruf_id: antwort.conversation_id, angerufen_am: angerufenAm, telefon: nummer });
      bericht.angerufen.push({ signal_id: s.id, titel: s.titel, zustaendig: s.zustaendig, telefon: nummer, conversation_id: antwort.conversation_id, versuch: anzahl + 1 });
    } catch (err) {
      await db.signalAendern(s.id, { angerufen_am: null }).catch(() => undefined);
      bericht.uebersprungen.push({ signal_id: s.id, titel: s.titel, grund: `Anruf fehlgeschlagen: ${(err as Error).message}` });
    }
  }
  return bericht;
}
