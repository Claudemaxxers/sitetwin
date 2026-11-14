// Melder: schickt eine Warnung in EINEN WhatsApp-Chat, wenn der Pruef-Agent in Supabase ein Signal anlegt.
// Reine Logik ohne Baileys-Import: Auswahl, Text, Rate-Limit, Schleifenschutz, Zustand. Per Test pruefbar.
// Supabase wird nur gelesen (REST, GET). Gesendet wird ueber die Funktion `senden`, die der Aufrufer liefert.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const PRAEFIX_WARNUNG = '⚠️ SiteTwin-Warnung (automatisch)';
export const PRAEFIX_ERLEDIGT = '✅ SiteTwin:';
export const MAX_ZEICHEN = 700;
export const MAX_WIEDERHOLUNGEN = 3; // nach dem ersten Versuch
const MAX_GESENDETE_IDS = 500;

const ohneVS = (s) => String(s ?? '').replace(/️/g, '');
const leer = (v) => v == null || String(v).trim() === '';
export const sauber = (v) =>
  String(v ?? '')
    .replace(/\+?\d[\d\s/().-]{6,}\d/g, '') // keine Telefonnummern im Text
    .replace(/[ \t]+/g, ' ')
    .trim();

// ---- Konfiguration --------------------------------------------------------

/** Liest die Melder-Einstellungen. Wirft nie; `fehler` ist gesetzt, wenn der Melder nicht starten darf. */
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

/** Warn-Chat muss gesetzt sein und auf der Allowlist stehen. Gibt eine Fehlermeldung oder null. */
export function pruefeChat(chat, allowlist) {
  if (!chat) return 'WHATSAPP_WARNEN=1, aber WHATSAPP_WARN_CHAT ist leer. Der Melder startet nicht.';
  const auf = allowlist && !allowlist.leer && (istJid(chat) ? allowlist.jids.has(chat.toLowerCase()) : allowlist.namen.has(chat.toLowerCase()));
  if (!auf) {
    return `WHATSAPP_WARN_CHAT "${chat}" steht nicht in WHATSAPP_CHATS (gleiche Schreibweise, Name oder JID). Der Melder startet nicht.`;
  }
  return null;
}

// ---- Text -----------------------------------------------------------------

/** Warntext aus einer Zeile der Tabelle `signale`. Rein. Leere Felder fallen weg, Obergrenze MAX_ZEICHEN. */
export function baueText(s, max = MAX_ZEICHEN) {
  const kopf = PRAEFIX_WARNUNG;
  const titel = sauber(s.titel);
  const ort = [s.top, s.raum, s.element].filter((x) => !leer(x)).map(sauber).filter(Boolean).join(', ');
  const was = [titel ? `${titel}${s.schwere === 'kritisch' ? ' (kritisch)' : ''}` : '', ort ? `Wo: ${ort}` : '']
    .filter(Boolean)
    .join('\n');
  const tun = sauber(s.anruf_text) || sauber(s.begruendung);
  const wer = sauber(s.zustaendig) ? `Zuständig: ${sauber(s.zustaendig)}` : '';

  const feste = [kopf, was, wer].filter(Boolean).join('\n');
  const frei = max - feste.length - 1; // 1 fuer den Zeilenumbruch vor `tun`
  let mitte = tun;
  if (mitte && frei < mitte.length) mitte = frei > 1 ? `${mitte.slice(0, frei - 1).trimEnd()}…` : '';
  const teile = [kopf, was, mitte, wer].filter(Boolean);
  return teile.join('\n').slice(0, max);
}

/** Kurze Folgenachricht, wenn ein Signal geloest ist. */
export function baueErledigt(s, max = 200) {
  const titel = sauber(s.titel) || 'Signal';
  return `${PRAEFIX_ERLEDIGT} erledigt – ${titel}`.slice(0, max);
}

// ---- Schleifenschutz ------------------------------------------------------

/** Text einer Baileys-Nachricht (ohne Import von mapping.js, damit dieses Modul eigenstaendig bleibt). */
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

/** true = diese Nachricht stammt vom Melder und darf NICHT an die Ablage gehen. */
export function istMelderNachricht(msg, zustand) {
  const id = msg?.key?.id;
  if (id && zustand?.gesendeteIds?.includes(id)) return true;
  return hatMelderPraefix(textVon(msg));
}

// ---- Zustand --------------------------------------------------------------

export function leererZustand() {
  return { gewarnt: {}, gesendeteIds: [] };
}

