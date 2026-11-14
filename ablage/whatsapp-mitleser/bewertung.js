// Feedback on warnings (learning loop, first part): a human in the warn chat rates a warning as
// justified or false alarm, the rating is stored on the signal (columns bewertung, bewertung_notiz).
// Pure logic without a Baileys import. The only write access of this service to Supabase is `schreibeBewertung`.
import { entpacken, sekunden } from './mapping.js';
import { PRAEFIX_ERLEDIGT, istMelderNachricht, sauber, textVon } from './melder.js';

// Values per uebersetzer/schema.sql: check (bewertung in ('berechtigt','fehlalarm'))
export const BERECHTIGT = 'berechtigt';
export const FEHLALARM = 'fehlalarm';
export const FENSTER_MS = 10 * 60 * 1000; // an unquoted short message only counts shortly after a warning
export const MAX_KURZ = 80;
export const MAX_NOTIZ_TEXT = 200;
export const SCHREIB_VERSUCHE = 3; // 1 + 2 retries

// ---- Configuration --------------------------------------------------------

/** WHATSAPP_BEWERTEN=1 requires the notifier (WHATSAPP_WARNEN=1). `fehler` set = service must not start like this. */
export function bewertenKonfig(env, warnen) {
  const an = String(env.WHATSAPP_BEWERTEN ?? '').trim() === '1';
  const bestaetigen = String(env.WHATSAPP_BEWERTEN_BESTAETIGEN ?? '1').trim() !== '0';
  let fehler = null;
  if (an && !warnen?.an) fehler = 'WHATSAPP_BEWERTEN=1 braucht WHATSAPP_WARNEN=1 (Rueckmeldungen beziehen sich auf Warnungen des Melders). Der Dienst startet nicht.';
  return { an, bestaetigen, fehler };
}

// ---- Detection (pure) -----------------------------------------------------

const FALSCH = ['fehlalarm', 'falscher alarm', 'stimmt nicht', 'falsch'];
const RICHTIG = ['stimmt', 'richtig', 'korrekt', 'passt'];
const WORT = (w) => new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu');
const FALSCH_RE = FALSCH.map(WORT);
const RICHTIG_RE = RICHTIG.map(WORT);
const VERNEINUNG_RE = WORT('(?:nicht|kein|keine|keinen|nie)'); // "passt nicht", "nicht richtig": never count as "berechtigt"

/** {bewertung, index} for the first rating word, otherwise null. Negating phrases first. */
export function bewertungswort(text) {
  const t = String(text ?? '');
  const treffer = (res) => res.map((r) => t.match(r)).filter(Boolean).map((m) => m.index).sort((a, b) => a - b)[0];
  const f = treffer(FALSCH_RE);
  if (f !== undefined) return { bewertung: FEHLALARM, index: f };
  if (VERNEINUNG_RE.test(t)) return null;
  const r = treffer(RICHTIG_RE);
  if (r !== undefined) return { bewertung: BERECHTIGT, index: r };
  return null;
}

const ohneVarianten = (s) => String(s ?? '').replace(/[\u{FE0F}\u{1F3FB}-\u{1F3FF}]/gu, '').trim();

/** Thumbs up/check mark = berechtigt, thumbs down/cross = Fehlalarm, otherwise null. */
export function bewertungAusEmoji(emoji) {
  const e = ohneVarianten(emoji);
  if (e === '👍' || e === '✅') return BERECHTIGT;
  if (e === '👎' || e === '❌') return FEHLALARM;
  return null;
}

function zitatId(msg) {
  const m = entpacken(msg?.message);
  if (!m) return null;
  for (const v of Object.values(m)) {
    const id = v && typeof v === 'object' ? v.contextInfo?.stanzaId : null;
    if (id) return id;
  }
  return null;
}

const imChat = (msg, chatJid) => {
  const c = String(chatJid ?? '').toLowerCase();
  return !!c && [msg?.key?.remoteJid, msg?.key?.remoteJidAlt].some((j) => j && String(j).toLowerCase() === c);
};

/**
 * Is this message a rating of a warning? Pure.
 * @returns {{signalId, bewertung, form: 'reaktion'|'antwort'|'kurz', inhalt: string, ts: number}|null}
 *   inhalt = emoji or text, ts = time of the message in ms
 */
export function erkenneBewertung(msg, { zustand, chatJid, jetzt = Date.now }) {
  const w = zustand?.warnungen;
  if (!w || !msg?.message || !imChat(msg, chatJid)) return null;
  if (istMelderNachricht(msg, zustand)) return null; // never react to the notifier's own warnings/confirmations
  const ts = (sekunden(msg.messageTimestamp) ?? jetzt() / 1000) * 1000;

  const m = entpacken(msg.message);
  const reaktion = m?.reactionMessage;
  if (reaktion) {
    const ziel = w[reaktion.key?.id];
    const text = String(reaktion.text ?? '');
    if (!ziel || !text.trim()) return null; // foreign message or reaction removed
    const b = bewertungAusEmoji(text);
    return b ? { signalId: ziel.signal, bewertung: b, form: 'reaktion', inhalt: ohneVarianten(text), ts } : null;
  }

  const text = String(textVon(msg) ?? '').trim();
  if (!text) return null;

  const zitat = zitatId(msg);
  if (zitat) {
    const ziel = w[zitat];
    const b = ziel && bewertungswort(text);
    return b ? { signalId: ziel.signal, bewertung: b.bewertung, form: 'antwort', inhalt: text, ts } : null;
  }

  if (text.length > MAX_KURZ) return null;
  const b = bewertungswort(text);
  if (!b || /[\p{L}\p{N}]/u.test(text.slice(0, b.index))) return null; // must start with the word
  let letzte = null;
  for (const e of Object.values(w)) if (e.ts <= ts + 5000 && (!letzte || e.ts > letzte.ts)) letzte = e;
  if (!letzte || ts - letzte.ts > FENSTER_MS) return null;
  return { signalId: letzte.signal, bewertung: b.bewertung, form: 'kurz', inhalt: text, ts };
}

