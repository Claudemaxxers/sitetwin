// The notifier also warns about signals that are already "in_bearbeitung" (e.g. because a
// phone agent set the status before the notifier polled). Never about resolved ones.
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
