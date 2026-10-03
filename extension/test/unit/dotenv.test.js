'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHost } = require('../helpers/host');

const { parseDotenv } = createHost().ext;
const parse = text => Object.fromEntries(parseDotenv(text).map(v => [v.key, v.value]));

test('parses plain KEY=value lines', () => {
  assert.deepEqual(parseDotenv('DB_HOST=localhost\nDB_PORT=5432'), [
    { key: 'DB_HOST', value: 'localhost' },
    { key: 'DB_PORT', value: '5432' },
  ]);
});

test('accepts an "export " prefix in any case', () => {
  assert.deepEqual(parse('export A=1\nEXPORT B=2'), { A: '1', B: '2' });
});

test('ignores blank lines, comments and lines without "="', () => {
  assert.deepEqual(parse('# comment\n\n   \nnot a variable\nA=1'), { A: '1' });
});

test('skips keys that are not valid identifiers', () => {
  assert.deepEqual(parse('1ABC=x\nA-B=y\nA.B=z\n_OK=1\nOk_2=2'), { _OK: '1', Ok_2: '2' });
});

test('keeps "=" characters inside the value', () => {
  assert.deepEqual(parse('URL=postgres://u:p@h/db?a=b&c=d'), { URL: 'postgres://u:p@h/db?a=b&c=d' });
});

test('allows an empty value', () => {
  assert.deepEqual(parse('EMPTY='), { EMPTY: '' });
});

test('trims whitespace around key and unquoted value', () => {
  assert.deepEqual(parse('  A  =   hello world   '), { A: 'hello world' });
});

test('strips a trailing comment from an unquoted value', () => {
  assert.deepEqual(parse('A=1 # the answer'), { A: '1' });
});

test('keeps "#" inside a quoted value', () => {
  assert.deepEqual(parse('A="x # y"\nB=\'p # q\''), { A: 'x # y', B: 'p # q' });
});

test('removes surrounding quotes', () => {
  assert.deepEqual(parse('A="double"\nB=\'single\''), { A: 'double', B: 'single' });
});

test('expands \\n in double quotes but not in single quotes', () => {
  assert.deepEqual(parse('A="one\\ntwo"\nB=\'one\\ntwo\''), { A: 'one\ntwo', B: 'one\\ntwo' });
});

test('reads a quoted value that spans several lines', () => {
  const pem = 'KEY="-----BEGIN-----\nabc\ndef\n-----END-----"\nAFTER=1';
  assert.deepEqual(parse(pem), { KEY: '-----BEGIN-----\nabc\ndef\n-----END-----', AFTER: '1' });
});

test('does not treat lines inside a multi-line value as variables', () => {
  assert.deepEqual(parseDotenv('A="first\nB=not-a-var\nlast"').length, 1);
});

test('handles Windows line endings', () => {
  assert.deepEqual(parse('A=1\r\nB=2\r\n'), { A: '1', B: '2' });
});

test('returns repeated keys in order so the caller decides which wins', () => {
  assert.deepEqual(parseDotenv('A=1\nA=2').map(v => v.value), ['1', '2']);
});

test('returns nothing for empty input', () => {
  assert.deepEqual(parseDotenv(''), []);
});