/** `per WhatsApp, <name>, <time>: <text or emoji>`, without phone numbers, text capped at 200 characters. */
export function baueNotiz({ name, inhalt, ts }) {
  const wer = sauber(name).replace(/\s+/g, ' ') || 'unbekannt';
  const zeit = new Date(ts).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' });
  const was = sauber(inhalt).replace(/\s+/g, ' ').slice(0, MAX_NOTIZ_TEXT);
  return `per WhatsApp, ${wer}, ${zeit}: ${was}`;
}

export function baueBestaetigung(bewertung, titel) {
  const wort = bewertung === FEHLALARM ? 'Fehlalarm' : 'Berechtigt';
  const t = sauber(titel);
  return `${PRAEFIX_ERLEDIGT} Rückmeldung gespeichert (${wort})${t ? ` – ${t}` : ''}`.slice(0, 200);
}

// ---- Writing (the only PATCH of the service) --------------------------------

/**
 * PATCH {url}/rest/v1/signale?id=eq.<id> with exactly {bewertung, bewertung_notiz}. A later verdict overwrites the earlier one.
 * Throws on error; no signal matched (Content-Range with 0 rows) counts as an error.
 */
export async function patchBewertung({ url, key, fetchImpl = fetch }, signalId, bewertung, notiz) {
  const r = await fetchImpl(`${String(url).replace(/\/+$/, '')}/rest/v1/signale?id=eq.${encodeURIComponent(signalId)}`, {
    method: 'PATCH',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal,count=exact' },
    body: JSON.stringify({ bewertung, bewertung_notiz: notiz }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Supabase signale: HTTP ${r.status}`);
  const bereich = r.headers?.get?.('content-range');
  if (bereich && /\/0$/.test(bereich)) throw new Error('Supabase signale: kein Signal mit dieser Id');
}

/** Writes with up to 2 retries. Returns {ok:true} or {ok:false, fehler}. Never throws. */
export async function schreibeBewertung(sb, signalId, bewertung, notiz, { schlafen = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let letzter;
  for (let i = 1; i <= SCHREIB_VERSUCHE; i++) {
    try {
      await patchBewertung(sb, signalId, bewertung, notiz);
      return { ok: true };
    } catch (e) {
      letzter = e?.message ?? String(e);
      if (i < SCHREIB_VERSUCHE) await schlafen(1000 * i);
    }
  }
  return { ok: false, fehler: letzter };
}

// ---- Wiring -----------------------------------------------------------------

const kurzId = (id) => String(id).slice(0, 8);
const FORM = { reaktion: 'Reaktion', antwort: 'Antwort', kurz: 'Kurznachricht' };

/**
 * @param opts.sb          {url, key, fetchImpl?}
 * @param opts.zustand     notifier state (with warnungen)
 * @param opts.bestaetigen async (text, signalId) => void, e.g. melder.meldeKurz; null = no confirmation
 */
export function neuerBewerter({ sb, zustand, bestaetigen = null, log = () => {}, jetzt = Date.now, schlafen }) {
  const gesehen = new Set(); // the same message (redelivery) only once
  return {
    /** Never throws. Returns {bewertung, signalId, form, ok} or null (no rating). */
    async verarbeite(msg, { chatJid, eigenerName } = {}) {
      const e = erkenneBewertung(msg, { zustand, chatJid, jetzt });
      if (!e) return null;
      const mid = `${msg.key?.id}|${e.form}|${e.inhalt}`;
      if (gesehen.has(mid)) return null;
      gesehen.add(mid);
      const name = msg.pushName || (msg.key?.fromMe ? eigenerName : '') || '';
      const notiz = baueNotiz({ name, inhalt: e.inhalt, ts: e.ts });
      const r = await schreibeBewertung(sb, e.signalId, e.bewertung, notiz, { schlafen });
      log(`Rueckmeldung: ${kurzId(e.signalId)} | ${e.bewertung} | ${FORM[e.form]} | ${r.ok ? 'gespeichert' : `NICHT gespeichert (${r.fehler})`}`);
      if (r.ok && bestaetigen) {
        const titel = Object.values(zustand.warnungen).filter((x) => x.signal === e.signalId).sort((x, y) => y.ts - x.ts)[0]?.titel ?? ''; // most recent warning
        try {
          await bestaetigen(baueBestaetigung(e.bewertung, titel), e.signalId);
        } catch (x) {
          log(`Rueckmeldung: Bestaetigung nicht gesendet (${x?.message ?? x}).`);
        }
      }
      return { bewertung: e.bewertung, signalId: e.signalId, form: e.form, ok: r.ok };
    },
  };
}
