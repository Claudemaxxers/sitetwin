// Notifier: sends a warning into ONE WhatsApp chat when the check agent creates a signal in Supabase.
// Pure logic without a Baileys import: selection, text, rate limit, loop protection, state. Verifiable by test.
// Supabase is only read (REST, GET). Sending goes through the function `senden`, which the caller provides.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const PRAEFIX_WARNUNG = '⚠️ SiteTwin-Warnung (automatisch)';
export const PRAEFIX_ERLEDIGT = '✅ SiteTwin:';
export const MAX_ZEICHEN = 700;
export const MAX_WIEDERHOLUNGEN = 3; // after the first attempt
const MAX_GESENDETE_IDS = 500;

const ohneVS = (s) => String(s ?? '').replace(/️/g, '');
const leer = (v) => v == null || String(v).trim() === '';
export const sauber = (v) =>
  String(v ?? '')
    .replace(/\+?\d[\d\s/().-]{6,}\d/g, '') // no phone numbers in the text
    .replace(/[ \t]+/g, ' ')
    .trim();

// ---- Configuration --------------------------------------------------------

/** Reads the notifier settings. Never throws; `fehler` is set when the notifier must not start. */
export function warnKonfig(env, allowlist, jetzt = new Date()) {
  const an = String(env.WHATSAPP_WARNEN ?? '').trim() === '1';
  const zahl = (v, std, min = 1) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min ? n : std;
  };
  const chat = String(env.WHATSAPP_WARN_CHAT ?? '').trim();
  const abRoh = String(env.WHATSAPP_WARN_AB ?? '').trim();
  let ab = jetzt;
  let fehler = null;
  if (abRoh) {
    const d = new Date(abRoh);
    if (Number.isNaN(d.getTime())) fehler = `WHATSAPP_WARN_AB ist kein gueltiger Zeitstempel: "${abRoh}"`;
    else ab = d;
  }
  const k = {
    an,
    chat,
    ab,
    intervallS: zahl(env.WARN_INTERVALL_S, 5),
    maxPro10Min: zahl(env.WARN_MAX_PRO_10MIN, 6),
    erledigt: String(env.WHATSAPP_WARN_ERLEDIGT ?? '1').trim() !== '0',
    fehler,
  };
  if (an && !fehler) k.fehler = pruefeChat(chat, allowlist);
  return k;
}

const istJid = (s) => /@(g\.us|s\.whatsapp\.net|lid)$/.test(s);

/** The warn chat must be set and be on the allowlist. Returns an error message or null. */
export function pruefeChat(chat, allowlist) {
  if (!chat) return 'WHATSAPP_WARNEN=1, aber WHATSAPP_WARN_CHAT ist leer. Der Melder startet nicht.';
  const auf = allowlist && !allowlist.leer && (istJid(chat) ? allowlist.jids.has(chat.toLowerCase()) : allowlist.namen.has(chat.toLowerCase()));
  if (!auf) {
    return `WHATSAPP_WARN_CHAT "${chat}" steht nicht in WHATSAPP_CHATS (gleiche Schreibweise, Name oder JID). Der Melder startet nicht.`;
  }
  return null;
}

// ---- Text -----------------------------------------------------------------

/** Warning text from a row of the table `signale`. Pure. Empty fields are dropped, upper limit MAX_ZEICHEN. */
export function baueText(s, max = MAX_ZEICHEN, { wieder = false } = {}) {
  const kopf = PRAEFIX_WARNUNG;
  const titel = sauber(s.titel);
  const ort = [s.top, s.raum, s.element].filter((x) => !leer(x)).map(sauber).filter(Boolean).join(', ');
  const was = [titel ? `${wieder ? 'Wieder offen: ' : ''}${titel}${s.schwere === 'kritisch' ? ' (kritisch)' : ''}` : (wieder ? 'Wieder offen' : ''), ort ? `Wo: ${ort}` : '']
    .filter(Boolean)
    .join('\n');
  const tun = sauber(s.anruf_text) || sauber(s.begruendung);
  const wer = sauber(s.zustaendig) ? `Zuständig: ${sauber(s.zustaendig)}` : '';

  const feste = [kopf, was, wer].filter(Boolean).join('\n');
  const frei = max - feste.length - 1; // 1 for the line break before `tun`
  let mitte = tun;
  if (mitte && frei < mitte.length) mitte = frei > 1 ? `${mitte.slice(0, frei - 1).trimEnd()}…` : '';
  const teile = [kopf, was, mitte, wer].filter(Boolean);
  return teile.join('\n').slice(0, max);
}

