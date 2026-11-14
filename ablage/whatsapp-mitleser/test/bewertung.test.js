import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  baueBestaetigung, baueNotiz, bewertenKonfig, bewertungswort, erkenneBewertung, neuerBewerter, schreibeBewertung,
} from '../bewertung.js';
import { konfig } from '../config.js';
import { PRAEFIX_ERLEDIGT, PRAEFIX_WARNUNG, ladeZustand, leererZustand, merkeWarnung, neuerMelder } from '../melder.js';

const CHAT = '111-222@g.us';
const T0 = 1_800_000_000; // Sekunden
const zustand = () => {
  const z = leererZustand();
  z.gesendeteIds.push('W1', 'W2');
  merkeWarnung(z, 'W1', 'sig-eins-0000', (T0 - 3600) * 1000, 'Plan veraltet');
  merkeWarnung(z, 'W2', 'sig-zwei-0000', (T0 - 120) * 1000, 'Wand offen');
  return z;
};
const opt = (z = zustand()) => ({ zustand: z, chatJid: CHAT });
const text = (id, t, extra = {}) => ({
  key: { id, remoteJid: CHAT, fromMe: false }, pushName: 'Huber', messageTimestamp: T0, message: { conversation: t }, ...extra,
});
const antwort = (id, t, zitat) => ({
  key: { id, remoteJid: CHAT }, pushName: 'Huber', messageTimestamp: T0,
  message: { extendedTextMessage: { text: t, contextInfo: { stanzaId: zitat } } },
});
const reaktion = (ziel, emoji, remoteJid = CHAT) => ({
  key: { id: 'R1', remoteJid, fromMe: false }, pushName: 'Huber', messageTimestamp: T0,
  message: { reactionMessage: { key: { id: ziel }, text: emoji } },
});

test('Reaktion: Daumen/Haken = berechtigt, Daumen runter/Kreuz = Fehlalarm', () => {
  assert.equal(erkenneBewertung(reaktion('W1', '👍'), opt()).bewertung, 'berechtigt');
  assert.equal(erkenneBewertung(reaktion('W1', '✅'), opt()).bewertung, 'berechtigt');
  assert.equal(erkenneBewertung(reaktion('W1', '👍🏽'), opt()).bewertung, 'berechtigt');
  const f = erkenneBewertung(reaktion('W2', '👎'), opt());
  assert.equal(f.bewertung, 'fehlalarm');
  assert.equal(f.signalId, 'sig-zwei-0000');
  assert.equal(f.form, 'reaktion');
  assert.equal(erkenneBewertung(reaktion('W2', '❌'), opt()).bewertung, 'fehlalarm');
  assert.equal(erkenneBewertung(reaktion('W2', '😂'), opt()), null);
});

test('Reaktion: entfernt (leer), auf fremde Nachricht, aus anderem Chat: ignoriert', () => {
  assert.equal(erkenneBewertung(reaktion('W1', ''), opt()), null);
  assert.equal(erkenneBewertung(reaktion('X9', '👍'), opt()), null);
  assert.equal(erkenneBewertung(reaktion('W1', '👍', '999@g.us'), opt()), null);
});

test('Antwort auf eine Warnung: Wort irgendwo im Text', () => {
  const e = erkenneBewertung(antwort('A1', 'Hab nachgesehen, das war ein Fehlalarm, Plan C liegt vor', 'W1'), opt());
  assert.equal(e.signalId, 'sig-eins-0000');
  assert.equal(e.bewertung, 'fehlalarm');
  assert.equal(e.form, 'antwort');
  assert.equal(erkenneBewertung(antwort('A2', 'ja das stimmt leider', 'W1'), opt()).bewertung, 'berechtigt');
  assert.equal(erkenneBewertung(antwort('A3', 'danke, ich kuemmere mich', 'W1'), opt()), null);
  assert.equal(erkenneBewertung(antwort('A4', 'stimmt', 'FREMD'), opt()), null, 'Antwort auf andere Nachricht zaehlt nicht');
});

test('Kurznachricht: beginnt mit Wort, bezieht sich auf die juengste Warnung', () => {
  const e = erkenneBewertung(text('K1', 'Stimmt, Plan war alt'), opt());
  assert.equal(e.signalId, 'sig-zwei-0000');
  assert.equal(e.bewertung, 'berechtigt');
  assert.equal(e.form, 'kurz');
  assert.equal(erkenneBewertung(text('K2', '  falscher Alarm!'), opt()).bewertung, 'fehlalarm');
  assert.equal(erkenneBewertung(text('K3', 'Das stimmt'), opt()), null, 'Wort nicht am Anfang');
  assert.equal(erkenneBewertung(text('K4', `stimmt ${'x'.repeat(80)}`), opt()), null, 'laenger als 80 Zeichen');
  assert.equal(erkenneBewertung(text('K5', 'Stimmts'), opt()), null, 'kein ganzes Wort');
});

