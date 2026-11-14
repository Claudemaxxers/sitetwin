import test from 'node:test';
import assert from 'node:assert/strict';
import { baueAnfrage, parseAllowlist } from '../mapping.js';
import { konfig } from '../config.js';
import {
  PRAEFIX_ERLEDIGT, PRAEFIX_WARNUNG, baueErledigt, baueText, istMelderNachricht, leererZustand, merkeGesendet,
  neuerMelder, neuesLimit, warnKonfig, waehleNeue,
} from '../melder.js';

const sig = (o = {}) => ({
  id: 'aaaaaaaa-1111', projekt: 'P', status: 'offen', schwere: 'hoch', titel: 'Plan Index B veraltet',
  anruf_text: 'Bitte stoppen: Index C gilt.', raum: 'Bad', element: 'Wand', top: null, zustaendig: 'Herr Huber',
  telefon: '+43 660 1234567', erstellt_am: '2026-11-14T10:00:00Z', ...o,
});
const AB = new Date('2026-11-14T09:00:00Z');

test('Text: Felder, keine Telefonnummer, Kopfzeile', () => {
  const t = baueText(sig());
  assert.ok(t.startsWith(PRAEFIX_WARNUNG));
  assert.match(t, /Plan Index B veraltet/);
  assert.match(t, /Wo: Bad, Wand/);
  assert.match(t, /Bitte stoppen/);
  assert.match(t, /Zuständig: Herr Huber/);
  assert.doesNotMatch(t, /660|1234567/);
});

test('Text: leere Felder fallen weg, Nummer im Namen wird entfernt', () => {
  const t = baueText(sig({ anruf_text: null, begruendung: '', raum: '', element: null, zustaendig: '  ' }));
  assert.equal(t, `${PRAEFIX_WARNUNG}\nPlan Index B veraltet`);
  assert.doesNotMatch(baueText(sig({ zustaendig: 'Huber +43 660 1234567' })), /\+43|1234567/);
});

test('Text: Laengengrenze, Zustaendig bleibt erhalten', () => {
  const t = baueText(sig({ anruf_text: 'x'.repeat(3000) }));
  assert.ok(t.length <= 700);
  assert.match(t, /Zuständig: Herr Huber$/);
  assert.ok(baueText(sig({ titel: 'y'.repeat(2000) })).length <= 700);
});

test('Erledigt-Text', () => {
  assert.equal(baueErledigt(sig()), `${PRAEFIX_ERLEDIGT} erledigt – Plan Index B veraltet`);
});

test('Auswahl: Status, Projekt, Zeitpunkt, schon gewarnt', () => {
  const z = leererZustand();
  z.gewarnt.bereits = { gesendet: true };
  z.gewarnt.aufgegeben = { gesendet: false, versuche: 4 };
  const liste = [
    sig({ id: 'neu' }),
    sig({ id: 'alt', erstellt_am: '2026-11-13T10:00:00Z' }),
    sig({ id: 'zu', status: 'geloest' }),
    sig({ id: 'fremd', projekt: 'Q' }),
    sig({ id: 'bereits' }),
    sig({ id: 'aufgegeben' }),
  ];
  assert.deepEqual(waehleNeue(liste, { ab: AB, zustand: z, projekt: 'P' }).map((s) => s.id), ['neu']);
});

function bau({ signale, geloest = [], senden, zustand = leererZustand(), cfgPlus = {} } = {}) {
  const log = [];
  const anfragen = [];
  const fetchImpl = async (url, opt) => {
    anfragen.push({ url, methode: opt.method });
    const antwort = url.includes('status=eq.geloest') ? geloest : signale();
    return { ok: true, status: 200, json: async () => antwort };
  };
  const gesendet = [];
  let jetzt = 1e9;
  const m = neuerMelder({
    cfg: { ab: AB, intervallS: 5, maxPro10Min: 6, erledigt: true, ...cfgPlus },
    projekt: 'P', sb: { url: 'http://sb', key: 'k', fetchImpl }, zustand,
    senden: senden ?? (async (t) => (gesendet.push(t), `id${gesendet.length}`)),
    log: (...a) => log.push(a.join(' ')), jetzt: () => jetzt, schlafen: async (ms) => { jetzt += ms; },
  });
  return { m, log, anfragen, gesendet, zustand };
}

