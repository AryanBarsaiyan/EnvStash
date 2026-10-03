'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHost } = require('../helpers/host');

const { detectShell } = createHost().ext;
const byName = name => detectShell({ name, creationOptions: {} });
const byPath = shellPath => detectShell({ name: 'Terminal', creationOptions: { shellPath } });

// The last-resort guess depends on the machine, so pin it for the duration of a test
function withPlatform(platform, shell, fn) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalShell = process.env.SHELL;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  if (shell === undefined) delete process.env.SHELL; else process.env.SHELL = shell;
  try { return fn(); } finally {
    Object.defineProperty(process, 'platform', original);
    if (originalShell === undefined) delete process.env.SHELL; else process.env.SHELL = originalShell;
  }
}

test('recognises shells from the terminal name', () => {
  assert.equal(byName('PowerShell'), 'pwsh');
  assert.equal(byName('pwsh'), 'pwsh');
  assert.equal(byName('Windows PowerShell'), 'pwsh');
  assert.equal(byName('cmd'), 'cmd');
  assert.equal(byName('Command Prompt'), 'cmd');
  assert.equal(byName('bash'), 'bash');
  assert.equal(byName('Git Bash'), 'bash');
  assert.equal(byName('zsh'), 'bash');
  assert.equal(byName('fish'), 'bash');
  assert.equal(byName('sh'), 'bash');
});

test('recognises shells from the executable path', () => {
  assert.equal(byPath('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'), 'pwsh');
  assert.equal(byPath('C:\\Program Files\\PowerShell\\7\\pwsh.exe'), 'pwsh');
  assert.equal(byPath('C:\\Windows\\System32\\cmd.exe'), 'cmd');
  assert.equal(byPath('C:\\Program Files\\Git\\bin\\bash.exe'), 'bash');
  assert.equal(byPath('/bin/zsh'), 'bash');
  assert.equal(byPath('/usr/bin/fish'), 'bash');
});

test('the name wins over the path', () => {
  assert.equal(detectShell({ name: 'PowerShell', creationOptions: { shellPath: '/bin/bash' } }), 'pwsh');
});

test('a name merely containing "sh" is not mistaken for a POSIX shell', () => {
  // regression: the extension's own "EnvStash" terminal used to be detected as bash on Windows
  withPlatform('win32', undefined, () => {
    assert.equal(byName('EnvStash'), 'pwsh');
    assert.equal(byName('Dashboard'), 'pwsh');
  });
});

test('a folder containing "sh" in the path is not mistaken for a POSIX shell', () => {
  assert.equal(byPath('C:\\Users\\ashish\\tools\\cmd.exe'), 'cmd');
  assert.equal(byPath('C:\\shells\\pwsh.exe'), 'pwsh');
});

test('falls back to the platform default when nothing identifies the shell', () => {
  withPlatform('win32', undefined, () => assert.equal(byName('Terminal'), 'pwsh'));
  withPlatform('win32', '/usr/bin/bash', () => assert.equal(byName('Terminal'), 'bash'));
  withPlatform('linux', undefined, () => assert.equal(byName('Terminal'), 'bash'));
  withPlatform('darwin', '/bin/zsh', () => assert.equal(byName('Terminal'), 'bash'));
});

test('copes with a terminal that has no creation options', () => {
  withPlatform('linux', undefined, () => assert.equal(detectShell({ name: 'Terminal' }), 'bash'));
});
