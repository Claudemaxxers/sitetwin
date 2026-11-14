// WhatsApp-Mitleser: reads along in allowed chats as a linked device and forwards new
// messages to the Ablage. Read only, never send. Unofficial (Baileys), prototype only.
import { mkdirSync } from 'node:fs';
import pino from 'pino';
import qrTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from 'baileys';
import { AUTH_ORDNER, QR_DATEI, ZUSTAND_DATEI, ladeEnv } from './config.js';
import { sende } from './forward.js';
import { baueAnfrage, inhalt, istErlaubt, kanalName } from './mapping.js';
import { neuerBewerter } from './bewertung.js';
import { alleSignale, baueText, istMelderNachricht, ladeZustand, merkeGesendet, merkeWarnung, neuerMelder, speichereZustand } from './melder.js';

const nurChats = process.argv.includes('--chats');
const cfg = ladeEnv();
const startSekunden = Math.floor(Date.now() / 1000);
const logger = pino({ level: 'silent' });
const kurz = (s, n = 40) => (s.length > n ? `${s.slice(0, n)}...` : s).replace(/\s+/g, ' ');
const log = (...a) => console.log(new Date().toLocaleTimeString('de-AT'), ...a);

const gruppen = new Map(); // jid -> subject
let warteschlange = Promise.resolve(); // keeps the order
let wartezeitMs = 2000;

if (!nurChats) {
  if (cfg.allowlist.leer) {
    console.log(
      'Hinweis: WHATSAPP_CHATS ist leer, es wird NICHTS weitergereicht.\n' +
        'Mit "npm run chats" die Gruppen anzeigen lassen und dann in .env eintragen.',
    );
  } else {
    console.log(`Erlaubt: ${cfg.allowlist.namen.size} Name(n), ${cfg.allowlist.jids.size} JID(s). Ablage: ${cfg.ablageUrl}, Projekt: ${cfg.projekt}`);
  }
}

// Notifier (warnings into a chat): off by default, then the service stays read-only.
const warnAn = !nurChats && cfg.warnen.an;
const warnProbe = process.argv.includes('--warn-probe'); // send one warning marked as TEST, then exit
let melderZustand = null;
let melder = null;
let bewerter = null;
const bewertenAn = warnAn && cfg.bewerten.an; // feedback on warnings (the only write access to Supabase)
if (!nurChats && cfg.bewerten.fehler) {
  console.error(`Rueckmeldung: ${cfg.bewerten.fehler}`);
  process.exit(1);
}
if (warnAn) {
  if (cfg.warnen.fehler) {
    console.error(`Melder: ${cfg.warnen.fehler}`);
    process.exit(1);
  }
  if (!cfg.supabase) {
    console.error('Melder: SUPABASE_URL und SUPABASE_SERVICE_KEY fehlen (weder hier noch in ../.env). Der Melder startet nicht.');
    process.exit(1);
  }
  melderZustand = ladeZustand(ZUSTAND_DATEI);
  console.log(`Melder AN: warnt nur in "${cfg.warnen.chat}" (Projekt ${cfg.projekt}, ab ${cfg.warnen.ab.toISOString()}, alle ${cfg.warnen.intervallS} s).`);
  if (bewertenAn) console.log(`Rueckmeldung AN: Reaktion, Antwort oder Kurznachricht im Warn-Chat wird am Signal gespeichert${cfg.bewerten.bestaetigen ? ', mit Bestaetigung im Chat' : ''}.`);
}

/** Target JID of the warn chat: JID directly, otherwise via the group name from the known group list. */
function warnJid() {
  const c = cfg.warnen.chat;
  if (/@(g\.us|s\.whatsapp\.net|lid)$/.test(c)) return c;
  for (const [jid, name] of gruppen) if (name?.trim().toLowerCase() === c.toLowerCase()) return jid;
  return null;
}

// Probe (npm run warn-probe): sends ONE warning marked as a test into the warn chat, built from the
// newest signal of the project (whatever its status), and checks that it does not flow back into the Ablage.
async function probe(sock) {
  const jid = warnJid();
  if (!jid) {
    console.error('Probe: Warn-Chat nicht in der Gruppenliste gefunden.');
    process.exit(1);
  }
  const alle = await alleSignale(cfg.supabase, cfg.projekt);
  if (!alle.length) {
    console.error(`Probe: keine Signale im Projekt ${cfg.projekt}.`);
    process.exit(1);
  }
  const [kopf, ...rest] = baueText(alle[0]).split('\n');
  const text = [kopf, 'TEST: kein echter Vorfall, nur eine Probe der Warnung.', ...rest].join('\n');
  const res = await sock.sendMessage(jid, { text });
  const id = res?.key?.id ?? null;
  if (id) {
    merkeGesendet(melderZustand, id);
    if (bewertenAn) merkeWarnung(melderZustand, id, alle[0].id, Date.now(), alle[0].titel);
    speichereZustand(ZUSTAND_DATEI, melderZustand);
  }
  const warteS = bewertenAn ? 180 : 10;
  if (bewertenAn) richteBewertungEin(sock); // notifier only for the confirmation, without start(): no polling, no further warnings
  log(`Probe gesendet an "${cfg.warnen.chat}" (Nachrichten-Id ${id ? 'erhalten' : 'FEHLT'}). Warte ${warteS} s auf die eigene Nachricht${bewertenAn ? ' und auf eine Bewertung (Reaktion, Antwort oder Kurznachricht im Warn-Chat)' : ''} ...`);
  setTimeout(() => {
    log('Probe beendet.');
    process.exit(0);
  }, warteS * 1000);
}

