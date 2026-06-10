import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch } from '../../src/jsonpatch.js';

test('replace nested value', () => {
  const doc = { a: { b: 1 } };
  const out = applyPatch(doc, [{ op: 'replace', path: '/a/b', value: 2 }]);
  assert.equal(out.a.b, 2);
});

test('add to object and to array', () => {
  const doc = { obj: {}, arr: [1, 3] };
  applyPatch(doc, [
    { op: 'add', path: '/obj/x', value: 'y' },
    { op: 'add', path: '/arr/1', value: 2 },
    { op: 'add', path: '/arr/-', value: 4 },
  ]);
  assert.equal(doc.obj.x, 'y');
  assert.deepEqual(doc.arr, [1, 2, 3, 4]);
});

test('remove from object and array', () => {
  const doc = { a: 1, arr: [1, 2, 3] };
  applyPatch(doc, [
    { op: 'remove', path: '/a' },
    { op: 'remove', path: '/arr/1' },
  ]);
  assert.equal('a' in doc, false);
  assert.deepEqual(doc.arr, [1, 3]);
});

test('move and copy', () => {
  const doc = { a: { v: 42 }, b: {} };
  applyPatch(doc, [{ op: 'copy', from: '/a/v', path: '/b/v' }]);
  assert.equal(doc.b.v, 42);
  applyPatch(doc, [{ op: 'move', from: '/b/v', path: '/b/w' }]);
  assert.equal(doc.b.w, 42);
  assert.equal('v' in doc.b, false);
});

test('replace the whole document', () => {
  const out = applyPatch({ old: true }, [{ op: 'replace', path: '', value: { fresh: 1 } }]);
  assert.deepEqual(out, { fresh: 1 });
});

test('escaped pointer tokens (~0 and ~1)', () => {
  const doc = { 'a/b': { 'c~d': 1 } };
  applyPatch(doc, [{ op: 'replace', path: '/a~1b/c~0d', value: 9 }]);
  assert.equal(doc['a/b']['c~d'], 9);
});

test('unknown op throws', () => {
  assert.throws(() => applyPatch({}, [{ op: 'explode', path: '/x' }]));
});
