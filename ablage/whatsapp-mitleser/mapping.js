// Reine Funktionen: Baileys-Nachricht -> Anfrage an POST /import/whatsapp/nachricht der Ablage.
// Kein Socket, kein Netz, kein Dateizugriff. Dadurch ohne WhatsApp testbar.

const WRAPPER = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
];

const MEDIEN = {
  imageMessage: { art: 'bild', ext: 'jpg' },
  videoMessage: { art: 'video', ext: 'mp4' },
  audioMessage: { art: 'audio', ext: 'ogg' },
  documentMessage: { art: 'dokument', ext: 'bin' },
};

const ENDUNG_NACH_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
};

/** Packt Wrapper (fluechtige Nachrichten, einmal ansehen, Dokument mit Beschriftung) aus. */
export function entpacken(message) {
  let m = message;
  for (let i = 0; i < 5 && m; i++) {
    const w = WRAPPER.find((k) => m[k]?.message);
    if (!w) break;
    m = m[w].message;
  }
  return m ?? null;
}

/** Unix-Sekunden aus number, string oder Long-artigem Objekt. */
export function sekunden(ts) {
  if (ts == null) return null;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') return Number(ts);
  if (typeof ts.toNumber === 'function') return ts.toNumber();
  if (typeof ts.low === 'number') return ts.low + (ts.high ?? 0) * 2 ** 32;
  return null;
}

export function istStatusOderBroadcast(jid) {
  return !jid || jid.endsWith('@broadcast') || jid.endsWith('@newsletter');
}

/**
 * Was steckt in der Nachricht? Gibt {art, text, medium} zurueck oder {art: 'ignoriert', grund}.
 * art: text | bild | video | audio | dokument
 */
export function inhalt(msg) {
  const jid = msg?.key?.remoteJid;
  if (istStatusOderBroadcast(jid)) return { art: 'ignoriert', grund: 'status/broadcast' };
  const m = entpacken(msg.message);
  if (!m) return { art: 'ignoriert', grund: 'kein Inhalt' };
  if (m.protocolMessage) return { art: 'ignoriert', grund: 'protokoll' };
  if (m.reactionMessage) return { art: 'ignoriert', grund: 'reaktion' };

  for (const [schluessel, info] of Object.entries(MEDIEN)) {
    const teil = m[schluessel];
    if (!teil) continue;
    const mime = (teil.mimetype ?? '').split(';')[0].trim().toLowerCase() || null;
    return {
      art: info.art,
      text: (teil.caption ?? '').trim(),
      medium: {
        schluessel,
        mimetype: mime,
        dateiname: dateiname(msg, schluessel, teil, mime, info.ext),
        groesse: sekunden(teil.fileLength),
        sprachnachricht: schluessel === 'audioMessage' ? Boolean(teil.ptt) : false,
      },
    };
  }

  const text = (m.conversation ?? m.extendedTextMessage?.text ?? '').trim();
  if (text) return { art: 'text', text, medium: null };
  return { art: 'ignoriert', grund: 'nicht unterstuetzter Typ' };
}

function dateiname(msg, schluessel, teil, mime, standardEndung) {
  if (schluessel === 'documentMessage' && teil.fileName) {
    return String(teil.fileName).replace(/[\\/]/g, '_');
  }
  const ext = ENDUNG_NACH_MIME[mime] ?? standardEndung;
  const stamm = (msg.key.id ?? 'anhang').replace(/[^A-Za-z0-9_-]/g, '');
  return `${stamm}.${ext}`;
}

function nurZiffern(jid) {
  const nutzer = (jid ?? '').split('@')[0].split(':')[0];
  return /^\d{5,}$/.test(nutzer) ? nutzer : null;
}

/** Handynummer des Absenders, wenn bekannt (LID-Adressen sind keine Nummern). */
export function absenderNummer(msg, eigeneJid) {
  if (msg.key.fromMe) return nurZiffern(eigeneJid);
  const kandidaten = [msg.key.participant, msg.key.participantAlt, msg.key.remoteJid, msg.key.remoteJidAlt];
  for (const k of kandidaten) {
    if (k && k.endsWith('@s.whatsapp.net')) return nurZiffern(k);
  }
  return null;
}

export function absenderText(msg, { eigeneJid, eigenerName } = {}) {
  const name = (msg.pushName || (msg.key.fromMe ? eigenerName : '') || '').trim();
  const nummer = absenderNummer(msg, eigeneJid);
  if (name && nummer) return `${name} (+${nummer})`;
  if (name) return name;
  if (nummer) return `+${nummer}`;
  return msg.key.fromMe ? 'Ich' : 'Unbekannt';
}

/**
 * Anfrage-Body fuer die Ablage. `anhang` ist {mimetype, dateiname, base64} oder null
 * (Download passiert ausserhalb, damit diese Funktion rein bleibt).
 */
export function baueAnfrage(msg, { kanal, projekt, anhang = null, eigeneJid, eigenerName } = {}) {
  const i = inhalt(msg);
  if (i.art === 'ignoriert') return null;
  const s = sekunden(msg.messageTimestamp);
  const body = {
    absender: absenderText(msg, { eigeneJid, eigenerName }),
    zeitpunkt: new Date((s ?? Date.now() / 1000) * 1000).toISOString(),
    text: i.text,
    wa_id: msg.key.id,
  };
  if (projekt) body.projekt = projekt;
  if (kanal) body.kanal = kanal;
  if (anhang) {
    body.anhang = { dateiname: anhang.dateiname, base64: anhang.base64 };
    if (anhang.mimetype) body.anhang.mimetype = anhang.mimetype;
  }
  return body;
}

// ---- Allowlist ------------------------------------------------------------

/** "Name A, Name B, 123-456@g.us" -> {namen: Set(klein), jids: Set(klein), leer} */
export function parseAllowlist(wert) {
  const namen = new Set();
  const jids = new Set();
  for (const roh of String(wert ?? '').split(',')) {
    const eintrag = roh.trim();
    if (!eintrag) continue;
    if (/@(g\.us|s\.whatsapp\.net|lid)$/.test(eintrag)) jids.add(eintrag.toLowerCase());
    else if (/^\+?\d{6,}$/.test(eintrag)) jids.add(`${eintrag.replace('+', '')}@s.whatsapp.net`);
    else namen.add(eintrag.toLowerCase());
  }
  return { namen, jids, leer: namen.size === 0 && jids.size === 0 };
}

/** Darf dieser Chat weitergereicht werden? `gruppenname` ist der Betreff, falls Gruppe und bekannt. */
export function istErlaubt(allowlist, { jid, jidAlt, gruppenname }) {
  if (allowlist.leer) return false;
  for (const j of [jid, jidAlt]) {
    if (j && allowlist.jids.has(j.toLowerCase())) return true;
  }
  return Boolean(gruppenname) && allowlist.namen.has(gruppenname.trim().toLowerCase());
}

/** Kanalname: Gruppenname, sonst Name/Nummer des Gegenuebers im 1:1-Chat. */
export function kanalName(msg, gruppenname) {
  if (gruppenname) return gruppenname;
  const jid = msg.key.remoteJid ?? '';
  if (jid.endsWith('@g.us')) return 'WhatsApp-Gruppe';
  if (!msg.key.fromMe && msg.pushName) return msg.pushName;
  const alt = msg.key.remoteJidAlt?.endsWith('@s.whatsapp.net') ? msg.key.remoteJidAlt : jid;
  const nr = nurZiffern(alt);
  return nr ? `+${nr}` : 'WhatsApp-Chat';
}