/** Notifier object (send path, rate limit, state) and rater. With start() the polling runs, without it only the send path. */
function richteBewertungEin(sock) {
  melder?.stop();
  melder = neuerMelder({
    cfg: cfg.warnen,
    projekt: cfg.projekt,
    sb: cfg.supabase,
    zustand: melderZustand,
    speichern: (z) => speichereZustand(ZUSTAND_DATEI, z),
    log,
    merkeWarnungen: bewertenAn,
    senden: async (text) => {
      const jid = warnJid();
      if (!jid) throw new Error('Warn-Chat nicht in der Gruppenliste gefunden');
      const res = await sock.sendMessage(jid, { text });
      return res?.key?.id ?? null;
    },
  });
  if (bewertenAn) {
    bewerter = neuerBewerter({
      sb: cfg.supabase,
      zustand: melderZustand,
      log,
      bestaetigen: cfg.bewerten.bestaetigen ? (text, signalId) => melder.meldeKurz(text, signalId) : null,
    });
  }
}

function starteMelder(sock) {
  richteBewertungEin(sock);
  melder.start();
}

mkdirSync(AUTH_ORDNER, { recursive: true });

async function verbinden() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_ORDNER);
  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch {
    /* the library's default version */
  }
  const sock = makeWASocket({
    auth: state,
    ...(version ? { version } : {}),
    logger,
    browser: Browsers.macOS('Chrome'),
    markOnlineOnConnect: false, // never appear as online
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false, // no history, live only
    generateHighQualityLinkPreview: false,
  });
  let kopplungAngefragt = false;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      if (cfg.nummer && !state.creds.registered) {
        if (!kopplungAngefragt) {
          kopplungAngefragt = true;
          try {
            const code = await sock.requestPairingCode(cfg.nummer);
            console.log(
              `\nKopplungscode: ${code}\nIn WhatsApp: Einstellungen > Verknuepfte Geraete > Geraet verknuepfen > "Stattdessen mit Telefonnummer verknuepfen" und den Code eingeben.\n`,
            );
          } catch (e) {
            console.error(`Kopplungscode fehlgeschlagen: ${e.message}`);
          }
        }
      } else {
        console.log('\nQR-Code mit WhatsApp scannen (Einstellungen > Verknuepfte Geraete > Geraet verknuepfen):');
        qrTerminal.generate(qr, { small: true });
        try {
          await QRCode.toFile(QR_DATEI, qr, { width: 400 });
          console.log(`Falls das Terminal den Code verzerrt: ${QR_DATEI} oeffnen (wird bei jedem neuen Code ersetzt).`);
        } catch (e) {
          console.warn(`QR-Bild nicht gespeichert: ${e.message}`);
        }
      }
    }

    if (connection === 'open') {
      wartezeitMs = 2000;
      log('Verbunden.');
      try {
        const alle = await sock.groupFetchAllParticipating();
        for (const g of Object.values(alle)) gruppen.set(g.id, g.subject);
        if (nurChats) {
          zeigeChats(alle);
          process.exit(0);
        }
        log(`${gruppen.size} Gruppen bekannt. Warte auf neue Nachrichten (Strg+C beendet).`);
        if (warnAn && warnProbe) await probe(sock);
        else if (warnAn) starteMelder(sock);
      } catch (e) {
        console.error(`Gruppenliste nicht abrufbar: ${e.message}`);
        if (nurChats) process.exit(1);
      }
    }

    if (connection === 'close') {
      melder?.stop();
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.error(
          '\nAbgemeldet (Geraet in WhatsApp entfernt oder Sitzung ungueltig). Ordner "auth" loeschen und neu starten, um neu zu koppeln.',
        );
        process.exit(1);
      }
      const sofort = code === DisconnectReason.restartRequired; // normal right after pairing
      log(`Verbindung getrennt (Code ${code ?? '?'}), neuer Versuch${sofort ? '' : ` in ${Math.round(wartezeitMs / 1000)} s`}.`);
      const pause = sofort ? 0 : wartezeitMs;
      wartezeitMs = Math.min(wartezeitMs * 2, 60000);
      setTimeout(() => verbinden().catch(fatal), pause);
    }
  });

  if (!nurChats) {
    sock.ev.on('groups.upsert', (liste) => liste.forEach((g) => gruppen.set(g.id, g.subject)));
    sock.ev.on('groups.update', (liste) => liste.forEach((g) => g.subject && gruppen.set(g.id, g.subject)));
    sock.ev.on('messages.upsert', ({ messages }) => {
      for (const msg of messages) {
        warteschlange = warteschlange.then(() => verarbeite(sock, msg)).catch((e) => console.error(`Fehler: ${e.message}`));
      }
    });
  }
}

