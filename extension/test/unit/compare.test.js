'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { diffVars } = require('../../out/services/compare');
const vars = pairs => pairs.map(([key, value], i) => ({ id: 'v' + i, key, value }));

test('classifies every key as same, different, or only on one side', () => {
  const rows = diffVars(
    vars([['SAME', 'x'], ['CHANGED', 'left'], ['MINE', 'm']]),
    vars([['SAME', 'x'], ['CHANGED', 'right'], ['THEIRS', 't']]),
  );
  assert.deepEqual(rows, [
    { key: 'SAME', status: 'same', left: 'x', right: 'x' },
    { key: 'CHANGED', status: 'different', left: 'left', right: 'right' },
    { key: 'MINE', status: 'onlyLeft', left: 'm' },
    { key: 'THEIRS', status: 'onlyRight', right: 't' },
  ]);
});

test('follows the left order, then the right-only keys in their own order', () => {
  const rows = diffVars(vars([['C', '1'], ['A', '1']]), vars([['Z', '1'], ['A', '1'], ['B', '1']]));
  assert.deepEqual(rows.map(r => r.key), ['C', 'A', 'Z', 'B']);
});

test('an empty value is a value: it differs from a missing key and from a non-empty one', () => {
  const rows = diffVars(vars([['A', ''], ['B', '']]), vars([['B', 'x']]));
  assert.deepEqual(rows, [
    { key: 'A', status: 'onlyLeft', left: '' },
    { key: 'B', status: 'different', left: '', right: 'x' },
  ]);
});

test('compares values exactly: case and whitespace count', () => {
  const rows = diffVars(vars([['A', 'Value'], ['B', 'x ']]), vars([['A', 'value'], ['B', 'x']]));
  assert.deepEqual(rows.map(r => r.status), ['different', 'different']);
});

test('keys are case-sensitive, as they are in a shell', () => {
  const rows = diffVars(vars([['Path', '1']]), vars([['PATH', '1']]));
  assert.deepEqual(rows.map(r => [r.key, r.status]), [['Path', 'onlyLeft'], ['PATH', 'onlyRight']]);
});

test('handles empty lists on either side', () => {
  assert.deepEqual(diffVars([], []), []);
  assert.deepEqual(diffVars(vars([['A', '1']]), []), [{ key: 'A', status: 'onlyLeft', left: '1' }]);
  assert.deepEqual(diffVars([], vars([['A', '1']])), [{ key: 'A', status: 'onlyRight', right: '1' }]);
});

test('a key repeated within one list is reported once, using its first value', () => {
  const rows = diffVars(vars([['A', 'first'], ['A', 'second']]), vars([['A', 'first'], ['A', 'other']]));
  assert.deepEqual(rows, [{ key: 'A', status: 'same', left: 'first', right: 'first' }]);
});
