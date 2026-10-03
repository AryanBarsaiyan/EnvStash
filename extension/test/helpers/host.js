'use strict';
// Runs the compiled extension (out/extension.js) against an in-memory stand-in for the vscode API.
const Module = require('module');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const EXT = path.join(ROOT, 'out', 'extension.js');

function loadExtension(vscode) {
  const original = Module._load;
  Module._load = (request, ...rest) => request === 'vscode' ? vscode : original(request, ...rest);
  try {
    // a fresh copy per host, so module-level state never leaks between tests
    const out = path.join(ROOT, 'out') + path.sep;
    for (const file of Object.keys(require.cache)) if (file.startsWith(out)) delete require.cache[file];
    return require(EXT);
  } finally {
    Module._load = original;
  }
}

/**
 * Creates an isolated "VS Code" with EnvStash activated in it.
 *
 *   const host = createHost();
 *   await host.send({ type: 'createProject', name: 'api' });
 *   host.index().projects   // -> [{ name: 'api', ... }]
 */
function createHost(options = {}) {
  const host = {
    secrets: new Map(),        // vscode.SecretStorage
    globalState: new Map(),    // context.globalState
    files: new Map(),          // path -> Buffer, written/read through workspace.fs
    settings: { ...options.settings },
    clipboard: '',
    inputs: [],                // answers for showInputBox, in order (undefined = cancelled)
    inputPrompts: [],
    warningChoice: undefined,  // button "clicked" on modal warnings
    savePath: path.join(ROOT, 'backup.json'),   // undefined = dialog cancelled
    openPath: path.join(ROOT, 'backup.json'),
    info: [], errors: [], warnings: [],
    posted: [],                // every message sent to the webview
    onPost: null,              // set by the panel helper to deliver messages into the DOM
    terminals: [],
    activeTerminal: undefined,
    secretStoreDelay: 0,       // ms; makes writes slow to expose ordering bugs
  };

  const makeTerminal = (name, creationOptions = {}) => {
    const term = { name, creationOptions, sent: [], shown: 0, show() { this.shown++; }, sendText(t) { this.sent.push(t); } };
    host.terminals.push(term);
    return term;
  };
  host.useTerminal = (name, creationOptions) => (host.activeTerminal = makeTerminal(name, creationOptions));

  const vscode = {
    Uri: { file: fsPath => ({ fsPath }) },
    window: {
      get activeTerminal() { return host.activeTerminal; },
      createTerminal: name => makeTerminal(name),
      registerWebviewViewProvider: (_id, provider) => { host.provider = provider; return { dispose() {} }; },
      showInputBox: async opts => {
        host.inputPrompts.push(opts);
        const value = host.inputs.shift();
        // behave like the real box: an invalid value can't be submitted
        if (value !== undefined && opts?.validateInput) {
          const problem = opts.validateInput(value);
          if (problem) throw new Error(`test supplied an input VS Code would reject: ${problem}`);
        }
        return value;
      },
      showWarningMessage: async message => { host.warnings.push(message); return host.warningChoice; },
      showInformationMessage: message => { host.info.push(message); },
      showErrorMessage: message => { host.errors.push(message); },
      showSaveDialog: async () => host.savePath ? { fsPath: host.savePath } : undefined,
      showOpenDialog: async () => host.openPath ? [{ fsPath: host.openPath }] : undefined,
    },
    commands: {
      registered: {},
      registerCommand(id, fn) { this.registered[id] = fn; return { dispose() {} }; },
      executeCommand: async () => {},
    },
    workspace: {
      fs: {
        writeFile: async (uri, bytes) => { host.files.set(uri.fsPath, Buffer.from(bytes)); },
        readFile: async uri => {
          if (!host.files.has(uri.fsPath)) throw new Error('file not found');
          return host.files.get(uri.fsPath);
        },
      },
      getConfiguration: () => ({ get: (key, fallback) => key in host.settings ? host.settings[key] : fallback }),
    },
    env: {
      clipboard: {
        writeText: async text => { host.clipboard = text; },
        readText: async () => host.clipboard,
      },
    },
  };

  const context = {
    extensionPath: ROOT,
    subscriptions: [],
    secrets: {
      get: async key => host.secrets.get(key),
      store: async (key, value) => {
        if (host.secretStoreDelay) await sleep(host.secretStoreDelay);
        host.secrets.set(key, value);
      },
      delete: async key => { host.secrets.delete(key); },
    },
    globalState: {
      get: key => host.globalState.get(key),
      update: async (key, value) => { host.globalState.set(key, value); },
    },
  };

  host.vscode = vscode;
  host.ext = loadExtension(vscode);
  host.ext.activate(context);

  let listener;
  const view = {
    webview: {
      options: {}, html: '',
      postMessage: message => { host.posted.push(message); if (host.onPost) host.onPost(message); },
      onDidReceiveMessage: fn => { listener = fn; },
    },
  };
  host.view = view;

  /** (Re)opens the panel and returns the HTML the webview would load. */
  host.html = () => { host.provider.resolveWebviewView(view); return view.webview.html; };
  host.html();

  /** Delivers a webview message and resolves once the extension has finished handling it. */
  host.send = message => listener(message);
  /** Delivers without waiting: for tests about ordering. */
  host.sendNoWait = message => { listener(message); };
  /** Resolves when everything queued so far has been handled. */
  host.settle = async () => { for (let i = 0; i < 3; i++) { await sleep(0); await host.provider.queue.idle(); } };

  host.command = (id, ...args) => vscode.commands.registered[id](...args);
  host.index = () => JSON.parse(host.globalState.get('envstash_index') || '{"projects":[]}');
  host.lastPosted = type => [...host.posted].reverse().find(m => m.type === type);
  host.vars = (pid, eid) => JSON.parse(host.secrets.get(`envstash_proj_${pid}_env_${eid}`) || '[]');
  host.runbook = (pid, eid) => JSON.parse(host.secrets.get(`envstash_run_${pid}_env_${eid}`) || '{"stages":[]}');
  host.notes = (pid, eid) => host.secrets.get(`envstash_note_${pid}_env_${eid}`);

  /** Creates a project with one environment and returns their ids. */
  host.seed = async (projectName = 'api', envName = 'dev', vars = []) => {
    await host.send({ type: 'createProject', name: projectName });
    const project = host.index().projects.find(p => p.name === projectName);
    await host.send({ type: 'createEnv', projectId: project.id, name: envName, color: '#4ec994' });
    const env = host.index().projects.find(p => p.id === project.id).envs.find(e => e.name === envName);
    for (const [key, value] of vars) {
      await host.send({ type: 'saveVar', projectId: project.id, envId: env.id, var: { key, value } });
    }
    return { projectId: project.id, envId: env.id };
  };

  /** Stops pending timers (clipboard clear) so the test process can exit. */
  host.close = () => host.ext.deactivate();
  return host;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(condition, { timeout = 3000, message = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${message}`);
    await sleep(10);
  }
}

module.exports = { createHost, sleep, until, ROOT };