/** Short follow-up message when a signal is resolved. */
export function baueErledigt(s, max = 200) {
  const titel = sauber(s.titel) || 'Signal';
  return `${PRAEFIX_ERLEDIGT} erledigt – ${titel}`.slice(0, max);
}

// ---- Loop protection ------------------------------------------------------

/** Text of a Baileys message (without importing mapping.js, so that this module stays self-contained). */
export function textVon(msg) {
  let m = msg?.message;
  for (let i = 0; i < 5 && m; i++) {
    const w = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage'].find((k) => m[k]?.message);
    if (!w) break;
    m = m[w].message;
  }
  if (!m) return '';
  return m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption ?? m.videoMessage?.caption ?? m.documentMessage?.caption ?? '';
}

export function hatMelderPraefix(text) {
  const t = ohneVS(text).trimStart();
  return t.startsWith(ohneVS(PRAEFIX_WARNUNG)) || t.startsWith(ohneVS(PRAEFIX_ERLEDIGT));
}

/** true = this message comes from the notifier and must NOT go to the Ablage. */
export function istMelderNachricht(msg, zustand) {
  const id = msg?.key?.id;
  if (id && zustand?.gesendeteIds?.includes(id)) return true;
  return hatMelderPraefix(textVon(msg));
}

// ---- State ----------------------------------------------------------------

export function leererZustand() {
  return { gewarnt: {}, gesendeteIds: [] };
}

export function ladeZustand(datei) {
  try {
    if (!existsSync(datei)) return leererZustand();
    const z = JSON.parse(readFileSync(datei, 'utf8'));
    const k = { gewarnt: z.gewarnt && typeof z.gewarnt === 'object' ? z.gewarnt : {}, gesendeteIds: Array.isArray(z.gesendeteIds) ? z.gesendeteIds : [] };
    // Feedback only (WHATSAPP_BEWERTEN): which sent message belongs to which signal. Old files do not have this field.
    if (z.warnungen && typeof z.warnungen === 'object' && !Array.isArray(z.warnungen)) k.warnungen = z.warnungen;
    return k;
  } catch {
    return leererZustand();
  }
}

export function speichereZustand(datei, zustand) {
  mkdirSync(dirname(datei), { recursive: true });
  const tmp = `${datei}.tmp`;
  writeFileSync(tmp, JSON.stringify(zustand, null, 2));
  renameSync(tmp, datei);
}

export function merkeGesendet(zustand, id) {
  if (!id || zustand.gesendeteIds.includes(id)) return;
  zustand.gesendeteIds.push(id);
  if (zustand.gesendeteIds.length > MAX_GESENDETE_IDS) zustand.gesendeteIds.splice(0, zustand.gesendeteIds.length - MAX_GESENDETE_IDS);
}

/**
 * Remembers which signal belongs to a sent warning: warnungen[nachrichtenId] = {signal, ts, titel}.
 * Only called with WHATSAPP_BEWERTEN=1. The field is only created here (old state files stay valid).
 */
export function merkeWarnung(zustand, msgId, signalId, ts, titel = '') {
  if (!msgId || !signalId) return;
  const w = (zustand.warnungen ??= {});
  w[msgId] = { signal: signalId, ts, titel: sauber(titel).slice(0, 120) };
  const ids = Object.keys(w);
  if (ids.length > MAX_GESENDETE_IDS) {
    ids.sort((a, b) => w[a].ts - w[b].ts).slice(0, ids.length - MAX_GESENDETE_IDS).forEach((i) => delete w[i]);
  }
}

// ---- Rate limit -----------------------------------------------------------

/** At least `abstandMs` between two messages, at most `max` per `fensterMs`. */
export function neuesLimit({ abstandMs = 3000, max = 6, fensterMs = 10 * 60 * 1000 } = {}) {
  let zeiten = [];
  return {
    /** {art:'ok'} | {art:'warten', ms} | {art:'voll'} */
    pruefe(jetzt) {
      zeiten = zeiten.filter((t) => jetzt - t < fensterMs);
      if (zeiten.length >= max) return { art: 'voll' };
      const letzte = zeiten[zeiten.length - 1];
      if (letzte != null && jetzt - letzte < abstandMs) return { art: 'warten', ms: abstandMs - (jetzt - letzte) };
      return { art: 'ok' };
    },
    vermerke(jetzt) {
      zeiten.push(jetzt);
    },
  };
}

