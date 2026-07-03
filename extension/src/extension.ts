import * as vscode from 'vscode';
import * as path   from 'path';
import * as fs     from 'fs';
import { SVG }     from './svgs';

// ── Data model ────────────────────────────────────────────────────
interface VaultIndex { projects: Project[]; }
interface Project    { id: string; name: string; envs: Env[]; }
interface Env        { id: string; name: string; color: string; }
interface EnvVar     { id: string; key: string; value: string; }
interface Runbook    { stages: Stage[]; }
interface Stage      { id: string; name: string; commands: Cmd[]; }
interface Cmd        { id: string; label: string; cmd: string; }

// Export bundle: everything in one JSON
interface ExportBundle {
  version: string;
  exportedAt: string;
  projects: Array<{
    id: string; name: string;
    envs: Array<{
      id: string; name: string; color: string;
      vars: EnvVar[];
      runbook: Runbook;
      notes?: string;
    }>;
  }>;
}

const INDEX_KEY = 'envstash_index';
const BUNDLE_VERSION = '1.0.0';

function envKey(pid: string, eid: string) { return `envstash_proj_${pid}_env_${eid}`; }
function runKey(pid: string, eid: string) { return `envstash_run_${pid}_env_${eid}`; }
function noteKey(pid: string, eid: string) { return `envstash_note_${pid}_env_${eid}`; }
function uid() { return Math.random().toString(36).slice(2, 10); }

// ── Safe JSON parse ───────────────────────────────────────────────
function safeJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new EnvStashProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('envstash.panel', provider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('envstash.open', () => {
      vscode.commands.executeCommand('workbench.view.extension.envstash');
    })
  );

  // Export all from command palette
  context.subscriptions.push(
    vscode.commands.registerCommand('envstash.exportAll', async () => {
      await provider.exportAll();
    })
  );

  // Import from command palette
  context.subscriptions.push(
    vscode.commands.registerCommand('envstash.importAll', async () => {
      await provider.importFromFile(true);
    })
  );
}

class EnvStashProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _secrets: vscode.SecretStorage;

  constructor(private readonly _ctx: vscode.ExtensionContext) {
    this._secrets = _ctx.secrets;
  }

  // ── Public: called from command palette ─────────────────────────
  async exportAll() {
    const bundle = await this._buildBundle(null);
    await this._writeBundle(bundle, 'envstash-all.json');
  }

  async importFromFile(merge: boolean) {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
      filters: { 'EnvStash JSON': ['json'] }, openLabel: 'Import'
    });
    if (!uris?.length) return;
    const raw = Buffer.from(await vscode.workspace.fs.readFile(uris[0])).toString('utf8');
    await this._applyBundle(raw, merge);
  }

  // ── Webview setup ───────────────────────────────────────────────
  async resolveWebviewView(wv: vscode.WebviewView) {
    this._view = wv;
    wv.webview.options = { enableScripts: true };
    wv.webview.html = this._getHtml();

    wv.webview.onDidReceiveMessage(async (msg) => {
      try {
        await this._handle(msg);
      } catch (err: any) {
        vscode.window.showErrorMessage(`EnvStash error: ${err.message}`);
      }
    });
  }

  private _post(msg: object) { this._view?.webview.postMessage(msg); }

  // ── Message router ──────────────────────────────────────────────
  private async _handle(msg: any) {
    switch (msg.type) {

      // INDEX
      case 'getIndex': {
        this._post({ type: 'index', data: await this._getIndex() });
        break;
      }

      // PROJECTS
      case 'createProject': {
        const name = (msg.name ?? '').trim();
        if (!name) throw new Error('Project name cannot be empty');
        const idx = await this._getIndex();
        if (idx.projects.some(p => p.name.toLowerCase() === name.toLowerCase()))
          throw new Error(`Project "${name}" already exists`);
        idx.projects.push({ id: uid(), name, envs: [] });
        await this._saveIndex(idx);
        this._post({ type: 'index', data: idx });
        break;
      }
      case 'renameProject': {
        const name = (msg.name ?? '').trim();
        if (!name) throw new Error('Project name cannot be empty');
        const idx = await this._getIndex();
        const dup = idx.projects.find(p => p.id !== msg.projectId && p.name.toLowerCase() === name.toLowerCase());
        if (dup) throw new Error(`Project "${name}" already exists`);
        const p = idx.projects.find(p => p.id === msg.projectId);
        if (p) { p.name = name; await this._saveIndex(idx); }
        this._post({ type: 'index', data: idx });
        break;
      }
      case 'deleteProject': {
        const idx = await this._getIndex();
        const p = idx.projects.find(p => p.id === msg.projectId);
        if (p) {
          for (const e of p.envs) {
            await this._secrets.delete(envKey(msg.projectId, e.id));
            await this._secrets.delete(runKey(msg.projectId, e.id));
            await this._secrets.delete(noteKey(msg.projectId, e.id));
          }
          idx.projects = idx.projects.filter(p => p.id !== msg.projectId);
          await this._saveIndex(idx);
        }
        this._post({ type: 'index', data: idx });
        break;
      }

      // ENVIRONMENTS
      case 'createEnv': {
        const name = (msg.name ?? '').trim();
        if (!name) throw new Error('Environment name cannot be empty');
        const idx = await this._getIndex();
        const p = idx.projects.find(p => p.id === msg.projectId);
        if (!p) throw new Error('Project not found');
        if (p.envs.some(e => e.name.toLowerCase() === name.toLowerCase()))
          throw new Error(`Environment "${name}" already exists in this project`);
        p.envs.push({ id: uid(), name, color: msg.color || '#4ec994' });
        await this._saveIndex(idx);
        this._post({ type: 'index', data: idx });
        break;
      }
      case 'renameEnv': {
        const name = (msg.name ?? '').trim();
        if (!name) throw new Error('Environment name cannot be empty');
        const idx = await this._getIndex();
        const p = idx.projects.find(p => p.id === msg.projectId);
        if (!p) throw new Error('Project not found');
        const dup = p.envs.find(e => e.id !== msg.envId && e.name.toLowerCase() === name.toLowerCase());
        if (dup) throw new Error(`Environment "${name}" already exists`);
        const e = p.envs.find(e => e.id === msg.envId);
        if (e) { e.name = name; e.color = msg.color || e.color; await this._saveIndex(idx); }
        this._post({ type: 'index', data: idx });
        break;
      }
      case 'deleteEnv': {
        const idx = await this._getIndex();
        const p = idx.projects.find(p => p.id === msg.projectId);
        if (p) {
          await this._secrets.delete(envKey(msg.projectId, msg.envId));
          await this._secrets.delete(runKey(msg.projectId, msg.envId));
          await this._secrets.delete(noteKey(msg.projectId, msg.envId));
          p.envs = p.envs.filter(e => e.id !== msg.envId);
          await this._saveIndex(idx);
        }
        this._post({ type: 'index', data: idx });
        break;
      }

      // VARS
      case 'getVars': {
        const vars = await this._getVars(msg.projectId, msg.envId);
        this._post({ type: 'vars', projectId: msg.projectId, envId: msg.envId, data: vars });
        break;
      }
      case 'saveVar': {
        if (!(msg.var?.key ?? '').trim()) throw new Error('Variable key cannot be empty');
        const vars = await this._getVars(msg.projectId, msg.envId);
        const ex = vars.find(v => v.id === msg.var.id);
        if (ex) { ex.key = msg.var.key.trim(); ex.value = msg.var.value ?? ''; }
        else {
          const dup = vars.find(v => v.key === msg.var.key.trim());
          if (dup) throw new Error(`Key "${msg.var.key.trim()}" already exists`);
          vars.push({ id: msg.var.id || uid(), key: msg.var.key.trim(), value: msg.var.value ?? '' });
        }
        await this._saveVars(msg.projectId, msg.envId, vars);
        this._post({ type: 'vars', projectId: msg.projectId, envId: msg.envId, data: vars });
        break;
      }
      case 'bulkImport': {
        const existing = await this._getVars(msg.projectId, msg.envId);
        const newVars: EnvVar[] = [];
        let updated = 0;
        const lines = ((msg.text as string) ?? '').split(/\r?\n/);
        const parsedVars: { key: string; value: string }[] = [];
        let currentKey: string | null = null;
        let currentValue = '';
        let inQuotes: '"' | "'" | null = null;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          if (currentKey !== null && inQuotes !== null) {
            const closingIdx = line.indexOf(inQuotes);
            if (closingIdx !== -1) {
              currentValue += '\n' + line.slice(0, closingIdx);
              const finalVal = inQuotes === '"' ? currentValue.replace(/\\n/g, '\n') : currentValue;
              parsedVars.push({ key: currentKey, value: finalVal });
              currentKey = null;
              currentValue = '';
              inQuotes = null;
            } else {
              currentValue += '\n' + line;
            }
            continue;
          }

          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;

          const eq = trimmed.indexOf('=');
          if (eq === -1) continue;

          let key = trimmed.slice(0, eq).trim();
          if (key.toLowerCase().startsWith('export ')) {
            key = key.slice(7).trim();
          }
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

          const rawVal = trimmed.slice(eq + 1).trim();
          if (rawVal.startsWith('"') || rawVal.startsWith("'")) {
            const q = rawVal[0] as '"' | "'";
            const closingIdx = rawVal.indexOf(q, 1);
            if (closingIdx !== -1) {
              const val = rawVal.slice(1, closingIdx);
              const finalVal = q === '"' ? val.replace(/\\n/g, '\n') : val;
              parsedVars.push({ key, value: finalVal });
            } else {
              currentKey = key;
              currentValue = rawVal.slice(1);
              inQuotes = q;
            }
          } else {
            let val = rawVal;
            const hashIdx = rawVal.indexOf('#');
            if (hashIdx !== -1) {
              val = rawVal.slice(0, hashIdx).trim();
            }
            parsedVars.push({ key, value: val });
          }
        }

        for (const { key, value } of parsedVars) {
          const exIdx = existing.findIndex(v => v.key === key);
          if (exIdx >= 0) {
            existing[exIdx].value = value;
            updated++;
          } else {
            newVars.push({ id: uid(), key, value });
          }
        }

        const merged = [...existing, ...newVars];
        await this._saveVars(msg.projectId, msg.envId, merged);
        this._post({ type: 'vars', projectId: msg.projectId, envId: msg.envId, data: merged });
        vscode.window.showInformationMessage(`✓ Imported ${newVars.length} new · ${updated} updated vars`);
        break;
      }
      case 'deleteVar': {
        const vars = await this._getVars(msg.projectId, msg.envId);
        await this._saveVars(msg.projectId, msg.envId, vars.filter(v => v.id !== msg.varId));
        this._post({ type: 'vars', projectId: msg.projectId, envId: msg.envId, data: vars.filter(v => v.id !== msg.varId) });
        break;
      }

      // RUNBOOK
      case 'getRunbook': {
        const rb = await this._getRunbook(msg.projectId, msg.envId);
        this._post({ type: 'runbook', projectId: msg.projectId, envId: msg.envId, data: rb });
        break;
      }
      case 'saveRunbook': {
        if (!msg.data?.stages) throw new Error('Invalid runbook data');
        await this._saveRunbook(msg.projectId, msg.envId, msg.data as Runbook);
        break;
      }
      case 'getNotes': {
        const notes = await this._getNotes(msg.projectId, msg.envId);
        this._post({ type: 'notes', projectId: msg.projectId, envId: msg.envId, data: notes });
        break;
      }
      case 'saveNotes': {
        await this._saveNotes(msg.projectId, msg.envId, msg.notes ?? '');
        break;
      }

      // CLIPBOARD / TERMINAL
      case 'copy': {
        const text = msg.text ?? '';
        if (!text) return;
        await vscode.env.clipboard.writeText(text);
        vscode.window.showInformationMessage(msg.label || '✓ Copied');
        break;
      }
      case 'runInTerminal': {
        let cmd = (msg.cmd ?? '').trim();
        if (!cmd) return;

        if (cmd === 'export-env' && msg.projectId && msg.envId) {
          const vars = await this._getVars(msg.projectId, msg.envId);
          if (vars.length > 0) {
            const term = vscode.window.activeTerminal ?? vscode.window.createTerminal('EnvStash');
            const shellType = detectShell(term);

            if (shellType === 'pwsh') {
              cmd = vars.map(v => `$env:${v.key}="${v.value.replace(/"/g, '`"')}"`).join('; ');
            } else if (shellType === 'cmd') {
              cmd = vars.map(v => `set ${v.key}=${v.value}`).join(' && ');
            } else {
              cmd = vars.map(v => `export ${v.key}="${v.value.replace(/"/g, '\\"')}"`).join(' && ');
            }
          } else {
            vscode.window.showWarningMessage('No environment variables to export.');
            return;
          }
        }

        const term = vscode.window.activeTerminal ?? vscode.window.createTerminal('EnvStash');
        term.show(true);
        term.sendText(cmd);
        break;
      }
      case 'runAll': {
        if (!msg.projectId || !msg.envId) return;
        const rb = await this._getRunbook(msg.projectId, msg.envId);
        const cmds: string[] = [];
        for (const stage of rb.stages) {
          for (const cmd of stage.commands) {
            const trimmed = cmd.cmd.trim();
            if (trimmed) {
              cmds.push(trimmed);
            }
          }
        }

        if (cmds.length === 0) {
          vscode.window.showWarningMessage('No commands in the playbook to run.');
          return;
        }

        const term = vscode.window.activeTerminal ?? vscode.window.createTerminal('EnvStash');
        const shellType = detectShell(term);

        const vars = await this._getVars(msg.projectId, msg.envId);
        let envCmd = '';
        if (vars.length > 0) {
          if (shellType === 'pwsh') {
            envCmd = vars.map(v => `$env:${v.key}="${v.value.replace(/"/g, '`"')}"`).join('; ');
          } else if (shellType === 'cmd') {
            envCmd = vars.map(v => `set ${v.key}=${v.value}`).join(' && ');
          } else {
            envCmd = vars.map(v => `export ${v.key}="${v.value.replace(/"/g, '\\"')}"`).join(' && ');
          }
        }

        const expandedCmds = cmds.map(c => {
          if (c === 'export-env') {
            return envCmd || 'echo "No environment variables to export"';
          }
          return c;
        });

        let finalCmd = '';
        if (shellType === 'pwsh') {
          finalCmd = expandedCmds.map((c, i) => i === 0 ? c : `if ($?) { ${c} }`).join('; ');
        } else if (shellType === 'cmd') {
          finalCmd = expandedCmds.join(' && ');
        } else {
          finalCmd = expandedCmds.join(' && ');
        }

        term.show(true);
        term.sendText(finalCmd);
        break;
      }

      // IMPORT / EXPORT (from webview)
      case 'exportProject': {
        const bundle = await this._buildBundle(msg.projectId);
        const idx = await this._getIndex();
        const p = idx.projects.find(p => p.id === msg.projectId);
        const fname = `envstash-${(p?.name ?? 'project').replace(/[^a-z0-9]/gi, '-').toLowerCase()}.json`;
        await this._writeBundle(bundle, fname);
        break;
      }
      case 'exportAll': {
        const bundle = await this._buildBundle(null);
        await this._writeBundle(bundle, 'envstash-all.json');
        break;
      }
      case 'importFile': {
        await this.importFromFile(msg.merge ?? true);
        const idx = await this._getIndex();
        this._post({ type: 'index', data: idx });
        break;
      }
    }
  }

  // ── Storage helpers ─────────────────────────────────────────────
  private _getIndex(): VaultIndex {
    return safeJson(this._ctx.globalState.get<string>(INDEX_KEY), { projects: [] });
  }
  private async _saveIndex(i: VaultIndex) {
    await this._ctx.globalState.update(INDEX_KEY, JSON.stringify(i));
  }
  private async _getVars(pid: string, eid: string): Promise<EnvVar[]> {
    return safeJson(await this._secrets.get(envKey(pid, eid)), []);
  }
  private async _saveVars(pid: string, eid: string, vars: EnvVar[]) {
    await this._secrets.store(envKey(pid, eid), JSON.stringify(vars));
  }
  private async _getRunbook(pid: string, eid: string): Promise<Runbook> {
    return safeJson(await this._secrets.get(runKey(pid, eid)), { stages: [] });
  }
  private async _saveRunbook(pid: string, eid: string, rb: Runbook) {
    await this._secrets.store(runKey(pid, eid), JSON.stringify(rb));
  }
  private async _getNotes(pid: string, eid: string): Promise<string> {
    return await this._secrets.get(noteKey(pid, eid)) ?? '';
  }
  private async _saveNotes(pid: string, eid: string, notes: string) {
    await this._secrets.store(noteKey(pid, eid), notes);
  }

  // ── Export / Import ─────────────────────────────────────────────
  private async _buildBundle(projectId: string | null): Promise<ExportBundle> {
    const idx = await this._getIndex();
    const projects = projectId ? idx.projects.filter(p => p.id === projectId) : idx.projects;
    const result: ExportBundle['projects'] = [];
    for (const p of projects) {
      const envs = [];
      for (const e of p.envs) {
        envs.push({
          id: e.id, name: e.name, color: e.color,
          vars:    await this._getVars(p.id, e.id),
          runbook: await this._getRunbook(p.id, e.id),
          notes:   await this._getNotes(p.id, e.id),
        });
      }
      result.push({ id: p.id, name: p.name, envs });
    }
    return { version: BUNDLE_VERSION, exportedAt: new Date().toISOString(), projects: result };
  }

  private async _writeBundle(bundle: ExportBundle, fname: string) {
    const json = JSON.stringify(bundle, null, 2);
    const uris = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(fname),
      filters: { 'EnvStash JSON': ['json'] },
      saveLabel: 'Export'
    });
    if (!uris) return;
    await vscode.workspace.fs.writeFile(uris, Buffer.from(json, 'utf8'));
    vscode.window.showInformationMessage(`✓ Exported to ${path.basename(uris.fsPath)}`);
  }

  private async _applyBundle(raw: string, merge: boolean) {
    let bundle: ExportBundle;
    try { bundle = JSON.parse(raw); } catch { throw new Error('Invalid JSON file'); }
    if (!bundle.projects || !Array.isArray(bundle.projects)) throw new Error('Invalid EnvStash export file');

    const idx = await this._getIndex();
    let imported = 0;

    for (const bp of bundle.projects) {
      if (!bp.name?.trim()) continue;
      let proj = idx.projects.find(p => p.id === bp.id) ?? idx.projects.find(p => p.name === bp.name);
      if (!proj) {
        proj = { id: bp.id || uid(), name: bp.name.trim(), envs: [] };
        idx.projects.push(proj);
      }
      for (const be of (bp.envs ?? [])) {
        if (!be.name?.trim()) continue;
        let env = proj.envs.find(e => e.id === be.id) ?? proj.envs.find(e => e.name === be.name);
        if (!env) {
          env = { id: be.id || uid(), name: be.name.trim(), color: be.color || '#4ec994' };
          proj.envs.push(env);
        }
        if (be.vars?.length) {
          const existing = merge ? await this._getVars(proj.id, env.id) : [];
          const merged = [...existing];
          for (const v of be.vars) {
            if (!v.key?.trim()) continue;
            const exIdx = merged.findIndex(m => m.key === v.key);
            if (exIdx >= 0) merged[exIdx].value = v.value ?? '';
            else merged.push({ id: v.id || uid(), key: v.key.trim(), value: v.value ?? '' });
          }
          await this._saveVars(proj.id, env.id, merged);
        }
        if (be.runbook?.stages?.length) {
          await this._saveRunbook(proj.id, env.id, be.runbook);
        }
        if (be.notes) {
          await this._saveNotes(proj.id, env.id, be.notes);
        }
        imported++;
      }
    }
    await this._saveIndex(idx);
    this._post({ type: 'index', data: idx });
    vscode.window.showInformationMessage(`✓ Imported ${bundle.projects.length} project(s), ${imported} environment(s)`);
  }

  // ── HTML ─────────────────────────────────────────────────────────
  private _getHtml(): string {
    const htmlPath = path.join(this._ctx.extensionPath, 'webview', 'index.html');
    const cssPath = path.join(this._ctx.extensionPath, 'webview', 'style.css');
    const jsPath = path.join(this._ctx.extensionPath, 'webview', 'script.js');

    let html = fs.readFileSync(htmlPath, 'utf8');
    const css = fs.readFileSync(cssPath, 'utf8');
    const js = fs.readFileSync(jsPath, 'utf8');

    html = html.replace('/*PLACEHOLDER_CSS*/', () => css);
    const initialData = `const __INITIAL_INDEX__ = ${JSON.stringify(this._getIndex())};`;
    html = html.replace('/*PLACEHOLDER_JS*/', () => initialData + '\n' + js);

    // Replace SVG placeholders
    const htmlWithSvg = html.replace(/\$\{SVG\.([a-zA-Z_]+)\}/g, (_, name) => {
      const s = (SVG as Record<string, string>)[name];
      return s ?? '';
    });

    return htmlWithSvg;
  }
}