test('Kurznachricht: ausserhalb von 10 Minuten nach der letzten Warnung ignoriert', () => {
  const z = leererZustand();
  merkeWarnung(z, 'W1', 'sig-eins-0000', (T0 - 601) * 1000, 't');
  assert.equal(erkenneBewertung(text('K1', 'stimmt'), opt(z)), null);
  merkeWarnung(z, 'W2', 'sig-zwei-0000', (T0 - 599) * 1000, 't');
  assert.equal(erkenneBewertung(text('K1', 'stimmt'), opt(z)).signalId, 'sig-zwei-0000');
});

test('Wortlogik: Verneinung zuerst, "stimmt nicht" ist nie "stimmt"', () => {
  assert.equal(bewertungswort('stimmt nicht').bewertung, 'fehlalarm');
  assert.equal(bewertungswort('Das stimmt nicht, falsch').bewertung, 'fehlalarm');
  assert.equal(bewertungswort('stimmt, aber falsch gemeldet').bewertung, 'fehlalarm');
  assert.equal(bewertungswort('passt nicht'), null, 'Verneinung eines positiven Worts: keine Bewertung');
  assert.equal(bewertungswort('nicht richtig'), null);
  assert.equal(bewertungswort('korrekt').bewertung, 'berechtigt');
  assert.equal(bewertungswort('PASST schon').bewertung, 'berechtigt');
  assert.equal(bewertungswort('Richtung Bad'), null);
  assert.equal(bewertungswort('guten Morgen'), null);
  assert.equal(erkenneBewertung(text('K1', 'stimmt nicht'), opt()).bewertung, 'fehlalarm');
});

test('Eigene Nachrichten des Melders und andere Chats werden nie bewertet', () => {
  const z = zustand();
  z.gesendeteIds.push('BEST1');
  assert.equal(erkenneBewertung(text('BEST1', 'stimmt'), opt(z)), null, 'per Id');
  assert.equal(erkenneBewertung(text('Q', `${PRAEFIX_ERLEDIGT} Rückmeldung gespeichert (Fehlalarm) – falsch`), opt(z)), null);
  assert.equal(erkenneBewertung(antwort('Q', `${PRAEFIX_WARNUNG}\nstimmt`, 'W1'), opt(z)), null);
  assert.equal(erkenneBewertung(text('Q', 'stimmt', { key: { id: 'Q', remoteJid: '999@g.us' } }), opt(z)), null);
  assert.equal(erkenneBewertung(text('Q', 'stimmt'), { zustand: z, chatJid: '' }), null);
});

test('Eigenes Konto (fromMe) darf bewerten', () => {
  const m = text('M1', 'Fehlalarm', { key: { id: 'M1', remoteJid: CHAT, fromMe: true } });
  assert.equal(erkenneBewertung(m, opt()).bewertung, 'fehlalarm');
  assert.equal(erkenneBewertung({ ...reaktion('W1', '👍'), key: { id: 'R', remoteJid: CHAT, fromMe: true } }, opt()).bewertung, 'berechtigt');
});

test('Ohne gemerkte Warnungen (Schalter aus / alter Zustand) wird nichts erkannt', () => {
  assert.equal(erkenneBewertung(reaktion('W1', '👍'), { zustand: leererZustand(), chatJid: CHAT }), null);
});

// ---- Schreiben ----
const fake = (antworten = []) => {
  const aufrufe = [];
  const fetchImpl = async (url, o) => {
    aufrufe.push({ url, ...o });
    const a = antworten.shift() ?? { ok: true, status: 204 };
    if (a instanceof Error) throw a;
    return a;
  };
  return { aufrufe, sb: { url: 'http://sb/', key: 'KEY', fetchImpl } };
};
const schnell = { schlafen: async () => {} };

test('PATCH: URL, Methode, Header, Body mit genau zwei Spalten', async () => {
  const f = fake();
  const r = await schreibeBewertung(f.sb, 'abc-123', 'fehlalarm', 'per WhatsApp, X', schnell);
  assert.equal(r.ok, true);
  assert.equal(f.aufrufe.length, 1);
  const a = f.aufrufe[0];
  assert.equal(a.url, 'http://sb/rest/v1/signale?id=eq.abc-123');
  assert.equal(a.method, 'PATCH');
  assert.equal(a.headers.apikey, 'KEY');
  assert.equal(a.headers.Authorization, 'Bearer KEY');
  assert.equal(a.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(a.body), { bewertung: 'fehlalarm', bewertung_notiz: 'per WhatsApp, X' });
  assert.deepEqual(Object.keys(JSON.parse(a.body)), ['bewertung', 'bewertung_notiz']);
});