// ---- Supabase (read only) -------------------------------------------------

const eq = (v) => `eq.${encodeURIComponent(v)}`;

async function rest({ url, key, fetchImpl = fetch }, pfad) {
  const r = await fetchImpl(`${String(url).replace(/\/+$/, '')}/rest/v1/${pfad}`, {
    method: 'GET',
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Supabase ${pfad.split('?')[0]}: HTTP ${r.status}`);
  return r.json();
}

/** Open signals of a project, oldest first. */
export const offeneSignale = (sb, projekt) =>
  rest(sb, `signale?select=*&projekt=${eq(projekt)}&status=in.(offen,in_bearbeitung)&order=erstellt_am.asc`);

/** Newest open signals (for the dry run). */
export const neuesteOffene = (sb, projekt, n = 5) =>
  rest(sb, `signale?select=*&projekt=${eq(projekt)}&status=eq.offen&order=erstellt_am.desc&limit=${n}`);

/** All signals of a project (only for the dry run: columns and count per status). */
export const alleSignale = (sb, projekt) => rest(sb, `signale?select=*&projekt=${eq(projekt)}&order=erstellt_am.desc&limit=200`);

/** Of these ids, the ones that have been resolved in the meantime. */
export async function geloesteAus(sb, ids) {
  if (!ids.length) return [];
  const liste = ids.map((i) => encodeURIComponent(i)).join(',');
  return rest(sb, `signale?select=*&id=in.(${liste})&status=eq.geloest`);
}

// ---- Selection ------------------------------------------------------------

/** Last change of the signal in ms: max(erstellt_am, aktualisiert_am); if one is missing, the other counts. NaN if both are missing. */
export function stand(s) {
  const t = [s?.erstellt_am, s?.aktualisiert_am].map((x) => (x == null ? NaN : new Date(x).getTime())).filter(Number.isFinite);
  return t.length ? Math.max(...t) : NaN;
}

/**
 * Which of the open signals get a warning now? Pure.
 * Rule: status offen/in_bearbeitung, project matches, max(erstellt_am, aktualisiert_am) >= ab, and the signal is
 * not "warned and still open". A signal whose resolved message has already been sent (entry.erledigt) can be
 * warned about again: whoever reopens it gets a new warning. Later updates of an open, warned signal
 * (more evidence, rating) trigger nothing.
 */
export function waehleNeue(signale, { ab, zustand, verworfen = new Set(), projekt }) {
  const abMs = ab instanceof Date ? ab.getTime() : new Date(ab).getTime();
  return signale.filter((s) => {
    // also 'in_bearbeitung': if a phone agent sets the status before the notifier polls, the warning should not be lost
    if (!s?.id || !['offen', 'in_bearbeitung'].includes(s.status)) return false;
    if (projekt && s.projekt !== projekt) return false;
    const t = stand(s);
    if (!Number.isFinite(t) || t < abMs) return false;
    if (verworfen.has(s.id)) return false;
    const e = zustand.gewarnt[s.id];
    if (e && !e.erledigt && (e.gesendet || (e.versuche ?? 0) > MAX_WIEDERHOLUNGEN)) return false;
    return true;
  });
}

// ---- Notifier -------------------------------------------------------------

const kurzId = (id) => String(id).slice(0, 8);
const vorschau = (t) => t.replace(/\s+/g, ' ').slice(0, 40);

/**
 * @param opts.cfg        result of warnKonfig, plus projekt
 * @param opts.sb         {url, key, fetchImpl?}
 * @param opts.senden     async (text) => message ID (string) | null; throws on error
 * @param opts.speichern  (zustand) => void
 */
export function neuerMelder({ cfg, projekt, sb, zustand, senden, merkeWarnungen = false, speichern = () => {}, log = () => {}, jetzt = Date.now, schlafen = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const limit = neuesLimit({ max: cfg.maxPro10Min });
  const verworfen = new Set();
  let timer = null;
  let laeuft = false;
  let gestoppt = false;

  async function schicke(text, signalId, eintrag, feld, titel = '') {
    for (;;) {
      const p = limit.pruefe(jetzt());
      if (p.art === 'voll') {
        log(`Warnung ${kurzId(signalId)} verworfen: Limit ${cfg.maxPro10Min} je 10 Minuten erreicht.`);
        return 'verworfen';
      }
      if (p.art === 'ok') break;
      await schlafen(p.ms);
      if (gestoppt) return 'gestoppt';
    }
    limit.vermerke(jetzt());
    try {
      const id = await senden(text);
      merkeGesendet(zustand, id);
      if (merkeWarnungen && feld === 'gesendet') merkeWarnung(zustand, id, signalId, jetzt(), titel);
      eintrag[feld] = true;
      speichern(zustand);
      log(`Warnung gesendet: ${kurzId(signalId)} | ${vorschau(text)}`);
      return 'ok';
    } catch (e) {
      eintrag.versuche = (eintrag.versuche ?? 0) + 1;
      speichern(zustand);
      const rest = MAX_WIEDERHOLUNGEN + 1 - eintrag.versuche;
      log(`Warnung ${kurzId(signalId)} nicht gesendet (${e?.message ?? e}), ${rest > 0 ? `weiterer Versuch beim naechsten Abruf (noch ${rest})` : 'aufgegeben'}.`);
      return 'fehler';
    }
  }

  /** One pass: warn about new signals, report resolved ones once. Never throws. */
  async function tick() {
    if (laeuft || gestoppt) return;
    laeuft = true;
    try {
      const offen = await offeneSignale(sb, projekt);
      for (const s of waehleNeue(offen, { ab: cfg.ab, zustand, verworfen, projekt })) {
        if (gestoppt) break;
        let eintrag = zustand.gewarnt[s.id];
        if (!eintrag || eintrag.erledigt) {
          // new cycle: first time or reopened after the resolved message
          eintrag = zustand.gewarnt[s.id] = { gesendet: false, erledigt: false, versuche: 0, zyklus: (eintrag?.zyklus ?? 0) + (eintrag ? 1 : 0), wieder: Boolean(eintrag) };
        }
        const r = await schicke(baueText(s, MAX_ZEICHEN, { wieder: Boolean(eintrag.wieder) }), s.id, eintrag, 'gesendet', s.titel);
        if (r === 'verworfen') verworfen.add(s.id);
      }
      if (!gestoppt) {
        const ids = Object.entries(zustand.gewarnt).filter(([, e]) => e.gesendet && !e.erledigt).map(([id]) => id);
        for (const s of await geloesteAus(sb, ids)) {
          if (gestoppt) break;
          const eintrag = zustand.gewarnt[s.id];
          if (!eintrag || eintrag.erledigt || (eintrag.versuchteErledigt ?? 0) > MAX_WIEDERHOLUNGEN) continue;
          if (!cfg.erledigt) {
            // message switched off: close the cycle anyway so that reopening warns again
            eintrag.erledigt = true;
            speichern(zustand);
            continue;
          }
          const r = await schicke(baueErledigt(s), s.id, eintrag, 'erledigt');
          if (r === 'fehler') eintrag.versuchteErledigt = (eintrag.versuchteErledigt ?? 0) + 1;
          if (r === 'verworfen') {
            eintrag.erledigt = true; // do not catch up later, only this message is dropped
            speichern(zustand);
          }
        }
      }
    } catch (e) {
      log(`Melder: Abruf fehlgeschlagen (${e?.message ?? e}), naechster Versuch in ${cfg.intervallS} s.`);
    } finally {
      laeuft = false;
    }
  }

  /** Short follow-up message (confirmation of a feedback) via the same path and the same rate limit. Never throws. */
  async function meldeKurz(text, signalId) {
    if (gestoppt) return 'gestoppt';
    return schicke(text, signalId, {}, 'kurz');
  }

  return {
    tick,
    meldeKurz,
    start() {
      gestoppt = false;
      clearInterval(timer);
      timer = setInterval(() => void tick(), cfg.intervallS * 1000);
      void tick();
    },
    stop() {
      gestoppt = true;
      clearInterval(timer);
      timer = null;
    },
  };
}
