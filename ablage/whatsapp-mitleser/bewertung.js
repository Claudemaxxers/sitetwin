// Rueckmeldung zu Warnungen (Lernschleife, erster Teil): ein Mensch im Warn-Chat bewertet eine Warnung als
// berechtigt oder Fehlalarm, die Bewertung wird am Signal gespeichert (Spalten bewertung, bewertung_notiz).
// Reine Logik ohne Baileys-Import. Der einzige Schreibzugriff dieses Dienstes auf Supabase ist `schreibeBewertung`.
import { entpacken, sekunden } from './mapping.js';
import { PRAEFIX_ERLEDIGT, istMelderNachricht, sauber, textVon } from './melder.js';

// Werte laut uebersetzer/schema.sql: check (bewertung in ('berechtigt','fehlalarm'))
export const BERECHTIGT = 'berechtigt';
export const FEHLALARM = 'fehlalarm';
export const FENSTER_MS = 10 * 60 * 1000; // ungezitierte Kurznachricht gilt nur kurz nach einer Warnung
export const MAX_KURZ = 80;
export const MAX_NOTIZ_TEXT = 200;
export const SCHREIB_VERSUCHE = 3; // 1 + 2 Wiederholungen

// ---- Konfiguration --------------------------------------------------------

/** WHATSAPP_BEWERTEN=1 braucht den Melder (WHATSAPP_WARNEN=1). `fehler` gesetzt = Dienst darf so nicht starten. */
export function bewertenKonfig(env, warnen) {
  const an = String(env.WHATSAPP_BEWERTEN ?? '').trim() === '1';
  const bestaetigen = String(env.WHATSAPP_BEWERTEN_BESTAETIGEN ?? '1').trim() !== '0';
  let fehler = null;
  if (an && !warnen?.an) fehler = 'WHATSAPP_BEWERTEN=1 braucht WHATSAPP_WARNEN=1 (Rueckmeldungen beziehen sich auf Warnungen des Melders). Der Dienst startet nicht.';
  return { an, bestaetigen, fehler };
}

// ---- Erkennung (rein) -----------------------------------------------------

const FALSCH = ['fehlalarm', 'falscher alarm', 'stimmt nicht', 'falsch'];
const RICHTIG = ['stimmt', 'richtig', 'korrekt', 'passt'];
const WORT = (w) => new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu');
const FALSCH_RE = FALSCH.map(WORT);
const RICHTIG_RE = RICHTIG.map(WORT);
const VERNEINUNG_RE = WORT('(?:nicht|kein|keine|keinen|nie)'); // "passt nicht", "nicht richtig": nie als "berechtigt" werten

/** {bewertung, index} fuer das erste Bewertungswort, sonst null. Verneinende Wendungen zuerst. */
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

/** Daumen/Haken = berechtigt, Daumen runter/Kreuz = Fehlalarm, sonst null. */
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
 * Ist diese Nachricht eine Bewertung einer Warnung? Rein.
 * @returns {{signalId, bewertung, form: 'reaktion'|'antwort'|'kurz', inhalt: string, ts: number}|null}
 *   inhalt = Emoji bzw. Text, ts = Zeit der Nachricht in ms
 */
export function erkenneBewertung(msg, { zustand, chatJid, jetzt = Date.now }) {
  const w = zustand?.warnungen;
  if (!w || !msg?.message || !imChat(msg, chatJid)) return null;
  if (istMelderNachricht(msg, zustand)) return null; // nie auf eigene Warnungen/Bestaetigungen des Melders reagieren
  const ts = (sekunden(msg.messageTimestamp) ?? jetzt() / 1000) * 1000;

  const m = entpacken(msg.message);
  const reaktion = m?.reactionMessage;
  if (reaktion) {
    const ziel = w[reaktion.key?.id];
    const text = String(reaktion.text ?? '');
    if (!ziel || !text.trim()) return null; // fremde Nachricht oder Reaktion entfernt
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
  if (!b || /[\p{L}\p{N}]/u.test(text.slice(0, b.index))) return null; // muss mit dem Wort beginnen
  let letzte = null;
  for (const e of Object.values(w)) if (e.ts <= ts + 5000 && (!letzte || e.ts > letzte.ts)) letzte = e;
  if (!letzte || ts - letzte.ts > FENSTER_MS) return null;
  return { signalId: letzte.signal, bewertung: b.bewertung, form: 'kurz', inhalt: text, ts };
}

/** `per WhatsApp, <Name>, <Zeit>: <Text oder Emoji>`, ohne Telefonnummern, Text auf 200 Zeichen. */
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

// ---- Schreiben (einziger PATCH des Dienstes) --------------------------------

/**
 * PATCH {url}/rest/v1/signale?id=eq.<id> mit genau {bewertung, bewertung_notiz}. Ein spaeteres Urteil ueberschreibt das fruehere.
 * Wirft bei Fehler; kein Signal getroffen (Content-Range mit 0 Zeilen) zaehlt als Fehler.
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

/** Schreibt mit bis zu 2 Wiederholungen. Gibt {ok:true} oder {ok:false, fehler}. Wirft nie. */
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

// ---- Verdrahtung ------------------------------------------------------------

const kurzId = (id) => String(id).slice(0, 8);
const FORM = { reaktion: 'Reaktion', antwort: 'Antwort', kurz: 'Kurznachricht' };

/**
 * @param opts.sb          {url, key, fetchImpl?}
 * @param opts.zustand     Melder-Zustand (mit warnungen)
 * @param opts.bestaetigen async (text, signalId) => void, z. B. melder.meldeKurz; null = keine Bestaetigung
 */
export function neuerBewerter({ sb, zustand, bestaetigen = null, log = () => {}, jetzt = Date.now, schlafen }) {
  const gesehen = new Set(); // dieselbe Nachricht (Neuzustellung) nur einmal
  return {
    /** Wirft nie. Gibt {bewertung, signalId, form, ok} oder null (keine Bewertung). */
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
        const titel = Object.values(zustand.warnungen).find((x) => x.signal === e.signalId)?.titel ?? '';
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