test('PATCH: zwei Wiederholungen, dann aufgeben; Erfolg im zweiten Versuch', async () => {
  const f = fake([{ ok: false, status: 500 }, new Error('netz'), { ok: false, status: 503 }]);
  const r = await schreibeBewertung(f.sb, 'a', 'berechtigt', 'n', schnell);
  assert.equal(f.aufrufe.length, 3);
  assert.equal(r.ok, false);
  assert.match(r.fehler, /503/);
  const g = fake([{ ok: false, status: 500 }]);
  assert.equal((await schreibeBewertung(g.sb, 'a', 'berechtigt', 'n', schnell)).ok, true);
  assert.equal(g.aufrufe.length, 2);
});

test('PATCH: kein Signal getroffen (Content-Range mit 0 Zeilen) ist ein Fehler', async () => {
  const f = fake([1, 2, 3].map(() => ({ ok: true, status: 204, headers: { get: () => '*/0' } })));
  assert.equal((await schreibeBewertung(f.sb, 'a', 'berechtigt', 'n', schnell)).ok, false);
});

test('Notiz: Name, Zeit, Text auf 200 Zeichen, keine Telefonnummer', () => {
  const n = baueNotiz({ name: 'Huber +43 660 1234567', inhalt: `stimmt ${'x'.repeat(300)} 0660 1234567`, ts: T0 * 1000 });
  assert.match(n, /^per WhatsApp, Huber, .+: stimmt x+$/);
  assert.doesNotMatch(n, /660|1234567/);
  assert.equal(n.split(': ').slice(1).join(': ').length, 200);
  assert.match(baueNotiz({ name: '', inhalt: '👍', ts: T0 * 1000 }), /^per WhatsApp, unbekannt, .*: 👍$/);
});

test('Bestaetigung beginnt mit dem Melder-Praefix und wird nie als Bewertung gelesen', () => {
  const t = baueBestaetigung('fehlalarm', 'Plan veraltet');
  assert.equal(t, '✅ SiteTwin: Rückmeldung gespeichert (Fehlalarm) – Plan veraltet');
  assert.equal(erkenneBewertung(text('B', t), opt(zustand())), null);
});

// ---- Bewerter ----
function bauBewerter({ bestaetigen = true, antworten = [] } = {}) {
  const z = zustand();
  const f = fake(antworten);
  const log = [];
  const bestaetigt = [];
  const b = neuerBewerter({
    sb: f.sb, zustand: z, log: (...a) => log.push(a.join(' ')), ...schnell,
    bestaetigen: bestaetigen ? async (t, id) => { bestaetigt.push([t, id]); } : null,
  });
  return { b, f, log, bestaetigt, z };
}

test('Bewerter: speichert, bestaetigt, loggt eine Zeile ohne Chat-Text; zweite Bewertung ueberschreibt', async () => {
  const t = bauBewerter();
  const r = await t.b.verarbeite(reaktion('W1', '👎'), { chatJid: CHAT });
  assert.equal(r.ok, true);
  assert.equal(t.f.aufrufe.length, 1);
  assert.match(t.f.aufrufe[0].url, /id=eq\.sig-eins-0000$/);
  assert.equal(t.bestaetigt.length, 1);
  assert.equal(t.bestaetigt[0][0], '✅ SiteTwin: Rückmeldung gespeichert (Fehlalarm) – Plan veraltet');
  assert.equal(t.log.length, 1);
  assert.match(t.log[0], /sig-eins \| fehlalarm \| Reaktion \| gespeichert/);
  await t.b.verarbeite(antwort('A1', 'doch, stimmt', 'W1'), { chatJid: CHAT });
  assert.equal(t.f.aufrufe.length, 2);
  assert.equal(JSON.parse(t.f.aufrufe[1].body).bewertung, 'berechtigt');
  assert.equal(t.f.aufrufe[1].url, t.f.aufrufe[0].url);
});

test('Bewerter: Bestaetigung abschaltbar; bei Schreibfehler keine Bestaetigung; Neuzustellung nur einmal', async () => {
  const t = bauBewerter({ bestaetigen: false });
  await t.b.verarbeite(text('K1', 'stimmt'), { chatJid: CHAT });
  await t.b.verarbeite(text('K1', 'stimmt'), { chatJid: CHAT });
  assert.equal(t.f.aufrufe.length, 1);
  assert.equal(t.bestaetigt.length, 0);
  const u = bauBewerter({ antworten: [{ ok: false, status: 500 }, { ok: false, status: 500 }, { ok: false, status: 500 }] });
  const r = await u.b.verarbeite(text('K1', 'falsch'), { chatJid: CHAT });
  assert.equal(r.ok, false);
  assert.equal(u.bestaetigt.length, 0);
  assert.match(u.log[0], /NICHT gespeichert/);
  assert.equal(await u.b.verarbeite(text('K9', 'guten Morgen'), { chatJid: CHAT }), null);
});

