'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { encryptBundle, decryptBundle } = require('../../out/services/backupCrypto');
const PASS = 'correct horse battery';
const flip = b64 => { const b = Buffer.from(b64, 'base64'); b[0] ^= 1; return b.toString('base64'); };

test('round-trips text, including unicode and newlines', async () => {
  const plain = JSON.stringify({ note: 'héllo ✓ 日本語\nline two', key: 's3cret' });
  assert.equal(await decryptBundle(await encryptBundle(plain, PASS), PASS), plain);
});

test('output is a self-describing envelope that hides the content', async () => {
  const enc = await encryptBundle('{"API_KEY":"s3cret"}', PASS);
  assert.equal(enc.format, 'envstash-encrypted');
  assert.equal(enc.v, 1);
  assert.equal(enc.kdf.name, 'scrypt');
  assert.equal(enc.cipher.name, 'aes-256-gcm');
  const text = JSON.stringify(enc);
  assert.ok(!text.includes('s3cret') && !text.includes('API_KEY'));
});

test('uses a fresh salt and IV every time', async () => {
  const [a, b] = await Promise.all([encryptBundle('same', PASS), encryptBundle('same', PASS)]);
  assert.notEqual(a.kdf.salt, b.kdf.salt);
  assert.notEqual(a.cipher.iv, b.cipher.iv);
  assert.notEqual(a.data, b.data);
});

test('rejects a wrong passphrase', async () => {
  const enc = await encryptBundle('secret', PASS);
  await assert.rejects(decryptBundle(enc, 'wrong passphrase'), /Wrong passphrase or corrupted/);
});

test('treats composed and decomposed unicode passphrases as the same', async () => {
  const enc = await encryptBundle('secret', 'café-passphrase');
  assert.equal(await decryptBundle(enc, 'café-passphrase'), 'secret');
});

for (const [what, tamper] of [
  ['data', enc => { enc.data = flip(enc.data); }],
  ['auth tag', enc => { enc.cipher.tag = flip(enc.cipher.tag); }],
  ['IV', enc => { enc.cipher.iv = flip(enc.cipher.iv); }],
  ['salt', enc => { enc.kdf.salt = flip(enc.kdf.salt); }],
]) {
  test(`detects a modified ${what}`, async () => {
    const enc = await encryptBundle('secret', PASS);
    tamper(enc);
    await assert.rejects(decryptBundle(enc, PASS), /Wrong passphrase or corrupted/);
  });
}

for (const [what, change] of [
  ['an unknown version', enc => { enc.v = 2; }],
  ['an unknown KDF', enc => { enc.kdf.name = 'pbkdf2'; }],
  ['an unknown cipher', enc => { enc.cipher.name = 'aes-256-cbc'; }],
  ['a huge cost parameter', enc => { enc.kdf.N = 1 << 24; }],
  ['a weak cost parameter', enc => { enc.kdf.N = 1024; }],
  ['a cost parameter that is not a power of two', enc => { enc.kdf.N = 40000; }],
  ['unexpected r', enc => { enc.kdf.r = 64; }],
  ['unexpected p', enc => { enc.kdf.p = 16; }],
  ['a missing kdf block', enc => { delete enc.kdf; }],
]) {
  test(`refuses ${what} without trying to decrypt`, async () => {
    const enc = await encryptBundle('secret', PASS);
    change(enc);
    await assert.rejects(decryptBundle(enc, PASS), /Unsupported encrypted backup format/);
  });
}