function detectShell(term: vscode.Terminal): 'pwsh' | 'cmd' | 'bash' {
  const name = term.name.toLowerCase();
  if (name.includes('powershell') || name.includes('pwsh')) {
    return 'pwsh';
  }
  if (name.includes('cmd')) {
    return 'cmd';
  }
  if (name.includes('bash') || name.includes('zsh') || name.includes('sh') || name.includes('fish')) {
    return 'bash';
  }

  const opt = term.creationOptions as vscode.TerminalOptions;
  if (opt?.shellPath) {
    const shellPath = opt.shellPath.toLowerCase();
    if (shellPath.includes('powershell') || shellPath.includes('pwsh') || shellPath.includes('powershell.exe') || shellPath.includes('pwsh.exe')) {
      return 'pwsh';
    }
    if (shellPath.includes('cmd.exe')) {
      return 'cmd';
    }
    if (shellPath.includes('bash') || shellPath.includes('zsh') || shellPath.includes('sh') || shellPath.includes('fish')) {
      return 'bash';
    }
  }

  if (process.platform === 'win32') {
    if (process.env.SHELL && (process.env.SHELL.includes('bash') || process.env.SHELL.includes('zsh'))) {
      return 'bash';
    }
    return 'pwsh';
  }
  return 'bash';
}

export function deactivate() {}
