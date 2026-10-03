'use strict';
// Feature tests for the panel: the real webview page in jsdom, talking to the real extension code.
// Each test acts like a user (click, type) and checks both what is on screen and what was stored.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createHost, sleep } = require('../helpers/host');
const { openPanel } = require('../helpers/panel');

/** A panel that is always closed, and that fails the test if the page threw an error. */
function newPanel(t, host) {
  const panel = openPanel(host);
  t.after(async () => {
    await panel.close();
    assert.deepEqual(panel.errors.map(e => e.message), [], 'the page raised script errors');
  });
  return panel;
}

/** A panel already inside an environment of a seeded project. */
async function inEnv(t, { vars = [], settings } = {}) {
  const host = createHost({ settings });
  const ids = await host.seed('api', 'dev', vars);
  const panel = newPanel(t, host);
  await panel.click('.proj-row');
  await panel.openEnv('dev');
  return { panel, host, ids };
}

describe('projects screen', () => {
  test('starts empty and creates a project through the dialog', async t => {
    const panel = newPanel(t);
    assert.equal(panel.text('.empty-h'), 'No projects yet');

    await panel.createProject('my-api');

    assert.deepEqual(panel.$$('.proj-name').map(el => el.textContent), ['my-api']);
    assert.deepEqual(panel.host.index().projects.map(p => p.name), ['my-api']);
    assert.ok(!panel.$('#projModal').classList.contains('open'), 'dialog closes after saving');
  });

  test('an empty project name is refused with a message and the dialog stays open', async t => {
    const panel = newPanel(t);
    await panel.click('#projList .dashed-btn');
    await panel.click('#projModal .btn-primary');
    assert.match(panel.text('#toast'), /Project name cannot be empty/);
    assert.ok(panel.$('#projModal').classList.contains('open'));
    assert.equal(panel.host.index().projects.length, 0);
  });

  test('shows projects that already exist when the panel opens', async t => {
    const host = createHost();
    await host.seed('existing', 'dev');
    const panel = newPanel(t, host);
    assert.deepEqual(panel.$$('.proj-name').map(el => el.textContent), ['existing']);
  });

  test('renames a project, pre-filling its current name', async t => {
    const host = createHost();
    await host.seed('old-name', 'dev');
    const panel = newPanel(t, host);

    await panel.click('.proj-acts [title="Rename"]');
    assert.equal(panel.$('#projName').value, 'old-name');
    await panel.type('#projName', 'new-name');
    await panel.click('#projModal .btn-primary');

    assert.equal(panel.text('.proj-name'), 'new-name');
    assert.equal(host.index().projects[0].name, 'new-name');
  });

  test('deleting a project asks first; cancelling keeps it', async t => {
    const host = createHost();
    await host.seed('precious', 'dev', [['A', '1']]);
    const panel = newPanel(t, host);

    await panel.click('.proj-acts [title="Delete"]');
    assert.equal(panel.text('#confMsg'), 'Delete "precious"?');
    await panel.click('#confModal .btn-ghost');
    assert.equal(host.index().projects.length, 1);

    await panel.click('.proj-acts [title="Delete"]');
    await panel.click('#confModal .btn-danger');
    assert.equal(host.index().projects.length, 0);
    assert.equal(host.secrets.size, 0);
    assert.equal(panel.text('.empty-h'), 'No projects yet');
  });

  test('the action buttons on a project row do not also expand it', async t => {
    const host = createHost();
    await host.seed('api', 'dev');
    const panel = newPanel(t, host);
    await panel.click('.proj-acts [title="Rename"]');
    await panel.click('.proj-acts');
    assert.equal(panel.$('.env-area.open'), null);
    await panel.click('.proj-row');
    assert.ok(panel.$('.env-area.open'));
  });

  test('adds, edits and deletes an environment', async t => {
    const panel = newPanel(t);
    await panel.createProject('api');
    await panel.createEnv('staging');
    assert.deepEqual(panel.host.index().projects[0].envs.map(e => e.name), ['staging']);
    assert.ok(panel.$('.env-area.open'), 'the project stays expanded so the new environment is visible');

    await panel.click('.pill-btn[title="Edit"]');
    assert.equal(panel.$('#envName').value, 'staging');
    await panel.type('#envName', 'production');
    await panel.click(panel.$$('.swatch')[1]);
    await panel.click('#envModal .btn-primary');
    const env = panel.host.index().projects[0].envs[0];
    assert.deepEqual([env.name, env.color], ['production', '#f48771']);

    await panel.click('.pill-btn[title="Delete"]');
    assert.equal(panel.text('#confMsg'), 'Delete "production"?');
    await panel.click('#confModal .btn-danger');
    assert.deepEqual(panel.host.index().projects[0].envs, []);
  });

  test('the edit and delete buttons on an environment pill do not open it', async t => {
    const host = createHost();
    await host.seed('api', 'dev');
    const panel = newPanel(t, host);
    await panel.click('.proj-row');
    await panel.click('.pill-btn[title="Edit"]');
    assert.ok(panel.$('#sProj').classList.contains('active'));
    assert.ok(!panel.$('#sEnv').classList.contains('active'));
  });

  test('Export and Import buttons reach the extension', async t => {
    const host = createHost();
    await host.seed('api', 'dev', [['A', '1']]);
    const panel = newPanel(t, host);
    host.inputs = ['long enough passphrase', 'long enough passphrase'];
    await panel.click('.topbar-btn[title^="Export"]');
    assert.equal(JSON.parse(host.files.get(host.savePath).toString()).format, 'envstash-encrypted');

    host.inputs = ['long enough passphrase'];
    await panel.click('.topbar-btn[title^="Import"]');
    assert.match(host.info.at(-1), /Imported 1 project/);
  });
});

describe('duplicating an environment', () => {
  async function withDev(t) {
    const host = createHost();
    const ids = await host.seed('api', 'dev', [['A', '1'], ['B', '2']]);
    await host.send({ type: 'saveNotes', ...ids, notes: 'dev notes' });
    const panel = newPanel(t, host);
    await panel.click('.proj-row');
    return { panel, host, ids };
  }
  const envNames = host => host.index().projects[0].envs.map(e => e.name);

  test('the Duplicate button suggests a name and creates a full copy', async t => {
    const { panel, host, ids } = await withDev(t);
    await panel.click('.pill-btn[title="Duplicate"]');
    assert.equal(panel.text('#envModalTitle'), 'Duplicate environment');
    assert.equal(panel.$('#envName').value, 'dev copy');

    await panel.type('#envName', 'staging');
    await panel.click('#envModal .btn-primary');

    assert.deepEqual(envNames(host), ['dev', 'staging']);
    const copyId = host.index().projects[0].envs[1].id;
    assert.deepEqual(host.vars(ids.projectId, copyId).map(v => [v.key, v.value]), [['A', '1'], ['B', '2']]);
    assert.equal(host.notes(ids.projectId, copyId), 'dev notes');
    assert.equal(panel.$$('.env-pill').length, 2);
  });

  test('the suggested name skips ones already taken', async t => {
    const { panel, host, ids } = await withDev(t);
    await host.send({ type: 'createEnv', projectId: ids.projectId, name: 'Dev Copy', color: '#fff' });
    await panel.settle();
    await panel.click('.pill-btn[title="Duplicate"]');
    assert.equal(panel.$('#envName').value, 'dev copy 2');
  });

  test('the copy can be given its own colour, and the original keeps its own', async t => {
    const { panel, host } = await withDev(t);
    const original = host.index().projects[0].envs[0].color;
    await panel.click('.pill-btn[title="Duplicate"]');
    await panel.click(panel.$$('.swatch')[3]);
    await panel.click('#envModal .btn-primary');
    const [dev, copy] = host.index().projects[0].envs;
    assert.equal(dev.color, original);
    assert.equal(copy.color, '#569cd6');
  });

  test('cancelling creates nothing, and the dialog then works normally for a new environment', async t => {
    const { panel, host } = await withDev(t);
    await panel.click('.pill-btn[title="Duplicate"]');
    await panel.click('#envModal .btn-ghost');
    assert.deepEqual(envNames(host), ['dev']);

    await panel.createEnv('fresh');
    assert.deepEqual(envNames(host), ['dev', 'fresh']);
    assert.deepEqual(host.vars(host.index().projects[0].id, host.index().projects[0].envs[1].id), [], 'a new environment is empty, not a copy');
  });

  test('the Duplicate button does not open the environment', async t => {
    const { panel } = await withDev(t);
    await panel.click('.pill-btn[title="Duplicate"]');
    assert.ok(panel.$('#sProj').classList.contains('active'));
  });
});

