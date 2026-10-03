'use strict';
// Feature tests for the extension host: every message the panel can send, driven without a DOM.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createHost, sleep } = require('../helpers/host');

const PASS = 'correct horse battery';

/** A host that is always shut down, even when the test fails. */
function newHost(t, options) {
  const host = createHost(options);
  t.after(() => host.close());
  return host;
}

describe('projects', () => {
  test('creates a project, trimming the name, and tells the panel', async t => {
    const host = newHost(t);
    await host.send({ type: 'createProject', name: '  api  ' });
    assert.deepEqual(host.index().projects.map(p => p.name), ['api']);
    assert.deepEqual(host.lastPosted('index').data, host.index());
  });

  test('rejects an empty name and a duplicate name in any case', async t => {
    const host = newHost(t);
    await host.send({ type: 'createProject', name: '   ' });
    await host.send({ type: 'createProject', name: 'Api' });
    await host.send({ type: 'createProject', name: 'API' });
    assert.deepEqual(host.errors, [
      'EnvStash error: Project name cannot be empty',
      'EnvStash error: Project "API" already exists',
    ]);
    assert.equal(host.index().projects.length, 1);
  });

  test('renames a project, but not onto another project\'s name', async t => {
    const host = newHost(t);
    await host.send({ type: 'createProject', name: 'one' });
    await host.send({ type: 'createProject', name: 'two' });
    const [one] = host.index().projects;

    await host.send({ type: 'renameProject', projectId: one.id, name: 'ONE' });
    assert.equal(host.index().projects[0].name, 'ONE', 'changing only the case of its own name is allowed');

    await host.send({ type: 'renameProject', projectId: one.id, name: 'Two' });
    assert.equal(host.index().projects[0].name, 'ONE');
    assert.match(host.errors.at(-1), /already exists/);
  });

  test('deleting a project removes every secret that belonged to it', async t => {
    const host = newHost(t);
    const keep = await host.seed('keep', 'dev', [['A', '1']]);
    const gone = await host.seed('gone', 'dev', [['B', '2']]);
    await host.send({ type: 'saveNotes', ...gone, notes: 'n' });
    await host.send({ type: 'saveRunbook', ...gone, data: { stages: [] } });

    await host.send({ type: 'deleteProject', projectId: gone.projectId });

    assert.deepEqual(host.index().projects.map(p => p.name), ['keep']);
    assert.deepEqual([...host.secrets.keys()].filter(k => k.includes(gone.projectId)), []);
    assert.deepEqual(host.vars(keep.projectId, keep.envId).map(v => v.key), ['A']);
  });
});

describe('environments', () => {
  test('creates environments; names are unique per project only', async t => {
    const host = newHost(t);
    const a = await host.seed('a', 'dev');
    await host.seed('b', 'dev');
    await host.send({ type: 'createEnv', projectId: a.projectId, name: 'DEV', color: '#fff' });
    assert.match(host.errors.at(-1), /Environment "DEV" already exists in this project/);
    assert.deepEqual(host.index().projects.map(p => p.envs.length), [1, 1]);
  });

  test('rejects an empty name and an unknown project', async t => {
    const host = newHost(t);
    const { projectId } = await host.seed();
    await host.send({ type: 'createEnv', projectId, name: ' ' });
    await host.send({ type: 'createEnv', projectId: 'nope', name: 'x' });
    assert.deepEqual(host.errors, ['EnvStash error: Environment name cannot be empty', 'EnvStash error: Project not found']);
  });

  test('renames and recolours an environment without touching its data', async t => {
    const host = newHost(t);
    const ids = await host.seed('api', 'dev', [['A', '1']]);
    await host.send({ type: 'renameEnv', ...ids, name: 'development', color: '#ff0000' });
    const env = host.index().projects[0].envs[0];
    assert.deepEqual({ name: env.name, color: env.color, id: env.id }, { name: 'development', color: '#ff0000', id: ids.envId });
    assert.deepEqual(host.vars(ids.projectId, ids.envId).map(v => v.key), ['A']);
  });

  test('deleting an environment removes only its own secrets', async t => {
    const host = newHost(t);
    const dev = await host.seed('api', 'dev', [['A', '1']]);
    await host.send({ type: 'createEnv', projectId: dev.projectId, name: 'prod', color: '#fff' });
    const prodId = host.index().projects[0].envs[1].id;
    await host.send({ type: 'saveVar', projectId: dev.projectId, envId: prodId, var: { key: 'B', value: '2' } });

    await host.send({ type: 'deleteEnv', projectId: dev.projectId, envId: prodId });

    assert.deepEqual(host.index().projects[0].envs.map(e => e.name), ['dev']);
    assert.deepEqual(host.vars(dev.projectId, prodId), []);
    assert.deepEqual(host.vars(dev.projectId, dev.envId).map(v => v.key), ['A']);
  });
});