test('Melder: sendet einmal, nur lesend, merkt Nachrichten-ID', async () => {
  const t = bau({ signale: () => [sig()] });
  await t.m.tick();
  await t.m.tick();
  assert.equal(t.gesendet.length, 1);
  assert.ok(t.anfragen.every((a) => a.methode === 'GET'));
  assert.deepEqual(t.zustand.gesendeteIds, ['id1']);
  assert.equal(t.log.length, 1);
  assert.match(t.log[0], /aaaaaaaa/);
});

test('Melder: Erledigt-Folgenachricht genau einmal, abschaltbar', async () => {
  const z = leererZustand();
  const t = bau({ signale: () => [sig()], zustand: z });
  await t.m.tick();
  assert.equal(t.gesendet.length, 1);
  const t2 = bau({ signale: () => [], geloest: [sig({ status: 'geloest' })], zustand: z });
  await t2.m.tick();
  await t2.m.tick();
  assert.equal(t2.gesendet.length, 1);
  assert.match(t2.gesendet[0], /^✅ SiteTwin: erledigt/);
  const z2 = leererZustand();
  z2.gewarnt['aaaaaaaa-1111'] = { gesendet: true, erledigt: false };
  const t3 = bau({ signale: () => [], geloest: [sig({ status: 'geloest' })], zustand: z2, cfgPlus: { erledigt: false } });
  await t3.m.tick();
  assert.equal(t3.gesendet.length, 0);
});

test('Auswahl: wieder geoeffnet zaehlt, Aenderung an einem gewarnten offenen Signal nicht', () => {
  const z = leererZustand();
  z.gewarnt.zu = { gesendet: true, erledigt: true };
  z.gewarnt.laeuft = { gesendet: true, erledigt: false };
  const gestern = '2026-11-13T10:00:00Z';
  const neu = '2026-11-14T11:00:00Z';
  const liste = [
    sig({ id: 'zu', aktualisiert_am: neu }), // Erledigt-Meldung kam schon, jetzt wieder offen
    sig({ id: 'laeuft', aktualisiert_am: neu }), // gewarnt und noch offen: nur ergaenzt
    sig({ id: 'altwieder', erstellt_am: gestern, aktualisiert_am: neu }), // vor dem Start angelegt, jetzt wieder geoeffnet
    sig({ id: 'altstill', erstellt_am: gestern, aktualisiert_am: gestern }),
  ];
  assert.deepEqual(waehleNeue(liste, { ab: AB, zustand: z, projekt: 'P' }).map((s) => s.id), ['zu', 'altwieder']);
});

test('Text: wieder offen steht vor dem Titel', () => {
  assert.match(baueText(sig(), 700, { wieder: true }), /\nWieder offen: Plan Index B veraltet\n/);
  assert.doesNotMatch(baueText(sig()), /Wieder offen/);
});

test('Melder: wieder geoeffnetes Signal wird erneut gewarnt, genau einmal', async () => {
  let offen = [sig()];
  const geloest = [];
  const t = bau({ signale: () => offen, geloest });
  await t.m.tick(); // Warnung
  offen = [];
  geloest.push(sig({ status: 'geloest' }));
  await t.m.tick(); // Erledigt
  geloest.length = 0;
  offen = [sig({ aktualisiert_am: '2026-11-14T11:00:00Z' })];
  await t.m.tick(); // wieder offen
  await t.m.tick(); // nichts Neues
  assert.equal(t.gesendet.length, 3);
  assert.match(t.gesendet[1], /^✅ SiteTwin: erledigt/);
  assert.match(t.gesendet[2], /Wieder offen: Plan Index B veraltet/);
  assert.equal(t.zustand.gewarnt['aaaaaaaa-1111'].zyklus, 1);
  // zweite Runde: wieder geloest, wieder gemeldet
  offen = [];
  geloest.push(sig({ status: 'geloest' }));
  await t.m.tick();
  assert.equal(t.gesendet.length, 4);
  assert.match(t.gesendet[3], /^✅ SiteTwin: erledigt/);
});