describe('comparing environments', () => {
  async function devAndProd(t, { settings } = {}) {
    const host = createHost({ settings });
    const dev = await host.seed('api', 'dev', [['SAME', 'x'], ['CHANGED', 'dev-value'], ['DEV_ONLY', 'd']]);
    await host.send({ type: 'createEnv', projectId: dev.projectId, name: 'prod', color: '#f48771' });
    const prodId = host.index().projects[0].envs[1].id;
    for (const [key, value] of [['SAME', 'x'], ['CHANGED', 'prod-value'], ['PROD_ONLY', 'p']]) {
      await host.send({ type: 'saveVar', projectId: dev.projectId, envId: prodId, var: { key, value } });
    }
    const panel = newPanel(t, host);
    await panel.click('.proj-row');
    await panel.openEnv('dev');
    return { panel, host, dev, prodId };
  }
  const rows = panel => panel.$$('.cmp-row').map(row => ({
    key: row.querySelector('.var-key').textContent,
    badge: row.querySelector('.cmp-badge').textContent,
    values: [...row.querySelectorAll('.cmp-val')].map(v => [v.querySelector('.cmp-env').textContent, v.querySelector('.cmp-v').textContent]),
    row,
  }));
  const MASK = '••••••••••';

  test('shows what differs between this environment and another, values hidden', async t => {
    const { panel } = await devAndProd(t);
    await panel.click('#cmpBtn');

    assert.ok(panel.$('#cmpModal').classList.contains('open'));
    assert.equal(panel.text('#cmpThis'), 'dev');
    assert.deepEqual(panel.$$('#cmpOther option').map(o => o.textContent), ['prod']);
    assert.equal(panel.text('#cmpSummary'), '1 different · 1 only in dev · 1 only in prod · 1 identical');
    assert.deepEqual(rows(panel).map(r => [r.key, r.badge, r.values]), [
      ['CHANGED', 'Different', [['dev', MASK], ['prod', MASK]]],
      ['DEV_ONLY', 'Only in dev', [['dev', MASK]]],
      ['PROD_ONLY', 'Only in prod', [['prod', MASK]]],
    ]);
    assert.ok(!panel.$('#cmpModal').innerHTML.includes('prod-value'), 'hidden values are not in the page');
  });

  test('"Show values" reveals both sides and "Hide values" masks them again', async t => {
    const { panel } = await devAndProd(t);
    await panel.click('#cmpBtn');
    await panel.click('#cmpShowBtn');
    assert.deepEqual(rows(panel)[0].values, [['dev', 'dev-value'], ['prod', 'prod-value']]);
    assert.equal(panel.text('#cmpShowBtn'), 'Hide values');
    await panel.click('#cmpShowBtn');
    assert.deepEqual(rows(panel)[0].values, [['dev', MASK], ['prod', MASK]]);
  });

  test('shown values hide themselves after the configured time and when the panel is hidden', async t => {
    const { panel } = await devAndProd(t, { settings: { autoHideSeconds: 0.05 } });
    await panel.click('#cmpBtn');
    await panel.click('#cmpShowBtn');
    await sleep(120);
    assert.deepEqual(rows(panel)[0].values, [['dev', MASK], ['prod', MASK]]);

    const other = await devAndProd(t);
    await other.panel.click('#cmpBtn');
    await other.panel.click('#cmpShowBtn');
    await other.panel.setHidden(true);
    assert.deepEqual(rows(other.panel)[0].values, [['dev', MASK], ['prod', MASK]]);
  });

  test('identical variables are folded away until asked for', async t => {
    const { panel } = await devAndProd(t);
    await panel.click('#cmpBtn');
    assert.ok(!rows(panel).some(r => r.key === 'SAME'));
    assert.equal(panel.text('.cmp-more'), 'Show 1 identical');
    await panel.click('.cmp-more');
    assert.deepEqual(rows(panel).find(r => r.key === 'SAME').badge, 'Same');
    assert.equal(panel.text('.cmp-more'), 'Hide 1 identical');
  });

  test('"Add to dev" copies a missing variable into this environment only', async t => {
    const { panel, host, dev, prodId } = await devAndProd(t);
    await panel.click('#cmpBtn');
    await panel.click(rows(panel).find(r => r.key === 'PROD_ONLY').row.querySelector('.cmp-add'));

    assert.deepEqual(host.vars(dev.projectId, dev.envId).map(v => [v.key, v.value]),
      [['SAME', 'x'], ['CHANGED', 'dev-value'], ['DEV_ONLY', 'd'], ['PROD_ONLY', 'p']]);
    assert.equal(host.vars(dev.projectId, prodId).length, 3, 'the other environment is untouched');
    assert.equal(panel.text('#cmpSummary'), '1 different · 1 only in dev · 2 identical');
    assert.ok(!rows(panel).some(r => r.key === 'PROD_ONLY'));
    assert.deepEqual(panel.varRows().map(r => r.key), ['SAME', 'CHANGED', 'DEV_ONLY', 'PROD_ONLY'], 'the list behind the dialog is updated too');
  });

  test('only variables missing here offer the copy button', async t => {
    const { panel } = await devAndProd(t);
    await panel.click('#cmpBtn');
    assert.deepEqual(rows(panel).filter(r => r.row.querySelector('.cmp-add')).map(r => r.key), ['PROD_ONLY']);
  });

  test('says so when two environments are identical or both empty', async t => {
    const host = createHost();
    const ids = await host.seed('api', 'dev', [['A', '1']]);
    await host.send({ type: 'duplicateEnv', ...ids, name: 'twin' });
    await host.send({ type: 'createEnv', projectId: ids.projectId, name: 'empty', color: '#fff' });
    await host.send({ type: 'createEnv', projectId: ids.projectId, name: 'empty too', color: '#fff' });
    const panel = newPanel(t, host);
    await panel.click('.proj-row');

    await panel.openEnv('dev');
    await panel.click('#cmpBtn');
    assert.equal(panel.text('#cmpSummary'), 'Identical: all 1 variable match.');
    assert.equal(rows(panel).length, 0);
    await panel.click('#cmpModal .btn-primary');

    await panel.click('.env-topbar .icon-btn');
    await panel.openEnv('empty');
    await panel.click('#cmpBtn');
    panel.$('#cmpOther').value = String(panel.$$('#cmpOther option').findIndex(o => o.textContent === 'empty too'));
    await panel.fire('#cmpOther', 'change');
    assert.equal(panel.text('#cmpSummary'), 'Both environments have no variables.');
  });

  test('can switch target, including environments of other projects', async t => {
    const { panel, host } = await devAndProd(t);
    await host.seed('web', 'dev', [['SAME', 'x'], ['WEB_ONLY', 'w']]);
    await panel.settle();
    await panel.click('#cmpBtn');
    assert.deepEqual(panel.$$('#cmpOther option').map(o => o.textContent), ['prod', 'web / dev'], 'same project first');

    panel.$('#cmpOther').value = '1';
    await panel.fire('#cmpOther', 'change');
    assert.equal(panel.text('#cmpSummary'), '2 only in dev · 1 only in web / dev · 1 identical');
    assert.deepEqual(rows(panel).map(r => r.key), ['CHANGED', 'DEV_ONLY', 'WEB_ONLY']);
  });

  test('with no other environment it explains instead of opening an empty dialog', async t => {
    const { panel } = await inEnv(t, { vars: [['A', '1']] });
    await panel.click('#cmpBtn');
    assert.match(panel.text('#toast'), /Add another environment to compare with/);
    assert.ok(!panel.$('#cmpModal').classList.contains('open'));
  });

  test('a late answer for a previous target is ignored', async t => {
    const { panel, host, dev, prodId } = await devAndProd(t);
    await panel.click('#cmpBtn');
    host.view.webview.postMessage({ type: 'compare', ...dev, otherProjectId: 'someone', otherEnvId: 'else', data: [{ key: 'STALE', status: 'onlyLeft', left: '1' }] });
    assert.ok(!rows(panel).some(r => r.key === 'STALE'));
    host.view.webview.postMessage({ type: 'compare', projectId: 'other', envId: 'env', otherProjectId: dev.projectId, otherEnvId: prodId, data: [{ key: 'STALE', status: 'onlyLeft', left: '1' }] });
    assert.ok(!rows(panel).some(r => r.key === 'STALE'));
  });

  test('the Compare button is only on the Variables tab, and Escape closes the dialog', async t => {
    const { panel } = await devAndProd(t);
    assert.ok(panel.visible('#cmpBtn'));
    await panel.click('#tNotes');
    assert.ok(!panel.visible('#cmpBtn'));
    await panel.click('#tVars');
    await panel.click('#cmpBtn');
    panel.document.dispatchEvent(new panel.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(!panel.$('#cmpModal').classList.contains('open'));
  });

  test('hostile keys and values are shown as text', async t => {
    const host = createHost();
    const ids = await host.seed('api', 'dev');
    await host.send({ type: 'createEnv', projectId: ids.projectId, name: '<b>prod</b>', color: '#fff' });
    host.files.set(host.openPath, Buffer.from(JSON.stringify({ version: '1.0.0', projects: [{ id: ids.projectId, name: 'api', envs: [
      { id: ids.envId, name: 'dev', color: '#fff', vars: [{ key: '<img src=x onerror=alert(1)>', value: '<script>alert(1)</script>' }], runbook: { stages: [] } },
    ] }] })));
    await host.send({ type: 'importFile', merge: true });
    const panel = newPanel(t, host);
    await panel.click('.proj-row');
    await panel.openEnv('dev');
    await panel.click('#cmpBtn');
    await panel.click('#cmpShowBtn');

    assert.equal(rows(panel)[0].key, '<img src=x onerror=alert(1)>');
    assert.deepEqual(rows(panel)[0].values, [['dev', '<script>alert(1)</script>']]);
    assert.equal(panel.$('#cmpModal img, #cmpModal script, #cmpModal b'), null);
    assert.equal(panel.$('#cmpOther option').textContent, '<b>prod</b>');
  });
});

describe('status bar and the panel', () => {
  test('opening an environment in the panel updates the status bar', async t => {
    const host = createHost();
    await host.seed('api', 'dev');
    const panel = newPanel(t, host);
    assert.equal(host.statusBar().text, '$(lock) EnvStash');
    await panel.click('.proj-row');
    await panel.openEnv('dev');
    assert.equal(host.statusBar().text, '$(lock) api / dev');
  });

  test('going back to the project list keeps the last environment in the status bar', async t => {
    const { panel, host } = await inEnv(t);
    await panel.click('.env-topbar .icon-btn');
    assert.equal(host.statusBar().text, '$(lock) api / dev');
  });

  test('picking from the status bar opens that environment in the open panel', async t => {
    const host = createHost();
    await host.seed('api', 'dev', [['DEV_KEY', '1']]);
    await host.seed('web', 'prod', [['PROD_KEY', '2']]);
    const panel = newPanel(t, host);
    await panel.click('.proj-row');
    await panel.openEnv('dev');
    await panel.click('#tNotes');
    await panel.type('#notesArea', 'unsaved dev note');

    host.pick = items => items.find(i => i.label === 'prod');
    await host.command('envstash.switchEnvironment');
    await panel.settle();

    assert.ok(panel.$('#sEnv').classList.contains('active'));
    assert.equal(panel.text('#envTitle'), 'prod');
    assert.deepEqual(panel.varRows().map(r => r.key), ['PROD_KEY']);
    assert.equal(host.statusBar().text, '$(lock) web / prod');
    const dev = host.index().projects[0];
    assert.equal(host.notes(dev.id, dev.envs[0].id), 'unsaved dev note', 'notes being typed are saved before switching');
  });

  test('switching from the status bar closes any open dialog first', async t => {
    const host = createHost();
    await host.seed('api', 'dev');
    const panel = newPanel(t, host);
    await panel.click('#projList .dashed-btn');
    assert.ok(panel.$('#projModal').classList.contains('open'));

    host.pick = items => items[0];
    await host.command('envstash.switchEnvironment');
    await panel.settle();
    assert.ok(!panel.$('#projModal').classList.contains('open'));
    assert.equal(panel.text('#envTitle'), 'dev');
  });

  test('a panel first opened by a status bar pick starts inside that environment', async t => {
    const seeded = createHost();
    await seeded.seed('api', 'dev', [['A', '1']]);
    t.after(() => seeded.close());
    const host = createHost({ panelClosed: true });
    host.globalState.set('envstash_index', seeded.globalState.get('envstash_index'));
    for (const [k, v] of seeded.secrets) host.secrets.set(k, v);
    host.pick = items => items[0];
    await host.command('envstash.switchEnvironment');

    const panel = newPanel(t, host);
    await panel.settle();
    assert.ok(panel.$('#sEnv').classList.contains('active'));
    assert.equal(panel.text('#envTitle'), 'dev');
    assert.deepEqual(panel.varRows().map(r => r.key), ['A']);
  });

  test('a request to open an environment that no longer exists is ignored', async t => {
    const host = createHost();
    await host.seed('api', 'dev');
    const panel = newPanel(t, host);
    host.view.webview.postMessage({ type: 'openEnv', projectId: 'gone', envId: 'gone' });
    assert.ok(panel.$('#sProj').classList.contains('active'));
  });
});

describe('names are data, never code', () => {
  const NASTY = `it's "x" \\ <img src=x onerror=alert(1)> ');alert(1);('`;

  test('a hostile project and environment name is shown as text and still works everywhere', async t => {
    const host = createHost();
    const ids = await host.seed(NASTY, NASTY);
    const panel = newPanel(t, host);
    await panel.click('.proj-row');

    assert.equal(panel.text('.proj-name'), NASTY);
    assert.equal(panel.$('img'), null);
    assert.equal(panel.$$('*').filter(el => el.getAttributeNames().some(a => a.startsWith('on'))).length, 0);

    await panel.click('.proj-acts [title="Rename"]');
    assert.equal(panel.$('#projName').value, NASTY);
    await panel.click('#projModal .btn-ghost');

    await panel.click('.proj-acts [title="Delete"]');
    assert.equal(panel.text('#confMsg'), `Delete "${NASTY}"?`);
    await panel.click('#confModal .btn-ghost');

    await panel.click('.pill-btn[title="Edit"]');
    assert.equal(panel.$('#envName').value, NASTY);
    await panel.click('#envModal .btn-ghost');

    await panel.openEnv(NASTY);
    assert.equal(panel.text('#envTitle'), NASTY);
    assert.equal(panel.text('.bc-cur'), NASTY);
    assert.deepEqual(host.lastPosted('vars'), { type: 'vars', ...ids, data: [] });
  });

  test('hostile ids and colours from an imported backup cannot inject markup', async t => {
    const host = createHost();
    const evil = `x" onclick="alert(1)" data-x='`;
    host.files.set(host.openPath, Buffer.from(JSON.stringify({ version: '1.0.0', projects: [{
      id: evil, name: 'imported',
      envs: [{ id: evil, name: 'dev', color: `red" onclick="alert(1)`, vars: [{ id: evil, key: 'K', value: '<b>v</b>' }], runbook: { stages: [] } }],
    }] })));
    await host.send({ type: 'importFile', merge: true });

    const panel = newPanel(t, host);
    await panel.click('.proj-row');
    const pill = panel.$('.env-pill');
    assert.equal(pill.getAttribute('onclick'), null);
    assert.match(pill.getAttribute('style'), /#4ec994/, 'an invalid colour falls back to the default');

    await panel.openEnv('dev');
    await panel.click('.var-row [title="Reveal"]');
    assert.equal(panel.varRows()[0].value, '<b>v</b>');
    assert.equal(panel.$('.var-row b'), null);
    assert.equal(panel.$$('*').filter(el => el.getAttributeNames().some(a => a.startsWith('on'))).length, 0);
  });

  test('every data-act in the page names a real action', async t => {
    const { panel, host, ids } = await inEnv(t, { vars: [['A', '1']] });
    await host.send({ type: 'saveRunbook', ...ids, data: { stages: [{ id: 's', name: 'S', commands: [{ id: 'c', label: 'l', cmd: 'ls' }] }] } });
    await panel.click('#tRunbook');
    await panel.click('.stage-hd');

    const actions = panel.window.eval('ACTIONS');
    const used = [...new Set(panel.$$('[data-act]').map(el => el.dataset.act))];
    assert.ok(used.length > 25, 'sanity: the page really uses data-act');
    assert.deepEqual(used.filter(name => typeof actions[name] !== 'function'), []);
    for (const el of panel.$$('[data-args]')) assert.ok(Array.isArray(JSON.parse(el.dataset.args)));
  });
});

describe('variables tab', () => {
  test('opening an environment loads its variables, hidden by default', async t => {
    const { panel } = await inEnv(t, { vars: [['API_KEY', 's3cret'], ['DB_URL', 'postgres://x']] });
    assert.ok(panel.$('#sEnv').classList.contains('active'));
    assert.equal(panel.text('#envTitle'), 'dev');
    assert.deepEqual(panel.varRows().map(r => r.key), ['API_KEY', 'DB_URL']);
    assert.ok(panel.varRows().every(r => r.value === '••••••••••'));
    assert.ok(!panel.document.body.innerHTML.includes('s3cret'), 'hidden values are not in the page at all');
  });

  test('adds a variable through the form', async t => {
    const { panel, host, ids } = await inEnv(t);
    assert.equal(panel.text('#varList .empty-h'), 'No variables yet');

    await panel.addVar('NEW_KEY', 'new value');

    assert.deepEqual(host.vars(ids.projectId, ids.envId).map(v => [v.key, v.value]), [['NEW_KEY', 'new value']]);
    assert.deepEqual(panel.varRows().map(r => r.key), ['NEW_KEY']);
    assert.ok(!panel.$('#addForm').classList.contains('open'));
  });

  test('refuses an empty or invalid key before anything is sent', async t => {
    const { panel, host, ids } = await inEnv(t);
    await panel.click('.add-var-row');
    await panel.click('#addForm .btn-primary');
    assert.match(panel.text('#toast'), /Key cannot be empty/);

    await panel.type('#nKey', 'not-valid');
    await panel.click('#addForm .btn-primary');
    assert.match(panel.text('#toast'), /Invalid key/);
    assert.deepEqual(host.vars(ids.projectId, ids.envId), []);
  });

  test('a duplicate key is reported by the extension and nothing changes', async t => {
    const { panel, host, ids } = await inEnv(t, { vars: [['A', 'original']] });
    await panel.addVar('A', 'other');
    assert.equal(host.errors.at(-1), 'EnvStash error: Key "A" already exists');
    assert.deepEqual(host.vars(ids.projectId, ids.envId).map(v => v.value), ['original']);
  });

  test('adds a multi-line value', async t => {
    const { panel, host, ids } = await inEnv(t);
    await panel.click('.add-var-row');
    await panel.type('#nKey', 'CERT');
    panel.$('#isMulti').checked = true;
    await panel.fire('#isMulti', 'change');
    assert.ok(panel.visible('#nValArea') && !panel.visible('#nVal'));
    await panel.type('#nValArea', 'line one\nline two');
    await panel.click('#addForm .btn-primary');
    assert.equal(host.vars(ids.projectId, ids.envId)[0].value, 'line one\nline two');
  });

  test('reveals one value, then hides it again', async t => {
    const { panel } = await inEnv(t, { vars: [['A', 'alpha'], ['B', 'beta']] });
    await panel.click(panel.varRows()[0].row.querySelector('[title="Reveal"]'));
    assert.deepEqual(panel.varRows().map(r => r.value), ['alpha', '••••••••••']);
    await panel.click(panel.varRows()[0].row.querySelector('[title="Hide"]'));
    assert.deepEqual(panel.varRows().map(r => r.value), ['••••••••••', '••••••••••']);
  });

  test('"Show all" reveals everything and "Hide all" hides everything', async t => {
    const { panel } = await inEnv(t, { vars: [['A', 'alpha'], ['B', 'beta']] });
    await panel.click('#revBtn');
    assert.deepEqual(panel.varRows().map(r => r.value), ['alpha', 'beta']);
    assert.match(panel.text('#revBtn'), /Hide all/);
    await panel.click('#revBtn');
    assert.ok(panel.varRows().every(r => r.value === '••••••••••'));
  });

  test('revealed values hide themselves after the configured time', async t => {
    const { panel } = await inEnv(t, { vars: [['A', 'alpha']], settings: { autoHideSeconds: 0.05 } });
    await panel.click('.var-row [title="Reveal"]');
    assert.equal(panel.varRows()[0].value, 'alpha');
    await sleep(120);
    assert.equal(panel.varRows()[0].value, '••••••••••');
  });

  test('revealing another value restarts the timer rather than cutting it short', async t => {
    const { panel } = await inEnv(t, { vars: [['A', 'alpha'], ['B', 'beta']], settings: { autoHideSeconds: 0.4 } });
    await panel.click(panel.varRows()[0].row.querySelector('[title="Reveal"]'));
    await sleep(200);
    await panel.click(panel.varRows()[1].row.querySelector('[title="Reveal"]'));
    await sleep(280);
    assert.deepEqual(panel.varRows().map(r => r.value), ['alpha', 'beta'], 'still visible after the first timer would have fired');
    await sleep(300);
    assert.ok(panel.varRows().every(r => r.value === '••••••••••'));
  });

  test('auto-hide can be turned off', async t => {
    const { panel } = await inEnv(t, { vars: [['A', 'alpha']], settings: { autoHideSeconds: 0 } });
    await panel.click('.var-row [title="Reveal"]');
    await sleep(80);
    assert.equal(panel.varRows()[0].value, 'alpha');
  });

  test('revealed values are hidden as soon as the panel is hidden', async t => {
    const { panel } = await inEnv(t, { vars: [['A', 'alpha']] });
    await panel.click('#revBtn');
    await panel.setHidden(true);
    assert.equal(panel.varRows()[0].value, '••••••••••');
  });

  test('leaving an environment forgets what was revealed', async t => {
    const { panel } = await inEnv(t, { vars: [['A', 'alpha']] });
    await panel.click('#revBtn');
    await panel.click('.env-topbar .icon-btn');
    assert.ok(panel.$('#sProj').classList.contains('active'));
    await panel.openEnv('dev');
    assert.equal(panel.varRows()[0].value, '••••••••••');
  });

  test('copies one variable as an export line and marks it as a secret', async t => {
    const { panel, host } = await inEnv(t, { vars: [['API_KEY', 'has space']], settings: { clipboardClearSeconds: 0.05 } });
    await panel.click('.var-row [title="Copy export"]');
    assert.equal(host.clipboard, 'export API_KEY="has space"');
    await sleep(120);
    assert.equal(host.clipboard, '', 'cleared afterwards because it was sent as a secret');
  });

  test('copies all variables in both formats', async t => {
    const { panel, host } = await inEnv(t, { vars: [['A', '1'], ['B', 'two words']] });
    await panel.click('.copy-export');
    assert.equal(host.clipboard, 'export A=1\nexport B="two words"');
    await panel.click('.copy-env');
    assert.equal(host.clipboard, 'A=1\nB="two words"');
    assert.match(host.info.at(-1), /2 vars copied/);
  });

  test('copy all with no variables explains itself instead of copying', async t => {
    const { panel, host } = await inEnv(t);
    host.clipboard = 'untouched';
    await panel.click('.copy-export');
    assert.match(panel.text('#toast'), /No variables to copy/);
    assert.equal(host.clipboard, 'untouched');
  });

  test('deletes a variable', async t => {
    const { panel, host, ids } = await inEnv(t, { vars: [['A', '1'], ['B', '2']] });
    await panel.click(panel.varRows()[0].row.querySelector('[title="Delete"]'));
    assert.deepEqual(host.vars(ids.projectId, ids.envId).map(v => v.key), ['B']);
    assert.deepEqual(panel.varRows().map(r => r.key), ['B']);
  });

  describe('editing a variable', () => {
    const editButton = (panel, i = 0) => panel.varRows()[i].row.querySelector('[title="Edit"]');
    const stored = ({ host, ids }) => host.vars(ids.projectId, ids.envId);

    test('opens the form with the current key and value, and saves the change in place', async t => {
      const ctx = await inEnv(t, { vars: [['FIRST', '1'], ['API_KEY', 'old value'], ['LAST', '3']] });
      const { panel } = ctx;
      const id = stored(ctx)[1].id;

      await panel.click(editButton(panel, 1));
      assert.equal(panel.text('#varFormTitle'), 'Edit variable');
      assert.deepEqual([panel.$('#nKey').value, panel.$('#nVal').value], ['API_KEY', 'old value']);

      await panel.type('#nVal', 'new value');
      await panel.click('#addForm .btn-primary');

      assert.deepEqual(stored(ctx).map(v => [v.key, v.value]), [['FIRST', '1'], ['API_KEY', 'new value'], ['LAST', '3']]);
      assert.equal(stored(ctx)[1].id, id, 'same variable, same position: not deleted and re-added');
      assert.ok(!panel.$('#addForm').classList.contains('open'));
    });

    test('can rename the key', async t => {
      const ctx = await inEnv(t, { vars: [['OLD_NAME', 'v']] });
      await ctx.panel.click(editButton(ctx.panel));
      await ctx.panel.type('#nKey', 'NEW_NAME');
      await ctx.panel.click('#addForm .btn-primary');
      assert.deepEqual(stored(ctx).map(v => [v.key, v.value]), [['NEW_NAME', 'v']]);
      assert.deepEqual(ctx.panel.varRows().map(r => r.key), ['NEW_NAME']);
    });

    test('renaming onto another variable\'s key is refused and nothing changes', async t => {
      const ctx = await inEnv(t, { vars: [['A', '1'], ['B', '2']] });
      await ctx.panel.click(editButton(ctx.panel, 1));
      await ctx.panel.type('#nKey', 'A');
      await ctx.panel.click('#addForm .btn-primary');
      assert.equal(ctx.host.errors.at(-1), 'EnvStash error: Key "A" already exists');
      assert.deepEqual(stored(ctx).map(v => [v.key, v.value]), [['A', '1'], ['B', '2']]);
    });

    test('an invalid key is refused before anything is sent', async t => {
      const ctx = await inEnv(t, { vars: [['A', '1']] });
      await ctx.panel.click(editButton(ctx.panel));
      await ctx.panel.type('#nKey', 'not valid');
      await ctx.panel.click('#addForm .btn-primary');
      assert.match(ctx.panel.text('#toast'), /Invalid key/);
      assert.deepEqual(stored(ctx).map(v => v.key), ['A']);
      assert.ok(ctx.panel.$('#addForm').classList.contains('open'), 'the form stays open to fix it');
    });

    test('a multi-line value opens in the multi-line editor with its line breaks', async t => {
      const ctx = await inEnv(t, { vars: [['CERT', 'line one\nline two']] });
      const { panel } = ctx;
      await panel.click(editButton(panel));
      assert.ok(panel.$('#isMulti').checked);
      assert.ok(panel.visible('#nValArea') && !panel.visible('#nVal'));
      assert.equal(panel.$('#nValArea').value, 'line one\nline two');

      await panel.type('#nValArea', 'line one\nline two\nline three');
      await panel.click('#addForm .btn-primary');
      assert.equal(stored(ctx)[0].value, 'line one\nline two\nline three');
    });

    test('Cancel discards the edit', async t => {
      const ctx = await inEnv(t, { vars: [['A', 'original']] });
      await ctx.panel.click(editButton(ctx.panel));
      await ctx.panel.type('#nVal', 'changed');
      await ctx.panel.click('#addForm .btn-ghost');
      assert.deepEqual(stored(ctx).map(v => v.value), ['original']);
      assert.ok(!ctx.panel.$('#addForm').classList.contains('open'));
    });

    test('"Add variable" after an edit starts empty and adds a new variable', async t => {
      const ctx = await inEnv(t, { vars: [['A', '1']] });
      await ctx.panel.click(editButton(ctx.panel));
      await ctx.panel.click('#addForm .btn-ghost');

      await ctx.panel.click('.add-var-row');
      assert.equal(ctx.panel.text('#varFormTitle'), 'New variable');
      assert.deepEqual([ctx.panel.$('#nKey').value, ctx.panel.$('#nVal').value], ['', '']);
      await ctx.panel.type('#nKey', 'B');
      await ctx.panel.type('#nVal', '2');
      await ctx.panel.click('#addForm .btn-primary');
      assert.deepEqual(stored(ctx).map(v => [v.key, v.value]), [['A', '1'], ['B', '2']]);
    });

    test('switching from editing straight to adding does not overwrite the edited variable', async t => {
      const ctx = await inEnv(t, { vars: [['A', '1']] });
      await ctx.panel.click(editButton(ctx.panel));
      await ctx.panel.click('.add-var-row');
      await ctx.panel.type('#nKey', 'B');
      await ctx.panel.type('#nVal', '2');
      await ctx.panel.click('#addForm .btn-primary');
      assert.deepEqual(stored(ctx).map(v => [v.key, v.value]), [['A', '1'], ['B', '2']]);
    });

    test('the value is visible while editing and masked again when adding or when the panel hides', async t => {
      const ctx = await inEnv(t, { vars: [['A', 'secret']] });
      const { panel } = ctx;
      assert.equal(panel.$('#nVal').type, 'password');

      await panel.click(editButton(panel));
      assert.equal(panel.$('#nVal').type, 'text');
      await panel.setHidden(true);
      assert.equal(panel.$('#nVal').type, 'password', 'no secret left readable when the panel is hidden');
      await panel.setHidden(false);

      await panel.click(editButton(panel));
      await panel.click('.add-var-row');
      assert.equal(panel.$('#nVal').type, 'password');
    });

    test('editing does not reveal the value in the list', async t => {
      const ctx = await inEnv(t, { vars: [['A', 'secret']] });
      await ctx.panel.click(editButton(ctx.panel));
      assert.equal(ctx.panel.varRows()[0].value, '••••••••••');
    });

    test('deleting the variable being edited closes the form instead of re-creating it on save', async t => {
      const ctx = await inEnv(t, { vars: [['A', '1'], ['B', '2']] });
      await ctx.panel.click(editButton(ctx.panel, 0));
      await ctx.panel.click(ctx.panel.varRows()[0].row.querySelector('[title="Delete"]'));
      assert.ok(!ctx.panel.$('#addForm').classList.contains('open'));
      assert.deepEqual(stored(ctx).map(v => v.key), ['B']);
    });

    test('leaving the environment closes the form', async t => {
      const ctx = await inEnv(t, { vars: [['A', '1']] });
      await ctx.panel.click(editButton(ctx.panel));
      await ctx.panel.click('.env-topbar .icon-btn');
      await ctx.panel.openEnv('dev');
      assert.ok(!ctx.panel.$('#addForm').classList.contains('open'));
    });
  });

  test('search filters by key or value and says when nothing matches', async t => {
    const { panel } = await inEnv(t, { vars: [['DB_HOST', 'localhost'], ['DB_PORT', '5432'], ['API_KEY', 'abc']] });
    await panel.type('#varSearch', 'db_');
    assert.deepEqual(panel.varRows().map(r => r.key), ['DB_HOST', 'DB_PORT']);
    await panel.type('#varSearch', 'LOCALHOST');
    assert.deepEqual(panel.varRows().map(r => r.key), ['DB_HOST']);
    await panel.type('#varSearch', 'zzz');
    assert.equal(panel.text('#varList .empty-h'), 'No matches found');
    await panel.type('#varSearch', '');
    assert.equal(panel.varRows().length, 3);
  });

  test('a late reply for a different environment is ignored', async t => {
    const { panel, host, ids } = await inEnv(t, { vars: [['MINE', '1']] });
    host.view.webview.postMessage({ type: 'vars', projectId: ids.projectId, envId: 'another-env', data: [{ id: 'x', key: 'THEIRS', value: '2' }] });
    assert.deepEqual(panel.varRows().map(r => r.key), ['MINE']);
  });
});

describe('import tab', () => {
  test('pasting a .env block imports it and returns to the variables', async t => {
    const { panel, host, ids } = await inEnv(t, { vars: [['A', 'old']] });
    await panel.click('#tImport');
    assert.ok(panel.visible('#cImport') && !panel.visible('#cVars'));
    await panel.type('#pasteBox', 'A=new\nexport B="b b"\n# comment');
    await panel.click('#cImport .btn-primary');

    assert.deepEqual(host.vars(ids.projectId, ids.envId).map(v => [v.key, v.value]), [['A', 'new'], ['B', 'b b']]);
    assert.ok(panel.visible('#cVars'));
    assert.deepEqual(panel.varRows().map(r => r.key), ['A', 'B']);
    assert.equal(panel.$('#pasteBox').value, '');
  });

  test('importing nothing is refused, and Clear empties the box', async t => {
    const { panel, host } = await inEnv(t);
    await panel.click('#tImport');
    await panel.click('#cImport .btn-primary');
    assert.match(panel.text('#toast'), /Nothing to import/);
    assert.equal(host.info.length, 0);

    await panel.type('#pasteBox', 'A=1');
    await panel.click('#cImport .btn-ghost');
    assert.equal(panel.$('#pasteBox').value, '');
  });
});

describe('runbook tab', () => {
  async function withStage(t, name = 'Start') {
    const ctx = await inEnv(t, { vars: [['A', '1']] });
    await ctx.panel.click('#tRunbook');
    await ctx.panel.click('#rbList .dashed-btn');
    await ctx.panel.type('#stageName', name);
    await ctx.panel.click('#stageModal .btn-primary');
    return ctx;
  }
  async function addCommand(panel, label, cmd, stageIndex = 0) {
    const card = () => panel.$$('.stage-card')[stageIndex];
    if (card().classList.contains('collapsed')) await panel.click(card().querySelector('.stage-hd'));
    await panel.click(card().querySelector('.add-cmd-row'));
    await panel.type('#cmdLabel', label);
    await panel.type('#cmdText', cmd);
    await panel.click('#cmdModal .btn-primary');
  }

  test('adds a stage and a command, and saves them', async t => {
    const { panel, host, ids } = await withStage(t);
    assert.deepEqual(panel.$$('.stage-name').map(el => el.textContent), ['Start']);
    await addCommand(panel, 'Install', 'npm ci');

    const saved = host.runbook(ids.projectId, ids.envId);
    assert.deepEqual(saved.stages.map(s => [s.name, s.commands.map(c => [c.label, c.cmd])]), [['Start', [['Install', 'npm ci']]]]);
    assert.equal(panel.text('.cmd-code'), 'npm ci');
  });

  test('the environment-export template pre-fills the export-env command', async t => {
    const { panel, host, ids } = await inEnv(t);
    await panel.click('#tRunbook');
    await panel.click('#rbList .dashed-btn');
    await panel.type('#stageName', 'Env');
    panel.$('input[name="stageType"][value="env"]').checked = true;
    await panel.click('#stageModal .btn-primary');
    assert.deepEqual(host.runbook(ids.projectId, ids.envId).stages[0].commands.map(c => c.cmd), ['export-env']);
  });

  test('runs one command, and the whole playbook, in the terminal', async t => {
    const { panel, host } = await withStage(t);
    const term = host.useTerminal('bash');
    assert.ok(!panel.visible('#rbBar'), 'no Run playbook button until there is something to run');
    await addCommand(panel, 'Env', 'export-env');
    await addCommand(panel, 'Start', 'npm start');

    await panel.click(panel.$$('.c-btn.run')[1]);
    assert.deepEqual(term.sent, ['npm start']);

    await panel.click('#rbBar .btn-primary');
    assert.equal(term.sent[1], 'export A="1" && npm start');
  });

  test('copying a command does not schedule a clipboard clear', async t => {
    const { panel, host } = await withStage(t);
    host.settings.clipboardClearSeconds = 0.05;
    await addCommand(panel, 'Start', 'npm start');
    await panel.click('.c-btn.copy');
    await sleep(120);
    assert.equal(host.clipboard, 'npm start');
  });

  test('edits and deletes a command, and renames and deletes a stage', async t => {
    const { panel, host, ids } = await withStage(t);
    await addCommand(panel, 'Old', 'old cmd');

    await panel.click('.cmd-acts [title="Edit"]');
    assert.deepEqual([panel.$('#cmdLabel').value, panel.$('#cmdText').value], ['Old', 'old cmd']);
    await panel.type('#cmdText', 'new cmd');
    await panel.click('#cmdModal .btn-primary');
    assert.equal(host.runbook(ids.projectId, ids.envId).stages[0].commands[0].cmd, 'new cmd');

    await panel.click('.stage-acts [title="Rename"]');
    assert.equal(panel.$('#stageName').value, 'Start');
    await panel.type('#stageName', 'Renamed');
    await panel.click('#stageModal .btn-primary');
    assert.equal(host.runbook(ids.projectId, ids.envId).stages[0].name, 'Renamed');
    assert.equal(host.runbook(ids.projectId, ids.envId).stages[0].commands.length, 1, 'renaming keeps the commands');

    await panel.click('.cmd-acts [title="Delete"]');
    await panel.click('#confModal .btn-danger');
    assert.deepEqual(host.runbook(ids.projectId, ids.envId).stages[0].commands, []);

    await panel.click('.stage-acts [title="Delete"]');
    assert.equal(panel.text('#confMsg'), 'Delete "Renamed"?');
    await panel.click('#confModal .btn-danger');
    assert.deepEqual(host.runbook(ids.projectId, ids.envId).stages, []);
  });

  test('stages expand and collapse, and their buttons do not toggle them', async t => {
    const { panel } = await withStage(t);
    assert.ok(panel.$('.stage-card').classList.contains('collapsed'));
    await panel.click('.stage-hd');
    assert.ok(!panel.$('.stage-card').classList.contains('collapsed'));
    await panel.click('.stage-acts [title="Rename"]');
    await panel.click('#stageModal .btn-ghost');
    await panel.click('.drag-handle');
    assert.ok(!panel.$('.stage-card').classList.contains('collapsed'));
  });

  test('dragging a stage onto another reorders and saves them', async t => {
    const { panel, host, ids } = await withStage(t, 'First');
    for (const name of ['Second', 'Third']) {
      await panel.click(panel.$$('#rbList .dashed-btn').at(-1));
      await panel.type('#stageName', name);
      await panel.click('#stageModal .btn-primary');
    }
    const header = i => panel.$$('.stage-hd')[i];

    // jsdom has no layout, so every drop lands in the lower half: "insert after the target"
    await panel.fire(header(0), 'dragstart');
    const over = await panel.fire(header(2), 'dragover', { clientY: 0 });
    assert.ok(over.defaultPrevented, 'dragover must be cancelled or the browser refuses the drop');
    await panel.fire(header(2), 'drop', { clientY: 0 });
    await panel.fire(header(0), 'dragend');

    assert.deepEqual(panel.$$('.stage-name').map(el => el.textContent), ['Second', 'Third', 'First']);
    assert.deepEqual(host.runbook(ids.projectId, ids.envId).stages.map(s => s.name), ['Second', 'Third', 'First']);
    assert.deepEqual(panel.$$('.stage-num').map(el => el.textContent), ['1', '2', '3']);
  });

  describe('reordering commands inside a stage', () => {
    async function withCommands(t, labels = ['one', 'two', 'three']) {
      const ctx = await withStage(t);
      for (const label of labels) await addCommand(ctx.panel, label, `echo ${label}`);
      return ctx;
    }
    const row = (panel, i, stage = 0) => panel.$$('.stage-card')[stage].querySelectorAll('.cmd-row')[i];
    const handle = (panel, i, stage = 0) => row(panel, i, stage).querySelector('.cmd-handle');
    const shown = panel => panel.$$('.cmd-label').map(el => el.textContent);
    const stored = ({ host, ids }, stage = 0) => host.runbook(ids.projectId, ids.envId).stages[stage].commands.map(c => c.label);
    // jsdom has no layout, so a drop always counts as the lower half: "insert after the target"
    async function drag(panel, from, to, { fromStage = 0, toStage = 0 } = {}) {
      await panel.fire(handle(panel, from, fromStage), 'dragstart');
      const over = await panel.fire(row(panel, to, toStage), 'dragover', { clientY: 0 });
      await panel.fire(row(panel, to, toStage), 'drop', { clientY: 0 });
      return over;
    }

    test('dragging a command by its handle moves it and saves the new order', async t => {
      const ctx = await withCommands(t);
      const over = await drag(ctx.panel, 0, 2);
      assert.ok(over.defaultPrevented, 'dragover must be cancelled or the browser refuses the drop');
      assert.deepEqual(shown(ctx.panel), ['two', 'three', 'one']);
      assert.deepEqual(stored(ctx), ['two', 'three', 'one']);
    });

    test('moving a command up works too', async t => {
      const ctx = await withCommands(t);
      await drag(ctx.panel, 2, 0);
      assert.deepEqual(stored(ctx), ['one', 'three', 'two']);
    });

    test('the buttons act on the command now in that position', async t => {
      const ctx = await withCommands(t);
      const term = ctx.host.useTerminal('bash');
      await drag(ctx.panel, 0, 2);
      await ctx.panel.click(row(ctx.panel, 0).querySelector('.c-btn.run'));
      assert.deepEqual(term.sent, ['echo two']);
      await ctx.panel.click('#rbBar .btn-primary');
      assert.equal(term.sent[1], 'echo two && echo three && echo one');
    });

    test('dropping a command on itself changes nothing and saves nothing', async t => {
      const ctx = await withCommands(t);
      const before = JSON.stringify(ctx.host.runbook(ctx.ids.projectId, ctx.ids.envId));
      const writes = () => [...ctx.host.secrets.entries()].length + ctx.host.posted.length;
      const count = writes();
      await drag(ctx.panel, 1, 1);
      assert.equal(JSON.stringify(ctx.host.runbook(ctx.ids.projectId, ctx.ids.envId)), before);
      assert.equal(writes(), count);
    });

    test('a command cannot be dropped into a different stage', async t => {
      const ctx = await withCommands(t, ['a1', 'a2']);
      await ctx.panel.click(ctx.panel.$$('#rbList .dashed-btn').at(-1));
      await ctx.panel.type('#stageName', 'Second');
      await ctx.panel.click('#stageModal .btn-primary');
      await addCommand(ctx.panel, 'b1', 'echo b1', 1);
      await addCommand(ctx.panel, 'b2', 'echo b2', 1);

      const over = await drag(ctx.panel, 0, 1, { toStage: 1 });
      assert.ok(!over.defaultPrevented, 'the browser is told this is not a drop target');
      assert.deepEqual(stored(ctx, 0), ['a1', 'a2']);
      assert.deepEqual(stored(ctx, 1), ['b1', 'b2']);
    });

    test('only the handle starts a drag, and a single command has no handle', async t => {
      const ctx = await withCommands(t, ['only']);
      assert.equal(ctx.panel.$('.cmd-handle'), null);

      await addCommand(ctx.panel, 'second', 'echo second');
      assert.equal(ctx.panel.$$('.cmd-handle').length, 2);
      assert.ok(!row(ctx.panel, 0).hasAttribute('draggable'), 'the row itself stays selectable text');
      // a drag that did not start on a handle must not be picked up as a command move
      await ctx.panel.fire(row(ctx.panel, 0).querySelector('.cmd-code'), 'dragstart');
      await ctx.panel.fire(row(ctx.panel, 1), 'drop', { clientY: 0 });
      assert.deepEqual(stored(ctx), ['only', 'second']);
    });

    test('dragging a command over a stage header does not move stages', async t => {
      const ctx = await withCommands(t, ['a1', 'a2']);
      await ctx.panel.click(ctx.panel.$$('#rbList .dashed-btn').at(-1));
      await ctx.panel.type('#stageName', 'Second');
      await ctx.panel.click('#stageModal .btn-primary');

      await ctx.panel.fire(handle(ctx.panel, 0), 'dragstart');
      await ctx.panel.fire(ctx.panel.$$('.stage-hd')[1], 'drop', { clientY: 0 });
      assert.deepEqual(ctx.panel.$$('.stage-name').map(el => el.textContent), ['Start', 'Second']);
    });

    test('a finished stage move does not linger and hijack the next drag', async t => {
      const ctx = await withCommands(t, ['a1', 'a2']);
      await ctx.panel.click(ctx.panel.$$('#rbList .dashed-btn').at(-1));
      await ctx.panel.type('#stageName', 'Second');
      await ctx.panel.click('#stageModal .btn-primary');
      const names = () => ctx.host.runbook(ctx.ids.projectId, ctx.ids.envId).stages.map(s => s.name);

      // move stage 0 after stage 1; the re-render detaches the dragged header, so no dragend arrives
      await ctx.panel.fire(ctx.panel.$$('.stage-hd')[0], 'dragstart');
      await ctx.panel.fire(ctx.panel.$$('.stage-hd')[1], 'drop', { clientY: 0 });
      assert.deepEqual(names(), ['Second', 'Start']);

      // a later, unrelated drop on a header must not move a stage again
      await ctx.panel.fire(ctx.panel.$$('.stage-hd')[1], 'drop', { clientY: 0 });
      assert.deepEqual(names(), ['Second', 'Start']);
    });
  });

  test('dropping a stage on itself changes nothing', async t => {
    const { panel, host, ids } = await withStage(t, 'Only');
    const before = host.posted.length;
    await panel.fire('.stage-hd', 'dragstart');
    await panel.fire('.stage-hd', 'drop', { clientY: 0 });
    await panel.fire('.stage-hd', 'dragend');
    assert.deepEqual(host.runbook(ids.projectId, ids.envId).stages.map(s => s.name), ['Only']);
    assert.equal(host.posted.length, before);
  });
});

describe('notes tab', () => {
  const area = panel => panel.$('#notesArea');
  async function onNotes(t, existing, options) {
    const host = createHost(options);
    const ids = await host.seed('api', 'dev');
    if (existing !== undefined) await host.send({ type: 'saveNotes', ...ids, notes: existing });
    const panel = newPanel(t, host);
    await panel.click('.proj-row');
    await panel.openEnv('dev');
    await panel.click('#tNotes');
    return { panel, host, ids };
  }
  const saved = ({ host, ids }) => host.notes(ids.projectId, ids.envId);

  test('an environment without notes opens ready to write', async t => {
    const { panel } = await onNotes(t);
    assert.ok(panel.visible('#notesArea') && !panel.visible('#notesPreview'));
    assert.equal(area(panel).readOnly, false);
    assert.equal(panel.text('#notesStatus'), 'Saved');
  });

  test('existing notes open rendered, with the text intact', async t => {
    const ctx = await onNotes(t, '# Setup\n- [ ] install\n- [x] configure');
    const { panel } = ctx;
    assert.ok(panel.visible('#notesPreview') && !panel.visible('#notesArea'));
    assert.equal(panel.text('#notesPreview h1'), 'Setup');
    assert.equal(panel.$$('#notesPreview input[type=checkbox]').length, 2);
    assert.equal(area(panel).value, '# Setup\n- [ ] install\n- [x] configure');
    assert.equal(saved(ctx), '# Setup\n- [ ] install\n- [x] configure', 'merely opening notes never rewrites them');
  });

  test('typing saves after a short pause', async t => {
    const ctx = await onNotes(t);
    await ctx.panel.type('#notesArea', 'hello');
    assert.equal(ctx.panel.text('#notesStatus'), 'Saving…');
    assert.equal(saved(ctx), undefined, 'not saved on every keystroke');
    await sleep(950);
    await ctx.panel.settle();
    assert.equal(saved(ctx), 'hello');
    assert.equal(ctx.panel.text('#notesStatus'), 'Saved');
    assert.equal(ctx.panel.text('#notesCount'), '1 word · 5 chars');
  });

  test('switching tab saves immediately instead of dropping the edit', async t => {
    const ctx = await onNotes(t, 'old');
    await ctx.panel.click('#btnNotesEdit');
    await ctx.panel.type('#notesArea', 'old plus new');
    await ctx.panel.click('#tVars');
    assert.equal(saved(ctx), 'old plus new');
  });

  test('going back to the project list saves immediately', async t => {
    const ctx = await onNotes(t);
    await ctx.panel.type('#notesArea', 'typed then left');
    await ctx.panel.click('.env-topbar .icon-btn');
    assert.equal(saved(ctx), 'typed then left');
  });

  test('leaving and returning to the tab keeps the text and does not re-save it', async t => {
    const ctx = await onNotes(t);
    await ctx.panel.type('#notesArea', 'draft');
    await ctx.panel.click('#tVars');
    await ctx.panel.click('#tNotes');
    assert.equal(area(ctx.panel).value, 'draft');
    assert.equal(area(ctx.panel).readOnly, false);
    const saves = () => ctx.host.posted.length;
    const before = saves();
    await sleep(900);
    assert.equal(saved(ctx), 'draft');
    assert.equal(saves(), before);
  });

  test('notes of one environment never land in another', async t => {
    const host = createHost();
    const dev = await host.seed('api', 'dev');
    await host.send({ type: 'createEnv', projectId: dev.projectId, name: 'prod', color: '#f48771' });
    const prodId = host.index().projects[0].envs[1].id;
    await host.send({ type: 'saveNotes', projectId: dev.projectId, envId: prodId, notes: 'prod notes' });
    const panel = newPanel(t, host);
    await panel.click('.proj-row');

    await panel.openEnv('dev');
    await panel.click('#tNotes');
    await panel.type('#notesArea', 'dev notes');
    await panel.click('.env-topbar .icon-btn');
    await panel.openEnv('prod');
    await panel.click('#tNotes');

    assert.equal(area(panel).value, 'prod notes');
    assert.equal(host.notes(dev.projectId, dev.envId), 'dev notes');
    assert.equal(host.notes(dev.projectId, prodId), 'prod notes');
  });

  test('the editor is read-only until the stored notes arrive, so typing cannot overwrite them', async t => {
    const host = createHost();
    const ids = await host.seed('api', 'dev');
    await host.send({ type: 'saveNotes', ...ids, notes: 'important' });
    const panel = newPanel(t, host);
    await panel.click('.proj-row');
    await panel.openEnv('dev');

    // hold the reply back to observe the loading state
    const deliver = host.onPost;
    const held = [];
    host.onPost = message => held.push(message);
    await panel.click('#tNotes');
    assert.equal(area(panel).readOnly, true);
    assert.equal(panel.text('#notesStatus'), 'Loading…');
    await panel.type('#notesArea', 'typed too early');
    await sleep(900);
    assert.equal(host.notes(ids.projectId, ids.envId), 'important');

    host.onPost = deliver;
    held.forEach(deliver);
    assert.equal(area(panel).value, 'important');
    assert.equal(area(panel).readOnly, false);
  });

  test('a stale reply arriving while there are unsaved edits does not overwrite them', async t => {
    const ctx = await onNotes(t, 'stored');
    await ctx.panel.click('#btnNotesEdit');
    await ctx.panel.type('#notesArea', 'stored, plus what I am typing');
    // e.g. the refresh that follows a backup import, answered with the older stored text
    ctx.host.view.webview.postMessage({ type: 'notes', ...ctx.ids, data: 'stored' });
    assert.equal(area(ctx.panel).value, 'stored, plus what I am typing');
    await ctx.panel.click('#tVars');
    assert.equal(saved(ctx), 'stored, plus what I am typing');
  });

  test('after a backup import, open notes are refreshed from storage', async t => {
    const ctx = await onNotes(t, 'before import');
    ctx.host.files.set(ctx.host.openPath, Buffer.from(JSON.stringify({ version: '1.0.0', projects: [{
      id: ctx.ids.projectId, name: 'api', envs: [{ id: ctx.ids.envId, name: 'dev', color: '#4ec994', vars: [], runbook: { stages: [] }, notes: 'from backup' }],
    }] })));
    await ctx.host.send({ type: 'importFile', merge: true });
    await ctx.panel.settle();
    assert.equal(area(ctx.panel).value, 'from backup');
    assert.equal(ctx.panel.text('#notesPreview'), 'from backup');
  });

  test('Preview renders what is in the editor and Write returns to it', async t => {
    const { panel } = await onNotes(t);
    await panel.type('#notesArea', '## Title\n**bold**');
    await panel.click('#btnNotesPrev');
    assert.equal(panel.text('#notesPreview h2'), 'Title');
    assert.equal(panel.text('#notesPreview strong'), 'bold');
    assert.equal(panel.$('#notesFormatBar').style.visibility, 'hidden');
    await panel.click('#btnNotesEdit');
    assert.ok(panel.visible('#notesArea'));
    assert.equal(area(panel).value, '## Title\n**bold**');
  });

  test('ticking a checkbox in the preview updates only that line and saves', async t => {
    const ctx = await onNotes(t, '- [ ] one\n- [ ] two\n- [x] three');
    const boxes = () => ctx.panel.$$('#notesPreview input[type=checkbox]');
    boxes()[1].checked = true;
    await ctx.panel.fire(boxes()[1], 'change');
    assert.equal(area(ctx.panel).value, '- [ ] one\n- [x] two\n- [x] three');
    assert.deepEqual(boxes().map(b => b.checked), [false, true, true]);

    boxes()[2].checked = false;
    await ctx.panel.fire(boxes()[2], 'change');
    await ctx.panel.click('#tVars');
    assert.equal(saved(ctx), '- [ ] one\n- [x] two\n- [ ] three');
  });

  describe('toolbar', () => {
    async function withSelection(t, text, start, end) {
      const ctx = await onNotes(t);
      await ctx.panel.type('#notesArea', text);
      area(ctx.panel).setSelectionRange(start, end);
      return ctx;
    }
    const selection = panel => area(panel).value.slice(area(panel).selectionStart, area(panel).selectionEnd);

    test('Bold and Italic wrap the selection and keep it selected', async t => {
      const { panel } = await withSelection(t, 'make this strong', 10, 16);
      await panel.click('[title="Bold"]');
      assert.equal(area(panel).value, 'make this **strong**');
      assert.equal(selection(panel), 'strong');
      await panel.click('[title="Italic"]');
      assert.equal(area(panel).value, 'make this ***strong***');
    });

    test('with nothing selected, a placeholder is inserted and selected', async t => {
      const { panel } = await withSelection(t, '', 0, 0);
      await panel.click('[title="Bold"]');
      assert.equal(area(panel).value, '**bold text**');
      assert.equal(selection(panel), 'bold text');
    });

    test('list buttons prefix every selected line, and remove the prefix when pressed again', async t => {
      const { panel } = await withSelection(t, 'one\ntwo\nthree', 1, 6);
      await panel.click('[title="Bullet list"]');
      assert.equal(area(panel).value, '- one\n- two\nthree');
      await panel.click('[title="Bullet list"]');
      assert.equal(area(panel).value, 'one\ntwo\nthree');
    });

    test('Heading, Checklist and Quote prefix the current line', async t => {
      for (const [title, prefix] of [['Heading', '## '], ['Checklist', '- [ ] '], ['Quote', '> ']]) {
        const { panel } = await withSelection(t, 'first\nsecond', 8, 8);
        await panel.click(`[title="${title}"]`);
        assert.equal(area(panel).value, `first\n${prefix}second`);
        await panel.close();
      }
    });

    test('Code uses backticks for one line and a fenced block for several', async t => {
      const one = await withSelection(t, 'run npm ci now', 4, 10);
      await one.panel.click('[title="Code"]');
      assert.equal(area(one.panel).value, 'run `npm ci` now');

      const many = await withSelection(t, 'a\nb', 0, 3);
      await many.panel.click('[title="Code"]');
      assert.equal(area(many.panel).value, '```\na\nb\n```');
    });

    test('Link wraps text, or uses a selected URL as the target', async t => {
      const text = await withSelection(t, 'see docs', 4, 8);
      await text.panel.click('[title="Link"]');
      assert.equal(area(text.panel).value, 'see [docs](https://)');
      assert.equal(selection(text.panel), 'https://');

      const url = await withSelection(t, 'https://example.com', 0, 19);
      await url.panel.click('[title="Link"]');
      assert.equal(area(url.panel).value, '[text](https://example.com)');
      assert.equal(selection(url.panel), 'text');
    });

    test('toolbar edits are saved like typing', async t => {
      const ctx = await withSelection(t, 'word', 0, 4);
      await ctx.panel.click('[title="Bold"]');
      await ctx.panel.click('#tVars');
      assert.equal(saved(ctx), '**word**');
    });
  });

  describe('Enter key in lists', () => {
    async function pressEnter(t, text, init = {}) {
      const ctx = await onNotes(t);
      await ctx.panel.type('#notesArea', text);
      area(ctx.panel).setSelectionRange(text.length, text.length);
      const event = new ctx.panel.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init });
      area(ctx.panel).dispatchEvent(event);
      return { value: area(ctx.panel).value, handled: event.defaultPrevented };
    }

    test('continues a bullet, a checklist and a numbered list', async t => {
      assert.equal((await pressEnter(t, '- item')).value, '- item\n- ');
      assert.equal((await pressEnter(t, '  * nested')).value, '  * nested\n  * ');
      assert.equal((await pressEnter(t, '- [x] done')).value, '- [x] done\n- [ ] ');
      assert.equal((await pressEnter(t, '9. nine')).value, '9. nine\n10. ');
    });

    test('on an empty item, ends the list instead of adding another', async t => {
      assert.equal((await pressEnter(t, '- one\n- ')).value, '- one\n');
      assert.equal((await pressEnter(t, '- [ ] ')).value, '');
    });

    test('leaves normal lines and Shift+Enter to the browser', async t => {
      assert.deepEqual(await pressEnter(t, 'plain text'), { value: 'plain text', handled: false });
      assert.deepEqual(await pressEnter(t, '- item', { shiftKey: true }), { value: '- item', handled: false });
    });
  });
});