describe('duplicating an environment', () => {
  async function source(t) {
    const host = newHost(t);
    const ids = await host.seed('api', 'dev', [['A', '1'], ['B', 'two\nlines']]);
    await host.send({ type: 'saveNotes', ...ids, notes: 'dev notes' });
    await host.send({ type: 'saveRunbook', ...ids, data: { stages: [
      { id: 's1', name: 'Start', commands: [{ id: 'c1', label: 'Run', cmd: 'npm start' }] },
    ] } });
    return { host, ids };
  }
  const envs = host => host.index().projects[0].envs;

  test('copies variables, runbook and notes into a new environment', async t => {
    const { host, ids } = await source(t);
    await host.send({ type: 'duplicateEnv', ...ids, name: ' staging ', color: '#f48771' });

    const copy = envs(host)[1];
    assert.deepEqual([copy.name, copy.color], ['staging', '#f48771']);
    assert.notEqual(copy.id, ids.envId);
    assert.deepEqual(host.vars(ids.projectId, copy.id).map(v => [v.key, v.value]), [['A', '1'], ['B', 'two\nlines']]);
    assert.equal(host.notes(ids.projectId, copy.id), 'dev notes');
    assert.deepEqual(host.runbook(ids.projectId, copy.id).stages.map(s => [s.name, s.commands.map(c => c.cmd)]), [['Start', ['npm start']]]);
    assert.deepEqual(host.lastPosted('index').data, host.index());
  });

  test('the copy is independent: it shares no ids and editing it leaves the original alone', async t => {
    const { host, ids } = await source(t);
    await host.send({ type: 'duplicateEnv', ...ids, name: 'staging' });
    const copyId = envs(host)[1].id;

    const originalIds = [...host.vars(ids.projectId, ids.envId).map(v => v.id), 's1', 'c1'];
    const copyRunbook = host.runbook(ids.projectId, copyId);
    const copyIds = [...host.vars(ids.projectId, copyId).map(v => v.id), copyRunbook.stages[0].id, copyRunbook.stages[0].commands[0].id];
    assert.deepEqual(copyIds.filter(id => originalIds.includes(id)), []);

    const a = host.vars(ids.projectId, copyId)[0];
    await host.send({ type: 'saveVar', projectId: ids.projectId, envId: copyId, var: { id: a.id, key: 'A', value: 'changed' } });
    await host.send({ type: 'saveNotes', projectId: ids.projectId, envId: copyId, notes: 'staging notes' });
    assert.equal(host.vars(ids.projectId, ids.envId)[0].value, '1');
    assert.equal(host.notes(ids.projectId, ids.envId), 'dev notes');
  });

  test('keeps the original colour when none is given and sits right after the original', async t => {
    const { host, ids } = await source(t);
    await host.send({ type: 'createEnv', projectId: ids.projectId, name: 'prod', color: '#fff' });
    await host.send({ type: 'duplicateEnv', ...ids, name: 'dev 2' });
    assert.deepEqual(envs(host).map(e => e.name), ['dev', 'dev 2', 'prod']);
    assert.equal(envs(host)[1].color, envs(host)[0].color);
  });

  test('an empty environment duplicates to an empty one without writing empty secrets', async t => {
    const host = newHost(t);
    const ids = await host.seed('api', 'dev');
    await host.send({ type: 'duplicateEnv', ...ids, name: 'copy' });
    assert.equal(envs(host).length, 2);
    assert.equal(host.secrets.size, 0);
  });

  test('rejects a taken or empty name, an unknown project and an unknown environment', async t => {
    const { host, ids } = await source(t);
    await host.send({ type: 'duplicateEnv', ...ids, name: 'DEV' });
    await host.send({ type: 'duplicateEnv', ...ids, name: '  ' });
    await host.send({ type: 'duplicateEnv', projectId: 'nope', envId: ids.envId, name: 'x' });
    await host.send({ type: 'duplicateEnv', projectId: ids.projectId, envId: 'nope', name: 'x' });
    assert.deepEqual(host.errors, [
      'EnvStash error: Environment "DEV" already exists in this project',
      'EnvStash error: Environment name cannot be empty',
      'EnvStash error: Project not found',
      'EnvStash error: Environment not found',
    ]);
    assert.equal(envs(host).length, 1);
  });
});

describe('comparing environments', () => {
  test('returns the differences between two environments, keyed to the request', async t => {
    const host = newHost(t);
    const dev = await host.seed('api', 'dev', [['SAME', 'x'], ['CHANGED', 'dev'], ['DEV_ONLY', 'd']]);
    await host.send({ type: 'createEnv', projectId: dev.projectId, name: 'prod', color: '#fff' });
    const prodId = host.index().projects[0].envs[1].id;
    for (const [key, value] of [['SAME', 'x'], ['CHANGED', 'prod'], ['PROD_ONLY', 'p']]) {
      await host.send({ type: 'saveVar', projectId: dev.projectId, envId: prodId, var: { key, value } });
    }

    await host.send({ type: 'compareEnvs', ...dev, otherProjectId: dev.projectId, otherEnvId: prodId });

    assert.deepEqual(host.lastPosted('compare'), {
      type: 'compare', ...dev, otherProjectId: dev.projectId, otherEnvId: prodId,
      data: [
        { key: 'SAME', status: 'same', left: 'x', right: 'x' },
        { key: 'CHANGED', status: 'different', left: 'dev', right: 'prod' },
        { key: 'DEV_ONLY', status: 'onlyLeft', left: 'd' },
        { key: 'PROD_ONLY', status: 'onlyRight', right: 'p' },
      ],
    });
  });

  test('can compare across projects, and comparing changes nothing', async t => {
    const host = newHost(t);
    const a = await host.seed('one', 'dev', [['A', '1']]);
    const b = await host.seed('two', 'dev', [['A', '2']]);
    const before = JSON.stringify([...host.secrets.entries()]);
    await host.send({ type: 'compareEnvs', ...a, otherProjectId: b.projectId, otherEnvId: b.envId });
    assert.deepEqual(host.lastPosted('compare').data, [{ key: 'A', status: 'different', left: '1', right: '2' }]);
    assert.equal(JSON.stringify([...host.secrets.entries()]), before);
  });
});