test('Melder: ohne Erledigt-Meldung warnt ein wieder geoeffnetes Signal trotzdem neu', async () => {
  let offen = [sig()];
  const geloest = [];
  const t = bau({ signale: () => offen, geloest, cfgPlus: { erledigt: false } });
  await t.m.tick();
  offen = [];
  geloest.push(sig({ status: 'geloest' }));
  await t.m.tick(); // keine Nachricht, Zyklus wird geschlossen
  assert.equal(t.gesendet.length, 1);
  geloest.length = 0;
  offen = [sig({ aktualisiert_am: '2026-11-14T11:00:00Z' })];
  await t.m.tick();
  assert.equal(t.gesendet.length, 2);
  assert.match(t.gesendet[1], /Wieder offen/);
});

test('Melder: Fehler wird hoechstens 3 Mal wiederholt', async () => {
  let n = 0;
  const t = bau({ signale: () => [sig()], senden: async () => { n++; throw new Error('weg'); } });
  for (let i = 0; i < 8; i++) await t.m.tick();
  assert.equal(n, 4); // 1 + 3 Wiederholungen
});

test('Melder: Abruffehler wirft nicht', async () => {
  const log = [];
  const m = neuerMelder({
    cfg: { ab: AB, intervallS: 5, maxPro10Min: 6, erledigt: true }, projekt: 'P',
    sb: { url: 'http://sb', key: 'k', fetchImpl: async () => ({ ok: false, status: 500 }) },
    zustand: leererZustand(), senden: async () => 'x', log: (...a) => log.push(a.join(' ')),
  });
  await m.tick();
  assert.match(log[0], /Abruf fehlgeschlagen/);
});

test('Rate-Limit: Abstand und Obergrenze', () => {
  const l = neuesLimit({ abstandMs: 3000, max: 2, fensterMs: 600000 });
  assert.equal(l.pruefe(0).art, 'ok');
  l.vermerke(0);
  assert.deepEqual(l.pruefe(1000), { art: 'warten', ms: 2000 });
  l.vermerke(3000);
  assert.equal(l.pruefe(7000).art, 'voll');
  assert.equal(l.pruefe(600001).art, 'ok');
});

test('Melder: mehr als WARN_MAX_PRO_10MIN werden verworfen, nicht nachgeschickt', async () => {
  const liste = [1, 2, 3, 4].map((i) => sig({ id: `s${i}` }));
  const t = bau({ signale: () => liste, cfgPlus: { maxPro10Min: 2 } });
  await t.m.tick();
  await t.m.tick();
  assert.equal(t.gesendet.length, 2);
  assert.equal(t.log.filter((l) => /verworfen/.test(l)).length, 2);
});

// ---- Schleifenschutz ----
const nachricht = (id, text, fromMe = true) => ({
  key: { id, remoteJid: '1@g.us', fromMe }, messageTimestamp: 1, message: { conversation: text },
});