describe('dialogs and keyboard', () => {
  test('Escape closes an open dialog', async t => {
    const panel = newPanel(t);
    await panel.click('#projList .dashed-btn');
    assert.ok(panel.$('#projModal').classList.contains('open'));
    panel.document.dispatchEvent(new panel.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(!panel.$('#projModal').classList.contains('open'));
  });

  test('clicking the backdrop closes a dialog, clicking inside does not', async t => {
    const panel = newPanel(t);
    await panel.click('#projList .dashed-btn');
    await panel.click('#projModal .modal-title');
    assert.ok(panel.$('#projModal').classList.contains('open'));
    await panel.click('#projModal');
    assert.ok(!panel.$('#projModal').classList.contains('open'));
  });

  test('Enter in the name field saves the dialog', async t => {
    const panel = newPanel(t);
    await panel.click('#projList .dashed-btn');
    await panel.type('#projName', 'via-enter');
    panel.$('#projName').dispatchEvent(new panel.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await panel.settle();
    assert.deepEqual(panel.host.index().projects.map(p => p.name), ['via-enter']);
  });

  test('tabs show one section at a time, and the copy bar only on Variables', async t => {
    const { panel } = await inEnv(t);
    const shown = () => ['#cVars', '#cImport', '#cRunbook', '#cNotes'].filter(id => panel.visible(id));
    assert.deepEqual(shown(), ['#cVars']);
    for (const [tab, section] of [['#tImport', '#cImport'], ['#tRunbook', '#cRunbook'], ['#tNotes', '#cNotes'], ['#tVars', '#cVars']]) {
      await panel.click(tab);
      assert.deepEqual(shown(), [section]);
      assert.equal(panel.visible('#copyBar'), tab === '#tVars');
      assert.ok(panel.$(tab).classList.contains('active'));
    }
  });
});