describe('status bar environment switcher', () => {
  const SWITCH = 'envstash.switchEnvironment';

  test('shows a neutral label until an environment is chosen, and is clickable', t => {
    const host = newHost(t);
    const bar = host.statusBar();
    assert.equal(bar.text, '$(lock) EnvStash');
    assert.equal(bar.command, SWITCH);
    assert.ok(bar.visible);
  });

  test('opening an environment in the panel makes it the active one', async t => {
    const host = newHost(t);
    const ids = await host.seed('api', 'dev');
    await host.send({ type: 'setActiveEnv', ...ids });
    assert.equal(host.statusBar().text, '$(lock) api / dev');
    assert.match(host.statusBar().tooltip, /dev \(api\)/);
  });

  test('the label follows renames and falls back when the environment is deleted', async t => {
    const host = newHost(t);
    const ids = await host.seed('api', 'dev');
    await host.send({ type: 'setActiveEnv', ...ids });

    await host.send({ type: 'renameEnv', ...ids, name: 'development' });
    assert.equal(host.statusBar().text, '$(lock) api / development');
    await host.send({ type: 'renameProject', projectId: ids.projectId, name: 'backend' });
    assert.equal(host.statusBar().text, '$(lock) backend / development');

    await host.send({ type: 'deleteEnv', ...ids });
    assert.equal(host.statusBar().text, '$(lock) EnvStash');
  });

  test('falls back when the whole project is deleted or replaced by an import', async t => {
    const host = newHost(t);
    const ids = await host.seed('api', 'dev');
    await host.send({ type: 'setActiveEnv', ...ids });
    await host.send({ type: 'deleteProject', projectId: ids.projectId });
    assert.equal(host.statusBar().text, '$(lock) EnvStash');

    host.files.set(host.openPath, Buffer.from(JSON.stringify({ version: '1.0.0', projects: [
      { id: ids.projectId, name: 'restored', envs: [{ id: ids.envId, name: 'dev', color: '#fff', vars: [], runbook: { stages: [] } }] },
    ] })));
    await host.send({ type: 'importFile', merge: true });
    assert.equal(host.statusBar().text, '$(lock) restored / dev', 'refreshed after an import too');
  });

  test('the choice is remembered per workspace, not globally', async t => {
    const host = newHost(t);
    const ids = await host.seed('api', 'dev');
    await host.send({ type: 'setActiveEnv', ...ids });
    assert.deepEqual([...host.workspaceState.values()], [ids]);
    assert.ok(![...host.globalState.values()].some(v => String(v).includes('active')));
  });

  test('the switch command lists every environment, marks the current one, and opens the choice in the panel', async t => {
    const host = newHost(t);
    const dev = await host.seed('api', 'dev');
    const web = await host.seed('web', 'prod');
    await host.send({ type: 'setActiveEnv', ...dev });
    host.pick = items => items.find(i => i.label === 'prod');

    await host.command(SWITCH);

    assert.deepEqual(host.quickPicks[0].map(i => [i.label, i.description]), [['dev', 'api  ·  current'], ['prod', 'web']]);
    assert.equal(host.statusBar().text, '$(lock) web / prod');
    assert.deepEqual(host.lastPosted('openEnv'), { type: 'openEnv', ...web });
    assert.deepEqual(host.executed, ['envstash.panel.focus']);
  });

  test('dismissing the picker changes nothing', async t => {
    const host = newHost(t);
    const dev = await host.seed('api', 'dev');
    await host.send({ type: 'setActiveEnv', ...dev });
    await host.command(SWITCH);
    assert.equal(host.statusBar().text, '$(lock) api / dev');
    assert.equal(host.lastPosted('openEnv'), undefined);
    assert.deepEqual(host.executed, []);
  });

  test('with no environments it says so and shows the panel instead of an empty picker', async t => {
    const host = newHost(t);
    await host.command(SWITCH);
    assert.equal(host.quickPicks.length, 0);
    assert.match(host.info.at(-1), /no environments yet/);
    assert.deepEqual(host.executed, ['envstash.panel.focus']);
  });

  test('picking before the panel was ever opened makes the page start in that environment', async t => {
    const seeded = newHost(t);
    const ids = await seeded.seed('api', 'dev');
    const host = newHost(t, { panelClosed: true });
    host.globalState.set('envstash_index', seeded.globalState.get('envstash_index'));
    host.pick = items => items[0];

    await host.command(SWITCH);
    assert.equal(host.posted.length, 0, 'there is no page to message yet');
    assert.deepEqual(host.executed, ['envstash.panel.focus']);

    const startData = html => JSON.parse(/const __INITIAL__ = (.*);/.exec(html)[1]);
    assert.deepEqual(startData(host.html()).open, ids);
    assert.equal(startData(host.html()).open, undefined, 'only the first load after the pick, not every later one');
  });

  test('after the panel is closed, a pick is held for the next time it opens', async t => {
    const host = newHost(t);
    const ids = await host.seed('api', 'dev');
    host.view.dispose();
    host.pick = items => items[0];
    await host.command(SWITCH);
    assert.equal(host.lastPosted('openEnv'), undefined, 'nothing is sent to a page that no longer exists');
    assert.deepEqual(JSON.parse(/const __INITIAL__ = (.*);/.exec(host.html())[1]).open, ids);
  });
});