test('Bewerter: Name aus pushName, bei eigenem Konto der eigene Name', async () => {
  const t = bauBewerter();
  await t.b.verarbeite(text('M1', 'stimmt', { pushName: undefined, key: { id: 'M1', remoteJid: CHAT, fromMe: true } }), { chatJid: CHAT, eigenerName: 'Santino' });
  assert.match(JSON.parse(t.f.aufrufe[0].body).bewertung_notiz, /^per WhatsApp, Santino, /);
});

// ---- Schalter, Zustand, Melder ----
test('Rueckmeldung: aus per Standard, Verweigerung ohne Melder', () => {
  assert.equal(konfig({ WHATSAPP_CHATS: 'G' }).bewerten.an, false);
  assert.equal(konfig({ WHATSAPP_CHATS: 'G' }).bewerten.fehler, null);
  assert.equal(konfig({ WHATSAPP_CHATS: 'G', WHATSAPP_WARNEN: '0', WHATSAPP_BEWERTEN: '0' }).bewerten.an, false);
  const ohne = bewertenKonfig({ WHATSAPP_BEWERTEN: '1' }, { an: false });
  assert.equal(ohne.an, true);
  assert.match(ohne.fehler, /WHATSAPP_WARNEN=1/);
  const mit = konfig({ WHATSAPP_CHATS: 'G', WHATSAPP_WARNEN: '1', WHATSAPP_WARN_CHAT: 'G', WHATSAPP_BEWERTEN: '1' }).bewerten;
  assert.deepEqual([mit.an, mit.fehler, mit.bestaetigen], [true, null, true]);
  assert.equal(bewertenKonfig({ WHATSAPP_BEWERTEN: '1', WHATSAPP_BEWERTEN_BESTAETIGEN: '0' }, { an: true }).bestaetigen, false);
});

test('Zustand: alte Datei ohne warnungen laedt, neue Felder entstehen nur bei Bedarf', () => {
  const d = join(mkdtempSync(join(tmpdir(), 'melder-')), 'melder.json');
  writeFileSync(d, JSON.stringify({ gewarnt: { a: { gesendet: true } }, gesendeteIds: ['x'] }));
  const z = ladeZustand(d);
  assert.deepEqual(z, { gewarnt: { a: { gesendet: true } }, gesendeteIds: ['x'] });
  assert.equal('warnungen' in z, false);
  merkeWarnung(z, 'm1', 's1', 5, 'T');
  assert.deepEqual(z.warnungen.m1, { signal: 's1', ts: 5, titel: 'T' });
  writeFileSync(d, JSON.stringify(z));
  assert.equal(ladeZustand(d).warnungen.m1.signal, 's1');
});

test('Melder merkt Nachricht -> Signal nur mit Schalter, Bestaetigung ueber denselben Weg', async () => {
  const sig = { id: 'aaaaaaaa-1', projekt: 'P', status: 'offen', titel: 'Plan alt', erstellt_am: '2026-11-14T10:00:00Z' };
  const bau = (merkeWarnungen) => {
    const gesendet = [];
    const z = leererZustand();
    const m = neuerMelder({
      cfg: { ab: new Date('2026-11-14T09:00:00Z'), intervallS: 5, maxPro10Min: 6, erledigt: false }, projekt: 'P', merkeWarnungen,
      sb: { url: 'http://sb', key: 'k', fetchImpl: async () => ({ ok: true, status: 200, json: async () => [sig] }) },
      zustand: z, senden: async (t) => (gesendet.push(t), `id${gesendet.length}`),
    });
    return { m, z, gesendet };
  };
  const aus = bau(false);
  await aus.m.tick();
  assert.equal('warnungen' in aus.z, false);
  const an = bau(true);
  await an.m.tick();
  assert.equal(an.z.warnungen.id1.signal, 'aaaaaaaa-1');
  assert.equal(an.z.warnungen.id1.titel, 'Plan alt');
  assert.equal(await an.m.meldeKurz('✅ SiteTwin: Rückmeldung gespeichert (Fehlalarm) – Plan alt', 'aaaaaaaa-1'), 'ok');
  assert.equal(an.gesendet.length, 2);
  assert.ok(an.z.gesendeteIds.includes('id2'), 'Bestaetigung ist als Melder-Nachricht gemerkt');
  assert.equal(Object.keys(an.z.warnungen).length, 1, 'Bestaetigung ist keine Warnung');
});
