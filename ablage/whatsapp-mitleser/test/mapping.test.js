import test from 'node:test';
import assert from 'node:assert/strict';
import { baueAnfrage, inhalt, istErlaubt, kanalName, parseAllowlist } from '../mapping.js';
import * as f from './fixtures.js';

const opt = { kanal: 'Testgruppe', projekt: 'Test Santino', eigeneJid: f.EIGENE_JID, eigenerName: 'Test Ich' };
const ISO = '2026-11-14T08:00:00.000Z';

test('Gruppentext', () => {
  const b = baueAnfrage(f.gruppeText, opt);
  assert.deepEqual(b, {
    absender: 'Test Polier (+4300000000001)',
    zeitpunkt: ISO,
    text: 'Wand Top 5 ist gesetzt (fiktiv)',
    wa_id: 'AAA1',
    projekt: 'Test Santino',
    kanal: 'Testgruppe',
  });
});

test('erweiterter Text, Zeit als Long-artiges Objekt', () => {
  const b = baueAnfrage(f.erweiterterText, opt);
  assert.equal(b.text, 'Siehe https://example.com/plan');
  assert.equal(b.zeitpunkt, ISO);
});

test('Bild mit Beschriftung: Text ist die Beschriftung, Anhang kommt vom Aufrufer', () => {
  const i = inhalt(f.bildMitBeschriftung);
  assert.equal(i.art, 'bild');
  assert.equal(i.medium.dateiname, 'AAA3.jpg');
  assert.equal(i.medium.mimetype, 'image/jpeg');
  const b = baueAnfrage(f.bildMitBeschriftung, { ...opt, anhang: { ...i.medium, base64: 'AAAA' } });
  assert.equal(b.text, 'Steckdose Wand 5');
  assert.deepEqual(b.anhang, { dateiname: 'AAA3.jpg', mimetype: 'image/jpeg', base64: 'AAAA' });
  assert.equal(b.zeitpunkt, ISO);
});

test('Sprachnachricht: .ogg, Mimetype ohne Parameter, leerer Text', () => {
  const i = inhalt(f.sprachnachricht);
  assert.equal(i.art, 'audio');
  assert.equal(i.medium.sprachnachricht, true);
  assert.equal(i.medium.mimetype, 'audio/ogg');
  assert.equal(i.medium.dateiname, 'AAA4.ogg');
  const b = baueAnfrage(f.sprachnachricht, { ...opt, anhang: { ...i.medium, base64: 'AAAA' } });
  assert.equal(b.text, '');
  assert.equal(b.anhang.mimetype, 'audio/ogg');
});

test('Dokument mit Beschriftung im Wrapper behaelt den Dateinamen', () => {
  const i = inhalt(f.dokument);
  assert.equal(i.art, 'dokument');
  assert.equal(i.text, 'Neuer Plan');
  assert.equal(i.medium.dateiname, 'Plan_Rev_C.pdf');
});

test('eigene Nachricht (fromMe, fluechtig) wird weitergereicht, Absender aus eigenem Profil', () => {
  const b = baueAnfrage(f.eigeneNachricht, opt);
  assert.equal(b.text, 'Testnachricht von mir (fiktiv)');
  assert.equal(b.absender, 'Test Ich (+4300000000099)');
});

test('LID-Absender: Nummer kommt aus participantAlt', () => {
  assert.equal(baueAnfrage(f.lidAbsender, opt).absender, 'Test Bauleiter (+4300000000002)');
});

test('ohne Namen und Nummer: Platzhalter, nie leer', () => {
  const m = { key: { remoteJid: f.GRUPPE, id: 'X', participant: '1@lid' }, messageTimestamp: 1, message: { conversation: 'a' } };
  assert.equal(baueAnfrage(m, {}).absender, 'Unbekannt');
});

test('Reaktion, Protokoll, Status, Sticker werden ignoriert', () => {
  for (const m of [f.reaktion, f.protokoll, f.status, f.sticker]) {
    assert.equal(inhalt(m).art, 'ignoriert');
    assert.equal(baueAnfrage(m, opt), null);
  }
});

test('Einzelchat: Kanal ist der Name des Gegenuebers', () => {
  assert.equal(kanalName(f.einzelchat), 'Test Kollege');
  assert.equal(kanalName(f.gruppeText, 'Testgruppe'), 'Testgruppe');
});

test('Pflichtfelder der Ablage sind immer gesetzt', () => {
  for (const m of [f.gruppeText, f.erweiterterText, f.eigeneNachricht, f.einzelchat]) {
    const b = baueAnfrage(m, opt);
    assert.ok(b.absender && b.zeitpunkt && b.wa_id);
    assert.ok(!Number.isNaN(Date.parse(b.zeitpunkt)));
  }
});

test('Allowlist: leer erlaubt nichts', () => {
  const a = parseAllowlist('');
  assert.equal(a.leer, true);
  assert.equal(istErlaubt(a, { jid: f.GRUPPE, gruppenname: 'Testgruppe' }), false);
  assert.equal(parseAllowlist(' , ,').leer, true);
});

test('Allowlist: Name exakt, ohne Gross/Klein, Leerzeichen am Rand egal', () => {
  const a = parseAllowlist(' testGRUPPE , Zweite Gruppe');
  assert.equal(istErlaubt(a, { jid: f.GRUPPE, gruppenname: 'Testgruppe' }), true);
  assert.equal(istErlaubt(a, { jid: 'x@g.us', gruppenname: 'Zweite Gruppe ' }), true);
  assert.equal(istErlaubt(a, { jid: 'x@g.us', gruppenname: 'Testgruppe 2' }), false);
  assert.equal(istErlaubt(a, { jid: 'x@g.us', gruppenname: 'Test' }), false);
});

test('Allowlist: Gruppen-JID, Nummer fuer Einzelchat, JID-Alternative', () => {
  const a = parseAllowlist(`${f.GRUPPE}, +4300000000003`);
  assert.equal(istErlaubt(a, { jid: f.GRUPPE }), true);
  assert.equal(istErlaubt(a, { jid: '999@lid', jidAlt: '4300000000003@s.whatsapp.net' }), true);
  assert.equal(istErlaubt(a, { jid: f.fremdeGruppe.key.remoteJid }), false);
});

test('Allowlist: Nachricht aus fremder Gruppe wird abgelehnt, unbekannter Gruppenname ebenso', () => {
  const a = parseAllowlist('Testgruppe');
  assert.equal(istErlaubt(a, { jid: f.fremdeGruppe.key.remoteJid, gruppenname: 'Andere' }), false);
  assert.equal(istErlaubt(a, { jid: f.fremdeGruppe.key.remoteJid, gruppenname: undefined }), false);
});