describe('variables', () => {
  test('adds, updates and deletes a variable', async t => {
    const host = newHost(t);
    const ids = await host.seed();
    await host.send({ type: 'saveVar', ...ids, var: { id: 'v1', key: ' API_KEY ', value: 'one' } });
    assert.deepEqual(host.vars(ids.projectId, ids.envId), [{ id: 'v1', key: 'API_KEY', value: 'one' }]);

    await host.send({ type: 'saveVar', ...ids, var: { id: 'v1', key: 'API_KEY', value: 'two' } });
    assert.deepEqual(host.vars(ids.projectId, ids.envId), [{ id: 'v1', key: 'API_KEY', value: 'two' }]);
    assert.deepEqual(host.lastPosted('vars').data, host.vars(ids.projectId, ids.envId));

    await host.send({ type: 'deleteVar', ...ids, varId: 'v1' });
    assert.deepEqual(host.vars(ids.projectId, ids.envId), []);
    assert.deepEqual(host.lastPosted('vars').data, []);
  });

  test('rejects an empty key and a key that already exists', async t => {
    const host = newHost(t);
    const ids = await host.seed('api', 'dev', [['A', '1']]);
    await host.send({ type: 'saveVar', ...ids, var: { key: '  ', value: 'x' } });
    await host.send({ type: 'saveVar', ...ids, var: { key: 'A', value: 'other' } });
    assert.deepEqual(host.errors, ['EnvStash error: Variable key cannot be empty', 'EnvStash error: Key "A" already exists']);
    assert.deepEqual(host.vars(ids.projectId, ids.envId).map(v => v.value), ['1']);
  });

  test('an update may rename the key, but not onto a key another variable uses', async t => {
    const host = newHost(t);
    const ids = await host.seed('api', 'dev', [['A', '1'], ['B', '2']]);
    const [a, b] = host.vars(ids.projectId, ids.envId);

    await host.send({ type: 'saveVar', ...ids, var: { id: b.id, key: 'C', value: '2' } });
    assert.deepEqual(host.vars(ids.projectId, ids.envId).map(v => v.key), ['A', 'C']);

    await host.send({ type: 'saveVar', ...ids, var: { id: b.id, key: 'A', value: '2' } });
    assert.equal(host.errors.at(-1), 'EnvStash error: Key "A" already exists');
    assert.deepEqual(host.vars(ids.projectId, ids.envId).map(v => v.key), ['A', 'C']);

    await host.send({ type: 'saveVar', ...ids, var: { id: a.id, key: 'A', value: 'changed' } });
    assert.equal(host.vars(ids.projectId, ids.envId)[0].value, 'changed', 'keeping its own key is not a duplicate');
  });

  test('keeps a value with newlines, quotes and unicode byte-for-byte', async t => {
    const host = newHost(t);
    const ids = await host.seed();
    const value = '-----BEGIN-----\n"quoted" \'single\' \\ $HOME ✓\n-----END-----';
    await host.send({ type: 'saveVar', ...ids, var: { key: 'CERT', value } });
    assert.equal(host.vars(ids.projectId, ids.envId)[0].value, value);
  });

  test('variables of one environment are invisible to another', async t => {
    const host = newHost(t);
    const a = await host.seed('a', 'dev', [['A', '1']]);
    const b = await host.seed('b', 'dev');
    await host.send({ type: 'getVars', ...b });
    assert.deepEqual(host.lastPosted('vars'), { type: 'vars', ...b, data: [] });
    assert.equal(host.vars(a.projectId, a.envId).length, 1);
  });

  test('bulk import adds new keys, updates existing ones and reports both', async t => {
    const host = newHost(t);
    const ids = await host.seed('api', 'dev', [['KEEP', 'k'], ['CHANGE', 'old']]);
    const changeId = host.vars(ids.projectId, ids.envId)[1].id;

    await host.send({ type: 'bulkImport', ...ids, text: '# c\nCHANGE=new\nexport ADDED="a b"\nbad-key=x' });

    const vars = host.vars(ids.projectId, ids.envId);
    assert.deepEqual(vars.map(v => [v.key, v.value]), [['KEEP', 'k'], ['CHANGE', 'new'], ['ADDED', 'a b']]);
    assert.equal(vars[1].id, changeId, 'an updated variable keeps its id');
    assert.equal(host.info.at(-1), '✓ Imported 1 new · 1 updated vars');
  });
});

