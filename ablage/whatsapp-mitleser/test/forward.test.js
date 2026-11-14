import test from 'node:test';
import assert from 'node:assert/strict';
import { endpunkt, sende } from '../forward.js';
import { konfig } from '../config.js';

const antwort = (status, json = {}) => ({ ok: status < 300, status, json: async () => json });

test('Endpunkt-URL', () => {
  assert.equal(endpunkt('http://localhost:8000/'), 'http://localhost:8000/import/whatsapp/nachricht');
});

test('Erfolg beim ersten Versuch', async () => {
  let aufrufe = 0;
  const r = await sende('http://x', { a: 1 }, { fetchImpl: async () => (aufrufe++, antwort(200, { neu: 1 })), wartezeiten: [0] });
  assert.deepEqual(r, { ok: true, antwort: { neu: 1 } });
  assert.equal(aufrufe, 1);
});

test('5xx und Netzfehler werden wiederholt', async () => {
  const folge = [() => antwort(502), () => { throw new Error('kaputt'); }, () => antwort(200, { neu: 0, duplikate: 1 })];
  let n = 0;
  const r = await sende('http://x', {}, { fetchImpl: async () => folge[n++](), wartezeiten: [0, 0, 0] });
  assert.equal(r.ok, true);
  assert.equal(n, 3);
});

test('4xx wird nicht wiederholt', async () => {
  let n = 0;
  const r = await sende('http://x', {}, { fetchImpl: async () => (n++, antwort(422)), wartezeiten: [0, 0] });
  assert.equal(r.ok, false);
  assert.equal(r.fehler, 'HTTP 422');
  assert.equal(n, 1);
});

test('nach allen Versuchen Fehler statt Exception', async () => {
  let n = 0;
  const r = await sende('http://x', {}, { fetchImpl: async () => (n++, antwort(500)), wartezeiten: [0, 0] });
  assert.equal(r.ok, false);
  assert.equal(n, 3);
});

test('Konfiguration: Defaults und Allowlist', () => {
  const c = konfig({});
  assert.equal(c.ablageUrl, 'http://localhost:8000');
  assert.equal(c.projekt, 'Test Santino');
  assert.equal(c.allowlist.leer, true);
  assert.equal(c.nummer, null);
  const d = konfig({ WHATSAPP_CHATS: 'A, B', WHATSAPP_NUMMER: '+43 000 0000', WHATSAPP_MAX_MB: '5' });
  assert.equal(d.allowlist.namen.size, 2);
  assert.equal(d.nummer, '430000000');
  assert.equal(d.maxBytes, 5 * 1024 * 1024);
});