function zeigeChats(alle) {
  const liste = Object.values(alle).sort((a, b) => a.subject.localeCompare(b.subject, 'de'));
  console.log(`\n${liste.length} Gruppen:\n`);
  for (const g of liste) console.log(`  ${g.subject}\n    ${g.id}`);
  console.log('\nIn .env eintragen, z. B. WHATSAPP_CHATS=Gruppenname  (mehrere durch Komma, oder die JID).');
}

async function gruppenname(sock, jid) {
  if (!jid?.endsWith('@g.us')) return undefined;
  if (!gruppen.has(jid)) {
    try {
      gruppen.set(jid, (await sock.groupMetadata(jid)).subject);
    } catch {
      return undefined;
    }
  }
  return gruppen.get(jid);
}

async function verarbeite(sock, msg) {
  if (!msg?.key?.remoteJid || !msg.message) return;
  // Never forward the notifier's own warnings to the Ablage (no feedback loop).
  if (melderZustand && istMelderNachricht(msg, melderZustand)) {
    if (warnProbe) log(`Probe: eigene Warnung kam zurueck und wurde NICHT weitergereicht (per Id erkannt: ${melderZustand.gesendeteIds.includes(msg.key?.id) ? 'ja' : 'nein'}).`);
    return;
  }
  if (cfg.allowlist.leer) return;
  const zeit = Number(msg.messageTimestamp?.toNumber?.() ?? msg.messageTimestamp ?? 0);
  if (zeit && zeit < startSekunden - 60) return; // history, not live

  const jid = msg.key.remoteJid;
  const name = await gruppenname(sock, jid);
  // From here on, do not log anything that is not on the allowlist.
  if (!istErlaubt(cfg.allowlist, { jid, jidAlt: msg.key.remoteJidAlt, gruppenname: name })) return;

  // Feedback on a warning (warn chat only, only with WHATSAPP_BEWERTEN=1). Forwarding then happens as usual.
  if (bewerter) await bewerter.verarbeite(msg, { chatJid: warnJid(), eigenerName: sock.user?.name });

  const i = inhalt(msg);
  if (i.art === 'ignoriert') return;
  const kanal = kanalName(msg, name);

  let anhang = null;
  if (i.medium) {
    if (i.medium.groesse && i.medium.groesse > cfg.maxBytes) {
      log(`[${kanal}] ${i.art} zu gross (${Math.round(i.medium.groesse / 1048576)} MB), nur Text wird weitergereicht.`);
    } else {
      try {
        const daten = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
        if (daten.length > cfg.maxBytes) throw new Error('zu gross');
        anhang = { mimetype: i.medium.mimetype, dateiname: i.medium.dateiname, base64: daten.toString('base64') };
      } catch (e) {
        log(`[${kanal}] ${i.art}: Download fehlgeschlagen (${e.message}), nur Text wird weitergereicht.`);
      }
    }
  }

  const body = baueAnfrage(msg, {
    kanal,
    projekt: cfg.projekt,
    anhang,
    eigeneJid: sock.user?.id,
    eigenerName: sock.user?.name,
  });
  if (!body) return;
  if (!body.text && !body.anhang) return; // medium without attachment and without text: nothing to store

  const r = await sende(cfg.ablageUrl, body);
  const vorschau = body.text ? ` "${kurz(body.text)}"` : '';
  if (r.ok) {
    log(`[${kanal}] ${body.absender.replace(/\(\+\d+\)/, '').trim()} | ${i.art}${vorschau} -> neu ${r.antwort.neu}, duplikate ${r.antwort.duplikate}${r.antwort.fehler?.length ? `, fehler ${r.antwort.fehler.length}` : ''}`);
  } else {
    log(`[${kanal}] ${i.art}${vorschau} -> NICHT zugestellt (${r.fehler}), weiter mit der naechsten.`);
  }
}

function fatal(e) {
  console.error(`Abbruch: ${e?.message ?? e}`);
  process.exit(1);
}

process.on('SIGINT', () => {
  console.log('\nBeendet.');
  process.exit(0);
});

verbinden().catch(fatal);