describe('runbook and notes', () => {
  test('stores and returns the runbook', async t => {
    const host = newHost(t);
    const ids = await host.seed();
    await host.send({ type: 'getRunbook', ...ids });
    assert.deepEqual(host.lastPosted('runbook').data, { stages: [] });

    const data = { stages: [{ id: 's1', name: 'Start', commands: [{ id: 'c1', label: 'Run', cmd: 'npm start' }] }] };
    await host.send({ type: 'saveRunbook', ...ids, data });
    await host.send({ type: 'getRunbook', ...ids });
    assert.deepEqual(host.lastPosted('runbook').data, data);
  });

  test('rejects runbook data without stages', async t => {
    const host = newHost(t);
    const ids = await host.seed();
    await host.send({ type: 'saveRunbook', ...ids, data: {} });
    assert.equal(host.errors.at(-1), 'EnvStash error: Invalid runbook data');
  });

  test('stores notes as plain text under the original key', async t => {
    const host = newHost(t);
    const ids = await host.seed();
    await host.send({ type: 'getNotes', ...ids });
    assert.equal(host.lastPosted('notes').data, '');

    await host.send({ type: 'saveNotes', ...ids, notes: '# Title\n- [ ] todo' });
    // existing users' notes live under this exact key, as the raw string
    assert.equal(host.secrets.get(`envstash_note_${ids.projectId}_env_${ids.envId}`), '# Title\n- [ ] todo');
    await host.send({ type: 'getNotes', ...ids });
    assert.equal(host.lastPosted('notes').data, '# Title\n- [ ] todo');
  });
});

describe('message queue', () => {
  test('a read sent right after a slow save sees the saved value', async t => {
    const host = newHost(t);
    const ids = await host.seed();
    host.secretStoreDelay = 60;
    host.sendNoWait({ type: 'saveNotes', ...ids, notes: 'new' });
    host.sendNoWait({ type: 'getNotes', ...ids });
    await host.settle();
    assert.equal(host.lastPosted('notes').data, 'new');
  });

  test('two saves sent together are both applied, in order', async t => {
    const host = newHost(t);
    const ids = await host.seed();
    host.secretStoreDelay = 30;
    host.sendNoWait({ type: 'saveVar', ...ids, var: { key: 'A', value: '1' } });
    host.sendNoWait({ type: 'saveVar', ...ids, var: { key: 'B', value: '2' } });
    await host.settle();
    assert.deepEqual(host.vars(ids.projectId, ids.envId).map(v => v.key), ['A', 'B']);
  });

  test('a failing request does not block the ones behind it', async t => {
    const host = newHost(t);
    const ids = await host.seed();
    host.sendNoWait({ type: 'saveVar', ...ids, var: { key: '' } });
    host.sendNoWait({ type: 'saveVar', ...ids, var: { key: 'OK', value: '1' } });
    await host.settle();
    assert.equal(host.errors.length, 1);
    assert.deepEqual(host.vars(ids.projectId, ids.envId).map(v => v.key), ['OK']);
  });

  test('an open export dialog does not hold up saves', async t => {
    const host = newHost(t);
    const ids = await host.seed();
    let release;
    host.vscode.window.showInputBox = () => new Promise(resolve => { release = resolve; });

    const exporting = host.send({ type: 'exportAll' });
    await host.send({ type: 'saveNotes', ...ids, notes: 'typed while the prompt is open' });
    assert.equal(host.notes(ids.projectId, ids.envId), 'typed while the prompt is open');

    release(undefined);
    await exporting;
  });

  test('unknown message types are ignored', async t => {
    const host = newHost(t);
    await host.send({ type: 'doesNotExist' });
    await host.send({});
    assert.deepEqual(host.errors, []);
  });
});

describe('terminal', () => {
  test('runs a command in the active terminal', async t => {
    const host = newHost(t);
    const term = host.useTerminal('bash');
    await host.send({ type: 'runInTerminal', cmd: '  npm test  ' });
    assert.deepEqual(term.sent, ['npm test']);
    assert.equal(term.shown, 1);
  });

  test('creates an "EnvStash" terminal when none is open', async t => {
    const host = newHost(t);
    await host.send({ type: 'runInTerminal', cmd: 'ls' });
    assert.deepEqual(host.terminals.map(term => [term.name, term.sent]), [['EnvStash', ['ls']]]);
  });

  test('ignores an empty command', async t => {
    const host = newHost(t);
    const term = host.useTerminal('bash');
    await host.send({ type: 'runInTerminal', cmd: '   ' });
    assert.deepEqual(term.sent, []);
  });

  for (const [shell, expected] of [
    ['bash', 'export A="1" && export B="say \\"hi\\""'],
    ['PowerShell', '$env:A="1"; $env:B="say `"hi`""'],
    ['cmd', 'set A=1 && set B=say "hi"'],
  ]) {
    test(`"export-env" writes the variables in ${shell} syntax`, async t => {
      const host = newHost(t);
      const ids = await host.seed('api', 'dev', [['A', '1'], ['B', 'say "hi"']]);
      const term = host.useTerminal(shell);
      await host.send({ type: 'runInTerminal', ...ids, cmd: 'export-env' });
      assert.deepEqual(term.sent, [expected]);
    });
  }

  test('"export-env" with no variables warns instead of running', async t => {
    const host = newHost(t);
    const ids = await host.seed();
    const term = host.useTerminal('bash');
    await host.send({ type: 'runInTerminal', ...ids, cmd: 'export-env' });
    assert.deepEqual(term.sent, []);
    assert.deepEqual(host.warnings, ['No environment variables to export.']);
  });

  const runbook = { stages: [
    { id: 's1', name: 'Env', commands: [{ id: 'c1', label: 'env', cmd: 'export-env' }] },
    { id: 's2', name: 'Run', commands: [{ id: 'c2', label: 'i', cmd: 'npm i' }, { id: 'c3', label: 'blank', cmd: '  ' }, { id: 'c4', label: 's', cmd: 'npm start' }] },
  ] };

  test('"run playbook" chains every command so a failure stops the rest (bash)', async t => {
    const host = newHost(t);
    const ids = await host.seed('api', 'dev', [['A', '1']]);
    await host.send({ type: 'saveRunbook', ...ids, data: runbook });
    const term = host.useTerminal('bash');
    await host.send({ type: 'runAll', ...ids });
    assert.deepEqual(term.sent, ['export A="1" && npm i && npm start']);
  });

  test('"run playbook" chains every command so a failure stops the rest (PowerShell)', async t => {
    const host = newHost(t);
    const ids = await host.seed('api', 'dev', [['A', '1']]);
    await host.send({ type: 'saveRunbook', ...ids, data: runbook });
    const term = host.useTerminal('pwsh');
    await host.send({ type: 'runAll', ...ids });
    assert.deepEqual(term.sent, ['$env:A="1"; if ($?) { npm i }; if ($?) { npm start }']);
  });

  test('"run playbook" with nothing to run warns', async t => {
    const host = newHost(t);
    const ids = await host.seed();
    const term = host.useTerminal('bash');
    await host.send({ type: 'runAll', ...ids });
    assert.deepEqual(term.sent, []);
    assert.deepEqual(host.warnings, ['No commands in the playbook to run.']);
  });
});

