// Hand-built Baileys messages. Everything is made up: numbers, names and IDs are placeholders.
export const EIGENE_JID = '4300000000099:5@s.whatsapp.net';
export const GRUPPE = '120363000000000001@g.us';
const ZEIT = 1794643200; // 2026-11-14T08:00:00Z

const key = (id, extra = {}) => ({ remoteJid: GRUPPE, fromMe: false, id, participant: '4300000000001@s.whatsapp.net', ...extra });

export const gruppeText = {
  key: key('AAA1'),
  pushName: 'Test Polier',
  messageTimestamp: ZEIT,
  message: { conversation: 'Wand Top 5 ist gesetzt (fiktiv)' },
};

export const erweiterterText = {
  key: key('AAA2'),
  pushName: 'Test Polier',
  messageTimestamp: { low: ZEIT, high: 0, unsigned: false },
  message: { extendedTextMessage: { text: 'Siehe https://example.com/plan' } },
};

export const bildMitBeschriftung = {
  key: key('AAA3'),
  pushName: 'Test Elektriker',
  messageTimestamp: String(ZEIT),
  message: { imageMessage: { mimetype: 'image/jpeg', caption: 'Steckdose Wand 5', fileLength: 1234 } },
};

export const sprachnachricht = {
  key: key('AAA4'),
  pushName: 'Test Elektriker',
  messageTimestamp: ZEIT,
  message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true, seconds: 7, fileLength: 4321 } },
};

export const dokument = {
  key: key('AAA5'),
  pushName: 'Test Planer',
  messageTimestamp: ZEIT,
  message: {
    documentWithCaptionMessage: {
      message: { documentMessage: { mimetype: 'application/pdf', fileName: 'Plan_Rev_C.pdf', caption: 'Neuer Plan' } },
    },
  },
};

export const eigeneNachricht = {
  key: key('AAA6', { fromMe: true, participant: undefined }),
  messageTimestamp: ZEIT,
  message: { ephemeralMessage: { message: { conversation: 'Testnachricht von mir (fiktiv)' } } },
};

export const reaktion = {
  key: key('AAA7'),
  messageTimestamp: ZEIT,
  message: { reactionMessage: { text: 'x', key: { id: 'AAA1' } } },
};

export const protokoll = {
  key: key('AAA8'),
  messageTimestamp: ZEIT,
  message: { protocolMessage: { type: 0 } },
};

export const status = {
  key: { remoteJid: 'status@broadcast', fromMe: false, id: 'AAA9', participant: '4300000000001@s.whatsapp.net' },
  pushName: 'Test Polier',
  messageTimestamp: ZEIT,
  message: { conversation: 'Status-Text, darf nie weitergereicht werden' },
};

export const lidAbsender = {
  key: key('AAB1', { participant: '99999999999@lid', participantAlt: '4300000000002@s.whatsapp.net' }),
  pushName: 'Test Bauleiter',
  messageTimestamp: ZEIT,
  message: { conversation: 'Hallo' },
};

export const einzelchat = {
  key: { remoteJid: '4300000000003@s.whatsapp.net', fromMe: false, id: 'AAB2' },
  pushName: 'Test Kollege',
  messageTimestamp: ZEIT,
  message: { conversation: 'Kurz zur Info' },
};

export const sticker = {
  key: key('AAB3'),
  messageTimestamp: ZEIT,
  message: { stickerMessage: { mimetype: 'image/webp' } },
};

export const fremdeGruppe = {
  key: key('AAC1', { remoteJid: '120363000000000999@g.us' }),
  pushName: 'Test Fremder',
  messageTimestamp: ZEIT,
  message: { conversation: 'Privat, nicht auf der Allowlist' },
};