export function ladeZustand(datei) {
  try {
    if (!existsSync(datei)) return leererZustand();
    const z = JSON.parse(readFileSync(datei, 'utf8'));
    const k = { gewarnt: z.gewarnt && typeof z.gewarnt === 'object' ? z.gewarnt : {}, gesendeteIds: Array.isArray(z.gesendeteIds) ? z.gesendeteIds : [] };
    // Nur Rueckmeldung (WHATSAPP_BEWERTEN): welche gesendete Nachricht gehoert zu welchem Signal. Alte Dateien haben das Feld nicht.
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
 * Merkt, welches Signal zu einer gesendeten Warnung gehoert: warnungen[nachrichtenId] = {signal, ts, titel}.
 * Wird nur mit WHATSAPP_BEWERTEN=1 aufgerufen. Das Feld entsteht erst hier (alte Zustandsdateien bleiben gueltig).
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

// ---- Rate-Limit -----------------------------------------------------------

/** Mindestens `abstandMs` zwischen zwei Nachrichten, hoechstens `max` je `fensterMs`. */
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

// ---- Supabase (nur lesen) -------------------------------------------------

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

/** Offene Signale eines Projekts, aelteste zuerst. */
export const offeneSignale = (sb, projekt) =>
  rest(sb, `signale?select=*&projekt=${eq(projekt)}&status=in.(offen,in_bearbeitung)&order=erstellt_am.asc`);

/** Neueste offene Signale (fuer den Trockenlauf). */
export const neuesteOffene = (sb, projekt, n = 5) =>
  rest(sb, `signale?select=*&projekt=${eq(projekt)}&status=eq.offen&order=erstellt_am.desc&limit=${n}`);

/** Alle Signale eines Projekts (nur fuer den Trockenlauf: Spalten und Zaehlung nach Status). */
export const alleSignale = (sb, projekt) => rest(sb, `signale?select=*&projekt=${eq(projekt)}&order=erstellt_am.desc&limit=200`);

/** Von diesen Ids die, die inzwischen geloest sind. */
export async function geloesteAus(sb, ids) {
  if (!ids.length) return [];
  const liste = ids.map((i) => encodeURIComponent(i)).join(',');
  return rest(sb, `signale?select=*&id=in.(${liste})&status=eq.geloest`);
}

// ---- Auswahl --------------------------------------------------------------

/** Welche der offenen Signale bekommen jetzt eine Warnung? Rein. */
export function waehleNeue(signale, { ab, zustand, verworfen = new Set(), projekt }) {
  const abMs = ab instanceof Date ? ab.getTime() : new Date(ab).getTime();
  return signale.filter((s) => {
    // auch 'in_bearbeitung': setzt ein Telefon-Agent den Status, bevor der Melder abfragt, soll die Warnung nicht ausfallen
    if (!s?.id || !['offen', 'in_bearbeitung'].includes(s.status)) return false;
    if (projekt && s.projekt !== projekt) return false;
    const t = new Date(s.erstellt_am).getTime();
    if (!Number.isFinite(t) || t < abMs) return false;
    if (verworfen.has(s.id)) return false;
    const e = zustand.gewarnt[s.id];
    if (e && (e.gesendet || (e.versuche ?? 0) > MAX_WIEDERHOLUNGEN)) return false;
    return true;
  });
}

// ---- Melder ---------------------------------------------------------------

const kurzId = (id) => String(id).slice(0, 8);
const vorschau = (t) => t.replace(/\s+/g, ' ').slice(0, 40);

/**
 * @param opts.cfg        Ergebnis von warnKonfig, plus projekt
 * @param opts.sb         {url, key, fetchImpl?}
 * @param opts.senden     async (text) => Nachrichten-ID (string) | null; wirft bei Fehler
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

  /** Ein Durchlauf: neue Signale warnen, geloeste einmal melden. Wirft nie. */
  async function tick() {
    if (laeuft || gestoppt) return;
    laeuft = true;
    try {
      const offen = await offeneSignale(sb, projekt);
      for (const s of waehleNeue(offen, { ab: cfg.ab, zustand, verworfen, projekt })) {
        if (gestoppt) break;
        const eintrag = (zustand.gewarnt[s.id] ??= { gesendet: false, erledigt: false, versuche: 0 });
        const r = await schicke(baueText(s), s.id, eintrag, 'gesendet', s.titel);
        if (r === 'verworfen') verworfen.add(s.id);
      }
      if (cfg.erledigt && !gestoppt) {
        const ids = Object.entries(zustand.gewarnt).filter(([, e]) => e.gesendet && !e.erledigt).map(([id]) => id);
        for (const s of await geloesteAus(sb, ids)) {
          if (gestoppt) break;
          const eintrag = zustand.gewarnt[s.id];
          if (!eintrag || eintrag.erledigt || (eintrag.versuchteErledigt ?? 0) > MAX_WIEDERHOLUNGEN) continue;
          const r = await schicke(baueErledigt(s), s.id, eintrag, 'erledigt');
          if (r === 'fehler') eintrag.versuchteErledigt = (eintrag.versuchteErledigt ?? 0) + 1;
          if (r === 'verworfen') {
            eintrag.erledigt = true; // nicht spaeter nachholen, nur diese Meldung faellt weg
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

  /** Kurze Folgenachricht (Bestaetigung einer Rueckmeldung) ueber denselben Weg und dasselbe Rate-Limit. Wirft nie. */
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