describe('clipboard', () => {
  test('a copied secret is cleared after the configured delay', async t => {
    const host = newHost(t, { settings: { clipboardClearSeconds: 0.05 } });
    await host.send({ type: 'copy', text: 'export A=s3cret', label: '✓ A copied', secret: true });
    assert.equal(host.clipboard, 'export A=s3cret');
    assert.equal(host.info.at(-1), '✓ A copied · clipboard clears in 0.05s');
    await sleep(120);
    assert.equal(host.clipboard, '');
  });

  test('leaves the clipboard alone if the user copied something else meanwhile', async t => {
    const host = newHost(t, { settings: { clipboardClearSeconds: 0.05 } });
    await host.send({ type: 'copy', text: 'secret', secret: true });
    host.clipboard = 'user text';
    await sleep(120);
    assert.equal(host.clipboard, 'user text');
  });

  test('copies that are not secrets are never cleared', async t => {
    const host = newHost(t, { settings: { clipboardClearSeconds: 0.05 } });
    await host.send({ type: 'copy', text: 'npm start', label: '✓ Command copied' });
    await sleep(120);
    assert.equal(host.clipboard, 'npm start');
    assert.equal(host.info.at(-1), '✓ Command copied');
  });

  test('a later copy replaces the pending clear instead of being wiped by it', async t => {
    const host = newHost(t, { settings: { clipboardClearSeconds: 0.4 } });
    await host.send({ type: 'copy', text: 'first', secret: true });
    await sleep(200);
    await host.send({ type: 'copy', text: 'second', secret: true });
    await sleep(280);
    assert.equal(host.clipboard, 'second', 'the first timer must not clear the second copy early');
    await sleep(300);
    assert.equal(host.clipboard, '');
  });

  test('setting the delay to 0 turns clearing off', async t => {
    const host = newHost(t, { settings: { clipboardClearSeconds: 0 } });
    await host.send({ type: 'copy', text: 'secret', label: 'copied', secret: true });
    await sleep(60);
    assert.equal(host.clipboard, 'secret');
    assert.equal(host.info.at(-1), 'copied');
  });

  test('a pending secret is cleared when the extension shuts down', async () => {
    const host = createHost();
    await host.send({ type: 'copy', text: 'secret', secret: true });
    await host.ext.deactivate();
    assert.equal(host.clipboard, '');
  });

  test('copying nothing does nothing', async t => {
    const host = newHost(t);
    host.clipboard = 'before';
    await host.send({ type: 'copy', text: '' });
    assert.equal(host.clipboard, 'before');
    assert.deepEqual(host.info, []);
  });
});