test('Schleifenschutz: gesendete IDs und Praefixe werden uebersprungen, normale eigene Nachrichten nicht', () => {
  const z = leererZustand();
  merkeGesendet(z, 'GESENDET1');
  assert.equal(istMelderNachricht(nachricht('GESENDET1', 'egal'), z), true);
  assert.equal(istMelderNachricht(nachricht('X', `${PRAEFIX_WARNUNG}\nIrgendwas`), z), true);
  assert.equal(istMelderNachricht(nachricht('Y', '⚠ SiteTwin-Warnung (automatisch)\nohne Variantenselektor'), z), true);
  assert.equal(istMelderNachricht(nachricht('Z', '✅ SiteTwin: erledigt – x'), z), true);
  assert.equal(istMelderNachricht({ key: { id: 'C' }, message: { extendedTextMessage: { text: '⚠️ SiteTwin-Warnung (automatisch) x' } } }, z), true);
  const normal = nachricht('N', 'Wand im Bad ist zu', true);
  assert.equal(istMelderNachricht(normal, z), false);
  assert.ok(baueAnfrage(normal, { kanal: 'k', projekt: 'P' }), 'normale eigene Nachricht wird weiterhin gebaut');
});

test('Zustand: gesendete IDs sind begrenzt', () => {
  const z = leererZustand();
  for (let i = 0; i < 600; i++) merkeGesendet(z, `i${i}`);
  assert.equal(z.gesendeteIds.length, 500);
  assert.equal(z.gesendeteIds.at(-1), 'i599');
});

// ---- Konfiguration ----
test('Melder ist standardmaessig aus', () => {
  const c = konfig({ WHATSAPP_CHATS: 'Gruppe A' });
  assert.equal(c.warnen.an, false);
  assert.equal(c.warnen.fehler, null);
  assert.equal(warnKonfig({ WHATSAPP_WARNEN: '0', WHATSAPP_WARN_CHAT: 'Gruppe A' }, parseAllowlist('Gruppe A')).an, false);
});

test('Melder: Standardwerte und Startzeit als Untergrenze', () => {
  const jetzt = new Date('2026-11-14T12:00:00Z');
  const k = warnKonfig({ WHATSAPP_WARNEN: '1', WHATSAPP_WARN_CHAT: 'gruppe a' }, parseAllowlist('Gruppe A'), jetzt);
  assert.equal(k.fehler, null);
  assert.equal(k.intervallS, 5);
  assert.equal(k.maxPro10Min, 6);
  assert.equal(k.erledigt, true);
  assert.equal(k.ab.getTime(), jetzt.getTime());
  const mitAb = warnKonfig({ WHATSAPP_WARNEN: '1', WHATSAPP_WARN_CHAT: 'gruppe a', WHATSAPP_WARN_AB: '2026-11-01T00:00:00Z' }, parseAllowlist('Gruppe A'));
  assert.equal(mitAb.ab.toISOString(), '2026-11-01T00:00:00.000Z');
});

test('Melder startet nicht, wenn der Warn-Chat nicht auf der Allowlist steht', () => {
  const al = parseAllowlist('Gruppe A, 111-222@g.us');
  assert.match(warnKonfig({ WHATSAPP_WARNEN: '1', WHATSAPP_WARN_CHAT: 'Gruppe B' }, al).fehler, /nicht in WHATSAPP_CHATS/);
  assert.match(warnKonfig({ WHATSAPP_WARNEN: '1', WHATSAPP_WARN_CHAT: '999-888@g.us' }, al).fehler, /nicht in WHATSAPP_CHATS/);
  assert.match(warnKonfig({ WHATSAPP_WARNEN: '1', WHATSAPP_WARN_CHAT: '' }, al).fehler, /leer/);
  assert.match(warnKonfig({ WHATSAPP_WARNEN: '1', WHATSAPP_WARN_CHAT: 'Gruppe A' }, parseAllowlist('')).fehler, /nicht in WHATSAPP_CHATS/);
  assert.equal(warnKonfig({ WHATSAPP_WARNEN: '1', WHATSAPP_WARN_CHAT: '111-222@g.us' }, al).fehler, null);
  assert.match(warnKonfig({ WHATSAPP_WARNEN: '1', WHATSAPP_WARN_CHAT: 'Gruppe A', WHATSAPP_WARN_AB: 'quatsch' }, al).fehler, /WARN_AB/);
});
