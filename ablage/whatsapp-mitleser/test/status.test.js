// Der Melder warnt auch bei Signalen, die schon "in_bearbeitung" sind (z. B. weil ein
// Telefon-Agent den Status gesetzt hat, bevor der Melder abgefragt hat). Geloeste nie.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leererZustand, waehleNeue } from '../melder.js';

const basis = { projekt: 'P', erstellt_am: '2026-11-14T10:00:00Z', titel: 'Wand zu vor Installation' };
const ab = new Date('2026-11-14T09:00:00Z');

test('waehleNeue: offen und in_bearbeitung werden gewarnt, geloest nicht', () => {
  const signale = [
    { ...basis, id: 'a', status: 'offen' },
    { ...basis, id: 'b', status: 'in_bearbeitung' },
    { ...basis, id: 'c', status: 'geloest' },
  ];
  const neu = waehleNeue(signale, { ab, zustand: leererZustand(), projekt: 'P' });
  assert.deepEqual(neu.map((s) => s.id).sort(), ['a', 'b']);
});