describe('export and import', () => {
  async function exported(host, inputs, message = { type: 'exportAll' }) {
    host.inputs = [...inputs];
    await host.send(message);
    return host.files.get(host.savePath)?.toString('utf8');
  }
  async function populated(t) {
    const host = newHost(t);
    const ids = await host.seed('api', 'dev', [['API_KEY', 's3cret']]);
    await host.send({ type: 'saveNotes', ...ids, notes: 'my notes' });
    await host.send({ type: 'saveRunbook', ...ids, data: { stages: [{ id: 's', name: 'Start', commands: [] }] } });
    return { host, ids };
  }

  test('an encrypted export reveals nothing and restores everything on a new machine', async t => {
    const { host, ids } = await populated(t);
    const file = await exported(host, [PASS, PASS]);
    for (const leak of ['s3cret', 'API_KEY', 'my notes', 'api', 'Start']) assert.ok(!file.includes(leak), `leaked ${leak}`);
    assert.equal(host.info.at(-1), '✓ Exported to backup.json (encrypted)');

    const fresh = newHost(t);
    fresh.files.set(fresh.openPath, Buffer.from(file));
    fresh.inputs = [PASS];
    await fresh.send({ type: 'importFile', merge: true });

    assert.equal(fresh.info.at(-1), '✓ Imported 1 project(s), 1 environment(s)');
    assert.deepEqual(fresh.index(), host.index());
    assert.deepEqual(fresh.vars(ids.projectId, ids.envId), host.vars(ids.projectId, ids.envId));
    assert.equal(fresh.notes(ids.projectId, ids.envId), 'my notes');
    assert.deepEqual(fresh.runbook(ids.projectId, ids.envId), host.runbook(ids.projectId, ids.envId));
    assert.deepEqual(fresh.lastPosted('index').data, fresh.index(), 'the panel is refreshed after import');
  });

  test('the passphrase prompt hides its input and requires 8 characters', async t => {
    const { host } = await populated(t);
    await exported(host, [PASS, PASS]);
    const [first, confirm] = host.inputPrompts;
    assert.ok(first.password && confirm.password);
    assert.match(first.validateInput('short'), /at least 8/);
    assert.equal(first.validateInput('12345678'), undefined);
    assert.equal(first.validateInput(''), undefined, 'empty is allowed here; it leads to the plain-text warning');
  });

  test('mismatched passphrases write nothing', async t => {
    const { host } = await populated(t);
    assert.equal(await exported(host, [PASS, 'something else']), undefined);
    assert.equal(host.errors.at(-1), 'EnvStash error: Passphrases do not match');
  });

  test('cancelling at any step writes nothing', async t => {
    const { host } = await populated(t);
    assert.equal(await exported(host, [undefined]), undefined, 'first prompt');
    assert.equal(await exported(host, [PASS, undefined]), undefined, 'confirm prompt');
    host.savePath = undefined;
    await exported(host, [PASS, PASS]);
    assert.equal(host.files.size, 0, 'save dialog');
    assert.deepEqual(host.errors, []);
  });

  test('a plain-text export needs explicit confirmation', async t => {
    const { host } = await populated(t);
    assert.equal(await exported(host, ['']), undefined, 'declining the warning writes nothing');
    assert.deepEqual(host.warnings, ['Export without encryption?']);

    host.warningChoice = 'Export unencrypted';
    const bundle = JSON.parse(await exported(host, ['']));
    assert.equal(bundle.version, '1.0.0');
    assert.equal(bundle.projects[0].envs[0].vars[0].value, 's3cret');
    assert.equal(host.info.at(-1), '✓ Exported to backup.json (not encrypted)');
  });

  test('a wrong passphrase or a tampered file imports nothing', async t => {
    const { host } = await populated(t);
    const file = await exported(host, [PASS, PASS]);
    const fresh = newHost(t);

    fresh.files.set(fresh.openPath, Buffer.from(file));
    fresh.inputs = ['not the passphrase'];
    await fresh.send({ type: 'importFile', merge: true });

    const tampered = JSON.parse(file);
    tampered.data = Buffer.from('x' + Buffer.from(tampered.data, 'base64').toString('latin1'), 'latin1').toString('base64');
    fresh.files.set(fresh.openPath, Buffer.from(JSON.stringify(tampered)));
    fresh.inputs = [PASS];
    await fresh.send({ type: 'importFile', merge: true });

    assert.deepEqual(fresh.errors, Array(2).fill('EnvStash error: Wrong passphrase or corrupted backup file'));
    assert.deepEqual(fresh.index(), { projects: [] });
    assert.equal(fresh.secrets.size, 0);
  });

  test('cancelling the import passphrase or the file picker imports nothing', async t => {
    const { host } = await populated(t);
    const file = await exported(host, [PASS, PASS]);
    const fresh = newHost(t);
    fresh.files.set(fresh.openPath, Buffer.from(file));
    fresh.inputs = [undefined];
    await fresh.send({ type: 'importFile', merge: true });
    fresh.openPath = undefined;
    await fresh.send({ type: 'importFile', merge: true });
    assert.deepEqual(fresh.index(), { projects: [] });
    assert.deepEqual(fresh.errors, []);
  });

  test('backups made by older versions (plain JSON) still import with no prompt', async t => {
    const fresh = newHost(t);
    // the 1.1.1 file format, written out by hand so this test fails if the format ever drifts
    const legacy = {
      version: '1.0.0', exportedAt: '2026-07-03T00:00:00.000Z',
      projects: [{ id: 'p1', name: 'legacy', envs: [{
        id: 'e1', name: 'dev', color: '#4ec994',
        vars: [{ id: 'v1', key: 'OLD', value: 'value' }],
        runbook: { stages: [{ id: 's1', name: 'S', commands: [{ id: 'c1', label: 'l', cmd: 'echo hi' }] }] },
        notes: 'old notes',
      }] }],
    };
    fresh.files.set(fresh.openPath, Buffer.from(JSON.stringify(legacy)));
    await fresh.send({ type: 'importFile', merge: true });

    assert.equal(fresh.inputPrompts.length, 0);
    assert.deepEqual(fresh.vars('p1', 'e1'), legacy.projects[0].envs[0].vars);
    assert.deepEqual(fresh.runbook('p1', 'e1'), legacy.projects[0].envs[0].runbook);
    assert.equal(fresh.notes('p1', 'e1'), 'old notes');
  });

  test('importing merges into existing data instead of replacing it', async t => {
    const { host, ids } = await populated(t);
    await host.send({ type: 'saveVar', ...ids, var: { key: 'LOCAL_ONLY', value: 'mine' } });
    const incoming = { version: '1.0.0', projects: [{ id: ids.projectId, name: 'api', envs: [
      { id: ids.envId, name: 'dev', color: '#4ec994', vars: [{ key: 'API_KEY', value: 'from-backup' }, { key: 'NEW', value: 'n' }], runbook: { stages: [] } },
      { id: 'e-new', name: 'prod', color: '#f48771', vars: [{ key: 'P', value: '1' }], runbook: { stages: [] } },
    ] }] };
    host.files.set(host.openPath, Buffer.from(JSON.stringify(incoming)));
    await host.send({ type: 'importFile', merge: true });

    const vars = Object.fromEntries(host.vars(ids.projectId, ids.envId).map(v => [v.key, v.value]));
    assert.deepEqual(vars, { API_KEY: 'from-backup', LOCAL_ONLY: 'mine', NEW: 'n' });
    assert.equal(host.notes(ids.projectId, ids.envId), 'my notes', 'a backup without notes leaves notes alone');
    assert.equal(host.runbook(ids.projectId, ids.envId).stages.length, 1, 'an empty runbook in the backup leaves the runbook alone');
    assert.deepEqual(host.index().projects[0].envs.map(e => e.name), ['dev', 'prod']);
  });

  test('a backup from another machine matches projects and environments by name', async t => {
    const { host, ids } = await populated(t);
    const incoming = { version: '1.0.0', projects: [{ id: 'other-id', name: 'api', envs: [
      { id: 'other-env', name: 'dev', color: '#fff', vars: [{ key: 'ADDED', value: '1' }], runbook: { stages: [] } },
    ] }] };
    host.files.set(host.openPath, Buffer.from(JSON.stringify(incoming)));
    await host.send({ type: 'importFile', merge: true });

    assert.equal(host.index().projects.length, 1, 'no duplicate project');
    assert.equal(host.index().projects[0].envs.length, 1, 'no duplicate environment');
    assert.deepEqual(host.vars(ids.projectId, ids.envId).map(v => v.key), ['API_KEY', 'ADDED']);
  });

  test('rejects files that are not EnvStash backups', async t => {
    const host = newHost(t);
    for (const content of ['not json', '{"hello":"world"}', '{"projects":"nope"}', 'null']) {
      host.files.set(host.openPath, Buffer.from(content));
      await host.send({ type: 'importFile', merge: true });
    }
    assert.deepEqual(host.errors, [
      'EnvStash error: Invalid JSON file',
      'EnvStash error: Invalid EnvStash export file',
      'EnvStash error: Invalid EnvStash export file',
      'EnvStash error: Invalid EnvStash export file',
    ]);
    assert.deepEqual(host.index(), { projects: [] });
  });

  test('exporting one project leaves the others out and names the file after it', async t => {
    const { host, ids } = await populated(t);
    await host.seed('Other Project', 'dev', [['X', '1']]);
    let suggested;
    host.vscode.window.showSaveDialog = async opts => { suggested = opts.defaultUri.fsPath; return { fsPath: host.savePath }; };
    host.warningChoice = 'Export unencrypted';

    const bundle = JSON.parse(await exported(host, [''], { type: 'exportProject', projectId: ids.projectId }));
    assert.deepEqual(bundle.projects.map(p => p.name), ['api']);
    assert.equal(suggested, 'envstash-api.json');
  });

  test('the command palette commands export and import too', async t => {
    const { host } = await populated(t);
    host.inputs = [PASS, PASS];
    await host.command('envstash.exportAll');
    const file = host.files.get(host.savePath);
    assert.equal(JSON.parse(file.toString()).format, 'envstash-encrypted');

    const fresh = newHost(t);
    fresh.files.set(fresh.openPath, file);
    fresh.inputs = ['wrong one'];
    await fresh.command('envstash.importAll');
    assert.match(fresh.errors.at(-1), /Wrong passphrase/, 'errors from commands are shown, not thrown');
    fresh.inputs = [PASS];
    await fresh.command('envstash.importAll');
    assert.equal(fresh.index().projects[0].name, 'api');
  });
});

describe('webview page', () => {
  const cspOf = html => /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)[1];
  const nonceOf = html => /<script nonce="([^"]+)">/.exec(html)[1];

  test('only the nonce\'d script may run, and nothing is loaded from elsewhere', t => {
    const html = newHost(t).html();
    const csp = cspOf(html);
    assert.match(csp, /default-src 'none'/);
    assert.ok(csp.includes(`script-src 'nonce-${nonceOf(html)}'`));
    assert.ok(!/script-src[^;]*unsafe-inline/.test(csp) && !csp.includes('unsafe-eval'));
    assert.equal((html.match(/<script/g) || []).length, 1);
    assert.deepEqual(newHost(t).view.webview.options.localResourceRoots, []);
  });

  test('the nonce changes on every load', t => {
    const host = newHost(t);
    assert.notEqual(nonceOf(host.html()), nonceOf(host.html()));
  });

  test('no inline event handlers and no unfilled placeholders remain', t => {
    const html = newHost(t).html();
    assert.deepEqual(html.match(/<[^>]*\son[a-z]+\s*=/g), null);
    assert.ok(!/__CSP__|__NONCE__|PLACEHOLDER_|\$\{SVG\./.test(html));
  });

  test('stored names cannot break out of the page script', async t => {
    const host = newHost(t);
    await host.send({ type: 'createProject', name: '</script><script>alert(1)</script> ${SVG.lock} __NONCE__ $& $1' });
    const html = host.html();
    assert.equal((html.match(/<script/g) || []).length, 1);
    assert.equal((html.match(/<\/script>/g) || []).length, 1);
    assert.ok(html.includes('${SVG.lock} __NONCE__ $& $1'), 'the name is passed through untouched');
  });
});
