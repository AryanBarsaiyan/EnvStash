import * as vscode from 'vscode';
import * as path   from 'path';

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
    }>;
  }>;
}

const INDEX_KEY = 'envstash_index';
const BUNDLE_VERSION = '1.0.0';

function envKey(pid: string, eid: string) { return `envstash_proj_${pid}_env_${eid}`; }
function runKey(pid: string, eid: string) { return `envstash_run_${pid}_env_${eid}`; }
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
        for (const line of ((msg.text as string) ?? '').split('\n')) {
          const t = line.trim();
          if (!t || t.startsWith('#')) continue;
          const eq = t.indexOf('=');
          if (eq === -1) continue;
          const key   = t.slice(0, eq).trim().replace(/^export\s+/i, '');
          const value = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
          if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
          const exIdx = existing.findIndex(v => v.key === key);
          if (exIdx >= 0) { existing[exIdx].value = value; updated++; }
          else newVars.push({ id: uid(), key, value });
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

      // CLIPBOARD / TERMINAL
      case 'copy': {
        const text = msg.text ?? '';
        if (!text) return;
        await vscode.env.clipboard.writeText(text);
        vscode.window.showInformationMessage(msg.label || '✓ Copied');
        break;
      }
      case 'runInTerminal': {
        const cmd = (msg.cmd ?? '').trim();
        if (!cmd) return;
        const term = vscode.window.activeTerminal ?? vscode.window.createTerminal('EnvStash');
        term.show(true);
        term.sendText(cmd);
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
  private async _getIndex(): Promise<VaultIndex> {
    return safeJson(await this._secrets.get(INDEX_KEY), { projects: [] });
  }
  private async _saveIndex(i: VaultIndex) {
    await this._secrets.store(INDEX_KEY, JSON.stringify(i));
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
        imported++;
      }
    }
    await this._saveIndex(idx);
    this._post({ type: 'index', data: idx });
    vscode.window.showInformationMessage(`✓ Imported ${bundle.projects.length} project(s), ${imported} environment(s)`);
  }

  // ── HTML ─────────────────────────────────────────────────────────
  private _getHtml(): string { return HTML; }
}

const SVG = {
  lock:     `<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  folder:   `<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
  chevron:  `<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>`,
  plus:     `<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  plusSm:   `<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  edit:     `<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  editSm:   `<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  trash:    `<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  xSm:      `<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  key:      `<svg viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>`,
  eye:      `<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  eyeOff:   `<svg viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
  copy:     `<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  file:     `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  upload:   `<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  download: `<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  export:   `<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  replace:  `<svg viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/></svg>`,
  back:     `<svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>`,
  play:     `<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
  terminal: `<svg viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
  menu:     `<svg class="menu-svg" viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`,
  check:    `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`,
  x_:       `<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
};
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>EnvStash</title>
<style>
/* ── Reset & tokens ──────────────────────────────────────────── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{
  height:100%;
  font-family:var(--vscode-font-family,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif);
  font-size:14px;
  color:var(--vscode-foreground);
  background:var(--vscode-sideBar-background,#f3f3f3);
  -webkit-font-smoothing:antialiased;
}
/* Adaptive color tokens that work on both dark + light */
:root{
  --ev-accent:#00897b;
  --ev-accent-dim:rgba(0,137,123,0.12);
  --ev-accent-border:rgba(0,137,123,0.35);
  --ev-red:#d32f2f;
  --ev-red-dim:rgba(211,47,47,0.10);
  --ev-surface:var(--vscode-input-background,rgba(0,0,0,0.04));
  --ev-card:var(--vscode-editor-background,#fff);
  --ev-border:var(--vscode-widget-border,var(--vscode-panel-border,rgba(128,128,128,0.25)));
  --ev-border2:var(--vscode-widget-border,var(--vscode-panel-border,rgba(128,128,128,0.15)));
  --ev-muted:var(--vscode-icon-foreground,var(--vscode-descriptionForeground,#888));
  --ev-hover:var(--vscode-list-hoverBackground,rgba(0,0,0,0.05));
  --ev-header:var(--vscode-sideBarSectionHeader-background,rgba(0,0,0,0.04));
  --ev-badge:var(--vscode-badge-background,rgba(0,0,0,0.08));
  --ev-shadow:0 1px 4px rgba(0,0,0,0.10);
  --ev-radius:7px;
  --ev-radius-sm:5px;
}

/* ── Layout ────────────────────────────────────────────────── */
.app{display:flex;flex-direction:column;height:100vh;overflow:hidden}
.screen{display:none;flex-direction:column;flex:1;min-height:0;overflow:hidden}
.screen.active{display:flex}

/* ── Topbar ────────────────────────────────────────────────── */
.topbar{
  display:flex;align-items:center;gap:6px;
  padding:9px 12px;
  border-bottom:1px solid var(--ev-border);
  flex-shrink:0;
  background:var(--ev-header);
}
.topbar-logo{display:flex;align-items:center;gap:7px;flex:1;min-width:0}
.topbar-logo svg{width:16px;height:16px;fill:none;stroke:var(--ev-accent);stroke-width:2.2;flex-shrink:0}
.topbar-title{
  font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;
  color:var(--vscode-sideBarTitle-foreground,var(--vscode-foreground));
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.topbar-author{font-size:9px;color:var(--ev-muted);letter-spacing:0.03em;flex-shrink:0}

.icon-btn{
  display:flex;align-items:center;justify-content:center;
  width:26px;height:26px;border-radius:var(--ev-radius-sm);
  background:none;border:none;cursor:pointer;
  color:var(--ev-muted);
  transition:background 0.12s,color 0.12s;flex-shrink:0;
}
.icon-btn:hover{background:var(--ev-hover);color:var(--vscode-foreground)}
.icon-btn svg{width:15px;height:15px;display:block;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.icon-btn svg.menu-svg{fill:currentColor;stroke:none}

.topbar-btn{
  display:inline-flex;align-items:center;gap:5px;
  padding:4px 8px;border-radius:var(--ev-radius-sm);
  background:none;border:1px solid var(--ev-border);
  color:var(--ev-muted);font-size:11px;font-weight:600;
  cursor:pointer;font-family:inherit;transition:all 0.1s;
}
.topbar-btn:hover{
  background:var(--ev-hover);color:var(--vscode-foreground);
  border-color:var(--ev-accent);
}
.topbar-btn svg{
  width:12px;height:12px;display:block;fill:none;stroke:currentColor;
  stroke-width:2;stroke-linecap:round;stroke-linejoin:round;
}

/* ── Scroll container ──────────────────────────────────────── */
.scroll{flex:1;overflow-y:auto;padding:8px 0 16px}

/* ── Project cards ─────────────────────────────────────────── */
.proj-card{
  margin:3px 10px 6px;
  background:var(--ev-card);
  border:1px solid var(--ev-border);
  border-radius:var(--ev-radius);
  box-shadow:var(--ev-shadow);
  overflow:hidden;
  transition:border-color 0.15s;
}
.proj-card:hover{border-color:var(--ev-accent-border)}

.proj-row{
  display:flex;align-items:center;gap:8px;
  padding:9px 12px;cursor:pointer;user-select:none;
  transition:background 0.1s;
}
.proj-row:hover{background:var(--ev-hover)}

.proj-chevron{
  width:14px;height:14px;flex-shrink:0;
  color:var(--ev-muted);transition:transform 0.18s;
  display:flex;align-items:center;justify-content:center;
}
.proj-chevron.open{transform:rotate(90deg)}
.proj-chevron svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}

.proj-icon{width:18px;height:18px;flex-shrink:0;color:var(--ev-muted)}
.proj-icon svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}

.proj-name{
  flex:1;font-size:13px;font-weight:600;
  color:var(--vscode-foreground);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.proj-badge{
  font-size:10px;color:var(--ev-muted);
  background:var(--ev-badge);
  padding:1px 7px;border-radius:10px;flex-shrink:0;
}
.proj-acts{display:flex;gap:1px;flex-shrink:0;opacity:0.75;transition:opacity 0.12s}
.proj-row:hover .proj-acts, .proj-acts:hover{opacity:1}

.row-btn{
  display:flex;align-items:center;justify-content:center;
  width:24px;height:24px;border-radius:4px;
  background:none;border:none;cursor:pointer;
  color:var(--ev-muted);transition:all 0.1s;
}
.row-btn:hover{background:var(--ev-hover);color:var(--vscode-foreground)}
.row-btn.danger:hover{color:var(--ev-red);background:var(--ev-red-dim)}
.row-btn svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;display:block}

/* ── Env pills ─────────────────────────────────────────────── */
.env-area{display:none;padding:2px 12px 10px 32px;border-top:1px solid var(--ev-border2)}
.env-area.open{display:block}
.env-pills{display:flex;flex-wrap:wrap;gap:5px;padding-top:8px}

.env-pill{
  display:inline-flex;align-items:center;gap:4px;
  padding:4px 11px;border-radius:20px;
  font-size:12px;font-weight:600;cursor:pointer;
  border:1px solid transparent;transition:all 0.15s;white-space:nowrap;
}
.env-pill:hover{filter:brightness(1.1);transform:translateY(-1px);box-shadow:0 2px 6px rgba(0,0,0,0.15)}
.env-pill.sel{box-shadow:0 0 0 2px currentColor}

.pill-acts{display:flex;gap:1px;opacity:0.75;transition:opacity 0.12s;margin-left:2px}
.env-pill:hover .pill-acts, .pill-acts:hover{opacity:1}
.pill-btn{
  background:none;border:none;cursor:pointer;
  padding:0 2px;color:currentColor;opacity:0.65;
  border-radius:3px;display:flex;align-items:center;transition:opacity 0.1s;
}
.pill-btn:hover{opacity:1}
.pill-btn svg{width:10px;height:10px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;display:block}

.add-env-btn{
  display:inline-flex;align-items:center;gap:4px;
  padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600;
  color:var(--ev-muted);
  border:1.5px dashed var(--ev-border);
  cursor:pointer;background:none;
  transition:all 0.15s;font-family:inherit;
}
.add-env-btn:hover{color:var(--ev-accent);border-color:var(--ev-accent-border);background:var(--ev-accent-dim)}
.add-env-btn svg{width:11px;height:11px;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round}

/* ── Create project / add stage buttons ─────────────────────── */
.dashed-btn{
  display:flex;align-items:center;justify-content:center;gap:7px;
  margin:4px 10px 6px;padding:10px 14px;
  border-radius:var(--ev-radius);background:none;
  border:1.5px dashed var(--ev-border);
  color:var(--ev-muted);
  font-size:13px;font-weight:600;cursor:pointer;
  transition:all 0.15s;font-family:inherit;width:calc(100% - 20px);
}
.dashed-btn:hover{border-color:var(--ev-accent);color:var(--ev-accent);background:var(--ev-accent-dim)}
.dashed-btn svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round}

/* ── Empty states ──────────────────────────────────────────── */
.empty{
  display:flex;flex-direction:column;align-items:center;
  justify-content:center;flex:1;gap:10px;
  padding:32px 20px;text-align:center;
}
.empty-ico{opacity:0.55;margin-bottom:2px}
.empty-ico svg{width:40px;height:40px;fill:none;stroke:currentColor;stroke-width:1.2}
.empty-h{font-size:14px;font-weight:600;color:var(--vscode-foreground);opacity:0.6}
.empty-p{font-size:12px;color:var(--ev-muted);line-height:1.6;max-width:220px}

/* ── Env screen ─────────────────────────────────────────────── */
.env-topbar{
  display:flex;align-items:center;gap:7px;
  padding:9px 12px;
  border-bottom:1px solid var(--ev-border);
  flex-shrink:0;background:var(--ev-header);
}
.env-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.env-title{font-size:13px;font-weight:700;flex:1;color:var(--vscode-foreground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bc{display:flex;align-items:center;gap:4px;padding:5px 12px 3px;font-size:11px;color:var(--ev-muted);flex-shrink:0}
.bc-link{cursor:pointer;color:var(--ev-accent)}
.bc-link:hover{text-decoration:underline}
.bc-sep{opacity:0.4}
.bc-cur{color:var(--vscode-foreground);font-weight:600}

/* ── Tabs ───────────────────────────────────────────────────── */
.tabs{display:flex;border-bottom:1px solid var(--ev-border);flex-shrink:0;background:var(--ev-header)}
.tab{
  padding:7px 14px;font-size:12px;font-weight:600;
  color:var(--ev-muted);background:none;border:none;
  cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;
  transition:all 0.12s;font-family:inherit;white-space:nowrap;display:flex;align-items:center;gap:5px;
}
.tab svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.tab.active{color:var(--vscode-foreground);border-bottom-color:var(--ev-accent)}
.tab:hover:not(.active){color:var(--vscode-foreground)}

/* ── Var list ───────────────────────────────────────────────── */
.var-list{flex:1;overflow-y:auto}
.var-row{
  display:grid;grid-template-columns:1fr auto auto auto auto;
  align-items:center;gap:7px;padding:8px 12px;
  border-bottom:1px solid var(--ev-border2);
  transition:background 0.1s;
}
.var-row:hover{background:var(--ev-hover)}
.var-key{
  font-family:var(--vscode-editor-font-family,'SF Mono','Fira Code',monospace);
  font-size:12px;font-weight:700;
  color:var(--ev-accent);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.var-val{
  font-family:var(--vscode-editor-font-family,'SF Mono','Fira Code',monospace);
  font-size:11px;color:var(--ev-muted);
  letter-spacing:0.05em;text-align:right;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px;
}
.var-val.shown{color:var(--vscode-foreground);letter-spacing:normal}
.vbtn{
  display:flex;align-items:center;justify-content:center;
  width:24px;height:24px;border-radius:4px;
  background:none;border:none;cursor:pointer;
  color:var(--ev-muted);transition:all 0.1s;flex-shrink:0;
}
.vbtn:hover{background:var(--ev-hover);color:var(--vscode-foreground)}
.vbtn.danger:hover{color:var(--ev-red);background:var(--ev-red-dim)}
.vbtn svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;display:block}

.reveal-btn{
  display:flex;align-items:center;gap:4px;
  padding:4px 9px;border-radius:var(--ev-radius-sm);
  background:none;border:1px solid var(--ev-border);
  color:var(--ev-muted);font-size:11px;cursor:pointer;font-family:inherit;
  transition:all 0.12s;flex-shrink:0;
}
.reveal-btn:hover{color:var(--vscode-foreground);border-color:var(--ev-accent)}
.reveal-btn.on{color:var(--ev-accent);border-color:var(--ev-accent-border)}
.reveal-btn svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}

.add-var-row{
  display:flex;align-items:center;gap:7px;
  padding:9px 12px;cursor:pointer;
  color:var(--ev-muted);font-size:12px;font-weight:600;
  border-top:1px dashed var(--ev-border);margin-top:2px;
  transition:all 0.1s;
}
.add-var-row:hover{background:var(--ev-hover);color:var(--vscode-foreground)}
.add-var-row svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round}

/* ── Add var form ───────────────────────────────────────────── */
.add-form{
  display:none;flex-direction:column;gap:7px;
  padding:11px 12px;
  border-top:1px solid var(--ev-border);
  background:var(--ev-surface);flex-shrink:0;
}
.add-form.open{display:flex}
.form-row{display:flex;gap:7px}

input,textarea{
  background:var(--ev-card);
  color:var(--vscode-foreground);
  border:1px solid var(--ev-border);
  border-radius:var(--ev-radius-sm);
  padding:6px 9px;
  font-family:inherit;font-size:12px;
  outline:none;width:100%;
  transition:border-color 0.12s;
}
input:focus,textarea:focus{border-color:var(--ev-accent)}
input::placeholder,textarea::placeholder{opacity:0.4}

/* password input looks like regular — don't shrink it */
input[type="password"]{letter-spacing:0.08em}
input[type="color"]{width:32px;height:28px;padding:2px;cursor:pointer}

.form-btns{display:flex;gap:6px;justify-content:flex-end}

/* ── Buttons ────────────────────────────────────────────────── */
.btn{
  padding:6px 14px;border-radius:var(--ev-radius-sm);border:none;
  font-size:12px;font-family:inherit;font-weight:600;
  cursor:pointer;transition:opacity 0.12s;display:inline-flex;align-items:center;gap:5px;
}
.btn:hover{opacity:0.85}
.btn svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.btn-primary{background:var(--ev-accent);color:#fff}
.btn-ghost{background:var(--vscode-button-secondaryBackground,rgba(0,0,0,0.07));color:var(--vscode-foreground)}
.btn-danger{background:var(--ev-red-dim);color:var(--ev-red);border:1px solid rgba(211,47,47,0.25)!important}
.btn-danger:hover{background:rgba(211,47,47,0.18)!important;opacity:1}

/* ── Copy bar ───────────────────────────────────────────────── */
.copy-bar{
  display:flex;gap:6px;flex-shrink:0;
  padding:9px 12px;
  border-top:1px solid var(--ev-border);
  background:var(--ev-header);
}
.copy-btn{
  flex:1;padding:7px 10px;border-radius:var(--ev-radius-sm);border:none;
  font-size:12px;font-weight:600;cursor:pointer;
  font-family:inherit;display:flex;align-items:center;justify-content:center;gap:5px;
  transition:opacity 0.12s;
}
.copy-btn:hover{opacity:0.85}
.copy-btn svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.copy-export{background:var(--ev-accent);color:#fff}
.copy-env{background:var(--vscode-button-secondaryBackground,rgba(0,0,0,0.07));color:var(--vscode-foreground)}

/* ── Import body ────────────────────────────────────────────── */
.import-body{padding:14px;display:flex;flex-direction:column;gap:10px;flex:1;overflow-y:auto}
.import-body textarea{min-height:90px;resize:vertical;font-family:var(--vscode-editor-font-family,monospace);font-size:11px;line-height:1.6}
.import-hint{font-size:10px;color:var(--ev-muted);line-height:1.6;opacity:0.8}
.import-section{border:1px solid var(--ev-border);border-radius:var(--ev-radius);overflow:hidden}
.import-section-hd{
  padding:8px 12px;font-size:11px;font-weight:700;
  letter-spacing:0.06em;text-transform:uppercase;color:var(--ev-muted);
  background:var(--ev-surface);border-bottom:1px solid var(--ev-border);
}

/* ── Runbook ────────────────────────────────────────────────── */
.rb-scroll{flex:1;overflow-y:auto;padding:6px 0 12px}
.stage-card{
  margin:4px 10px 8px;
  border:1px solid var(--ev-border);border-radius:var(--ev-radius);
  overflow:hidden;background:var(--ev-card);box-shadow:var(--ev-shadow);
}
.stage-card.collapsed .stage-hd{border-bottom:none}
.stage-hd{
  display:flex;align-items:center;gap:8px;padding:8px 12px;
  background:var(--ev-header);border-bottom:1px solid var(--ev-border2);
  cursor:pointer;user-select:none;transition:background 0.1s;
}
.stage-hd:hover{background:var(--ev-hover)}
.stage-chevron{
  width:14px;height:14px;flex-shrink:0;
  color:var(--ev-muted);transition:transform 0.18s;
  display:flex;align-items:center;justify-content:center;
}
.stage-chevron.open{transform:rotate(90deg)}
.stage-chevron svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
.stage-num{
  width:20px;height:20px;border-radius:50%;
  background:var(--ev-accent);color:#fff;
  font-size:10px;font-weight:700;
  display:flex;align-items:center;justify-content:center;flex-shrink:0;
}
.stage-name{flex:1;font-size:12px;font-weight:700;color:var(--vscode-foreground)}
.stage-acts{display:flex;gap:1px}
.s-btn{
  display:flex;align-items:center;justify-content:center;
  width:22px;height:22px;border-radius:4px;
  background:none;border:none;cursor:pointer;
  color:var(--ev-muted);transition:all 0.1s;
}
.s-btn:hover{background:var(--ev-hover);color:var(--vscode-foreground)}
.s-btn.danger:hover{color:var(--ev-red);background:var(--ev-red-dim)}
.s-btn svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;display:block}

.cmd-row{
  display:flex;align-items:flex-start;gap:9px;
  padding:8px 12px;border-bottom:1px solid var(--ev-border2);
  transition:background 0.1s;
}
.cmd-row:last-of-type{border-bottom:none}
.cmd-row:hover{background:var(--ev-hover)}
.cmd-info{flex:1;min-width:0}
.cmd-label{font-size:11px;font-weight:700;color:var(--vscode-foreground);margin-bottom:4px}
.cmd-code{
  font-family:var(--vscode-editor-font-family,'SF Mono',monospace);
  font-size:11px;color:var(--ev-accent);
  background:var(--ev-accent-dim);
  padding:4px 8px;border-radius:4px;
  white-space:pre-wrap;word-break:break-all;line-height:1.5;
  border-left:2px solid var(--ev-accent-border);
}
.cmd-acts{display:flex;flex-direction:column;gap:2px;flex-shrink:0;padding-top:1px}
.c-btn{
  display:flex;align-items:center;justify-content:center;
  width:24px;height:24px;border-radius:4px;
  background:none;border:none;cursor:pointer;
  color:var(--ev-muted);transition:all 0.1s;
}
.c-btn:hover{background:var(--ev-hover);color:var(--vscode-foreground)}
.c-btn.copy:hover{color:var(--ev-accent)}
.c-btn.run:hover{color:#1976d2}
.c-btn.danger:hover{color:var(--ev-red);background:var(--ev-red-dim)}
.c-btn svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;display:block}

.add-cmd-row{
  display:flex;align-items:center;gap:5px;padding:7px 12px;
  cursor:pointer;color:var(--ev-muted);font-size:11px;font-weight:600;
  border-top:1px dashed var(--ev-border);transition:all 0.1s;
}
.add-cmd-row:hover{background:var(--ev-hover);color:var(--vscode-foreground)}
.add-cmd-row svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round}

/* ── Modals ─────────────────────────────────────────────────── */
.overlay{
  display:none;position:fixed;inset:0;
  background:rgba(0,0,0,0.5);z-index:200;
  align-items:flex-end;
}
.overlay.open{display:flex}
.modal{
  width:100%;max-height:92vh;overflow-y:auto;
  background:var(--ev-card);
  border:1px solid var(--ev-border);border-bottom:none;
  border-radius:12px 12px 0 0;
  padding:4px 16px 22px;
  display:flex;flex-direction:column;gap:13px;
  box-shadow:0 -4px 24px rgba(0,0,0,0.18);
}
.modal-handle{width:34px;height:4px;border-radius:2px;background:var(--ev-border);margin:8px auto 4px;flex-shrink:0}
.modal-title{font-size:15px;font-weight:700;color:var(--vscode-foreground)}
.modal-field{display:flex;flex-direction:column;gap:5px}
.modal-label{font-size:11px;font-weight:700;color:var(--ev-muted);text-transform:uppercase;letter-spacing:0.06em}
input.ml{font-size:13px;padding:7px 10px;font-family:inherit}
textarea.ml{min-height:80px;resize:vertical;font-family:var(--vscode-editor-font-family,monospace);font-size:11px;line-height:1.6}

.confirm-modal{
  width:100%;
  background:var(--ev-card);
  border:1px solid var(--ev-border);border-bottom:none;
  border-radius:12px 12px 0 0;
  padding:18px 16px 22px;
  display:flex;flex-direction:column;gap:12px;
  box-shadow:0 -4px 24px rgba(0,0,0,0.18);
}
.confirm-msg{font-size:13px;color:var(--vscode-foreground);line-height:1.5}
.confirm-sub{font-size:11px;color:var(--ev-muted)}

/* ── Swatches ───────────────────────────────────────────────── */
.swatch-grid{display:flex;flex-wrap:wrap;gap:7px}
.swatch{
  width:28px;height:28px;border-radius:50%;cursor:pointer;
  border:2px solid transparent;transition:all 0.12s;position:relative;flex-shrink:0;
}
.swatch:hover{transform:scale(1.15)}
.swatch.sel{border-color:#fff;box-shadow:0 0 0 1.5px rgba(0,0,0,0.3)}
.swatch.sel::before{
  content:'';position:absolute;top:50%;left:50%;
  width:7px;height:12px;border:2.5px solid #fff;
  border-top:none;border-left:none;
  transform:translate(-50%,-60%) rotate(45deg);
  filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5));
}
.custom-row{display:flex;align-items:center;gap:7px}
.custom-label{font-size:11px;color:var(--ev-muted)}
.preview-pill{
  display:inline-flex;align-items:center;
  padding:4px 12px;border-radius:20px;
  font-size:12px;font-weight:600;border:1px solid transparent;
}

/* ── Toast ──────────────────────────────────────────────────── */
.toast{
  position:fixed;bottom:16px;left:50%;transform:translateX(-50%) translateY(60px);
  background:var(--ev-card);border:1px solid var(--ev-border);
  border-radius:8px;padding:8px 16px;font-size:12px;font-weight:600;
  box-shadow:0 4px 16px rgba(0,0,0,0.2);z-index:300;
  transition:transform 0.22s cubic-bezier(.175,.885,.32,1.275),opacity 0.22s;
  opacity:0;white-space:nowrap;display:flex;align-items:center;gap:6px;
}
.toast.show{transform:translateX(-50%) translateY(0);opacity:1}
.toast svg{width:14px;height:14px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.toast.ok{border-color:var(--ev-accent-border);color:var(--ev-accent)}
.toast.err{border-color:rgba(211,47,47,0.3);color:var(--ev-red)}

/* ── Flash animation ─────────────────────────────────────────── */
@keyframes flash{0%,100%{opacity:1}50%{opacity:0.25}}
.flashing{animation:flash 0.35s ease}

/* ── Scrollbar ──────────────────────────────────────────────── */
::-webkit-scrollbar{width:4px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--ev-border);border-radius:4px}
::-webkit-scrollbar-thumb:hover{background:var(--ev-muted)}
</style>
</head>
<body>
<div class="app">

<!-- ══ SCREEN: PROJECTS ══ -->
<div class="screen active" id="sProj">
  <div class="topbar">
    <div class="topbar-logo">
      ${SVG.lock}
    </div>
    <div class="topbar-actions" style="display:flex;gap:5px">
      <button class="topbar-btn" title="Export all projects data" onclick="act('exportAll')">${SVG.upload} Export all</button>
      <button class="topbar-btn" title="Import data from JSON" onclick="act('importFile',{merge:true})">${SVG.download} Import</button>
    </div>
  </div>

  <div class="scroll" id="projList"></div>
</div>

<!-- ══ SCREEN: ENV (vars + runbook) ══ -->
<div class="screen" id="sEnv">
  <div class="env-topbar">
    <button class="icon-btn" onclick="goBack()" title="Back">${SVG.back}</button>
    <div class="env-dot" id="envDot"></div>
    <span class="env-title" id="envTitle"></span>
    <button class="reveal-btn" id="revBtn" onclick="toggleRevealAll()">${SVG.eye} Show all</button>
  </div>
  <div class="bc" id="bc"></div>

  <div class="tabs">
    <button class="tab active" id="tVars"    onclick="switchTab('vars')">${SVG.key} Variables</button>
    <button class="tab"        id="tImport"  onclick="switchTab('import')">${SVG.download} Import</button>
    <button class="tab"        id="tRunbook" onclick="switchTab('runbook')">${SVG.play} Runbook</button>
  </div>

  <!-- Variables -->
  <div id="cVars" style="display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden">
    <div class="search-bar" id="varSearchContainer" style="padding:7px 10px;border-bottom:1px solid var(--ev-border2);display:none;align-items:center;background:var(--ev-card)">
      <input type="text" id="varSearch" placeholder="Search variables..." oninput="filterVars()" style="width:100%;padding:4px 8px;border-radius:4px;border:1px solid var(--ev-border);background:var(--ev-surface);color:var(--vscode-foreground);font-family:inherit;font-size:11px" autocomplete="off" spellcheck="false"/>
    </div>
    <div class="var-list" id="varList"></div>
    <div class="add-form" id="addForm">
      <div class="form-row">
        <input type="text"     id="nKey"   placeholder="KEY_NAME" autocomplete="off" spellcheck="false"/>
        <input type="password" id="nVal"   placeholder="value"    autocomplete="off" spellcheck="false"/>
      </div>
      <div class="form-btns">
        <button class="btn btn-ghost" onclick="hideAddVar()">Cancel</button>
        <button class="btn btn-primary" onclick="saveNewVar()">Save</button>
      </div>
    </div>
  </div>

  <!-- Import tab -->
  <div id="cImport" style="display:none;flex:1;overflow-y:auto">
    <div class="import-body">
      <div class="import-section">
        <div class="import-section-hd">Paste .env block</div>
        <div style="padding:10px 12px;display:flex;flex-direction:column;gap:7px">
          <textarea id="pasteBox" placeholder="DB_HOST=localhost&#10;DB_PASS=secret&#10;API_KEY=abc123&#10;# comments ignored"></textarea>
          <div class="import-hint">Supports: KEY=value · export KEY=value · KEY="quoted" · Lines starting with # are ignored · Keys must match [A-Za-z_][A-Za-z0-9_]*</div>
          <div class="form-btns">
            <button class="btn btn-ghost" onclick="G('pasteBox').value=''">Clear</button>
            <button class="btn btn-primary" onclick="doImport()">Import vars</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Runbook tab -->
  <div id="cRunbook" style="display:none;flex:1;min-height:0;overflow:hidden;flex-direction:column">
    <div class="rb-scroll" id="rbList"></div>
  </div>

  <!-- Copy bar (vars only) -->
  <div class="copy-bar" id="copyBar">
    <button class="copy-btn copy-export" onclick="copyAll('export')">${SVG.copy} Copy as export</button>
    <button class="copy-btn copy-env"    onclick="copyAll('env')">${SVG.file} Copy as .env</button>
  </div>
</div>

</div><!-- end .app -->

<!-- Toast -->
<div class="toast" id="toast"></div>

<!-- ENV MODAL -->
<div class="overlay" id="envModal">
  <div class="modal">
    <div class="modal-handle"></div>
    <div class="modal-title" id="envModalTitle">New environment</div>
    <div class="modal-field">
      <div class="modal-label">Name</div>
      <input type="text" class="ml" id="envName" placeholder="e.g. development, production, staging…" autocomplete="off"/>
    </div>
    <div class="modal-field">
      <div class="modal-label">Color</div>
      <div class="swatch-grid" id="swatches"></div>
      <div class="custom-row" style="margin-top:6px">
        <span class="custom-label">Custom:</span>
        <input type="color" id="colorPick"/>
      </div>
    </div>
    <div class="modal-field">
      <div class="modal-label">Preview</div>
      <span class="preview-pill" id="pillPrev">env</span>
    </div>
    <div class="form-btns">
      <button class="btn btn-ghost" onclick="close_('envModal')">Cancel</button>
      <button class="btn btn-primary" onclick="saveEnvModal()">Save</button>
    </div>
  </div>
</div>

<!-- PROJECT MODAL -->
<div class="overlay" id="projModal">
  <div class="modal">
    <div class="modal-handle"></div>
    <div class="modal-title" id="projModalTitle">New project</div>
    <div class="modal-field">
      <div class="modal-label">Project name</div>
      <input type="text" class="ml" id="projName" placeholder="e.g. my-api, rfi-builder…" autocomplete="off"/>
    </div>
    <div class="form-btns">
      <button class="btn btn-ghost" onclick="close_('projModal')">Cancel</button>
      <button class="btn btn-primary" onclick="saveProjModal()">Save</button>
    </div>
  </div>
</div>

<!-- STAGE MODAL -->
<div class="overlay" id="stageModal">
  <div class="modal">
    <div class="modal-handle"></div>
    <div class="modal-title" id="stageTitle">New stage</div>
    <div class="modal-field">
      <div class="modal-label">Stage name</div>
      <input type="text" class="ml" id="stageName" placeholder="e.g. Mock Data, Start Services, Run Migrations…" autocomplete="off"/>
    </div>
    <div class="form-btns">
      <button class="btn btn-ghost" onclick="close_('stageModal')">Cancel</button>
      <button class="btn btn-primary" onclick="saveStageModal()">Save</button>
    </div>
  </div>
</div>

<!-- COMMAND MODAL -->
<div class="overlay" id="cmdModal">
  <div class="modal">
    <div class="modal-handle"></div>
    <div class="modal-title" id="cmdTitle">New command</div>
    <div class="modal-field">
      <div class="modal-label">Label</div>
      <input type="text" class="ml" id="cmdLabel" placeholder="e.g. Start mock server, Run migrations…" autocomplete="off"/>
    </div>
    <div class="modal-field">
      <div class="modal-label">Command</div>
      <textarea class="ml" id="cmdText" placeholder="npm run mock&#10;docker-compose up -d" spellcheck="false"></textarea>
    </div>
    <div class="form-btns">
      <button class="btn btn-ghost" onclick="close_('cmdModal')">Cancel</button>
      <button class="btn btn-primary" onclick="saveCmdModal()">Save</button>
    </div>
  </div>
</div>

<!-- CONFIRM MODAL -->
<div class="overlay" id="confModal">
  <div class="confirm-modal">
    <div class="modal-handle"></div>
    <div class="modal-title" id="confTitle">Are you sure?</div>
    <div class="confirm-msg" id="confMsg"></div>
    <div class="confirm-sub" id="confSub"></div>
    <div class="form-btns">
      <button class="btn btn-ghost" onclick="close_('confModal')">Cancel</button>
      <button class="btn btn-danger" onclick="doConfirm()">Delete</button>
    </div>
  </div>
</div>

<script>
'use strict';
const vsc = acquireVsCodeApi();
const G   = id => document.getElementById(id);
const ESC = s => (s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const EQ  = s => (s??'').replace(/\\\\/g,'\\\\\\\\').replace(/'/g,"\\\\'").replace(/"/g,'&quot;');

/* ── SVG icon refs (inlined by template) ── */
/* Icons come from the HTML literals above — no runtime refs needed */

const PALETTE = [
  '#4ec994','#f48771','#dca84f','#569cd6','#c586c0',
  '#9cdcfe','#61afef','#e06c75','#98c379','#e5c07b',
  '#56b6c2','#d19a66','#abb2bf','#ff79c6','#bd93f9','#50fa7b'
];

/* ── State ── */
let idx     = {projects:[]};
let openSet = new Set();      // expanded project ids
let expandedStages = new Set();  // expanded stage ids
let active  = null;           // {projectId,envId,name,color}
let vars    = [];
let rb      = {stages:[]};    // current runbook
let revealed= {};
let revAll  = false;
let activeTab = 'vars';

// modal state
let envMode='create', envPid=null, envEid=null;
let projMode='create', projId=null;
let stgMode='create',  stgIdx=-1;
let cmdStg=-1, cmdIdx=-1;
let selColor='#4ec994';
let confCb=null;
let menuOpen=false;

/* ── Boot ── */
vsc.postMessage({type:'getIndex'});

window.addEventListener('message', e => {
  const m=e.data;
  if (m.type==='index')   { idx=m.data; renderProjs(); }
  if (m.type==='vars' && active && m.projectId===active.projectId && m.envId===active.envId) {
    vars=m.data; renderVars();
  }
  if (m.type==='runbook' && active && m.projectId===active.projectId && m.envId===active.envId) {
    rb=m.data||{stages:[]}; renderRb();
  }
});

/* ── Screen switch ── */
function showScreen(s){
  G('sProj').classList.toggle('active',s==='proj');
  G('sEnv').classList.toggle('active', s==='env');
}
function goBack(){
  active=null;vars=[];rb={stages:[]};revealed={};revAll=false;expandedStages=new Set();
  renderProjs(); showScreen('proj');
}


/* ── Projects render ── */
function renderProjs(){
  const el=G('projList');
  if(!idx.projects.length){
    el.innerHTML=\`<div class="empty">
      <div class="empty-ico">${SVG.lock}</div>
      <div class="empty-h">No projects yet</div>
      <div class="empty-p">Create a project to securely store environment variables and runbooks.</div>
    </div>
    <button class="dashed-btn" onclick="openNewProj()">${SVG.plus} Create project</button>\`;
    return;
  }
  let h='';
  for(const p of idx.projects){
    const open=openSet.has(p.id);
    h+=\`<div class="proj-card">
      <div class="proj-row" onclick="toggleProj('\${p.id}')">
        <span class="proj-chevron \${open?'open':''}">${SVG.chevron}</span>
        <span class="proj-icon">${SVG.folder}</span>
        <span class="proj-name">\${ESC(p.name)}</span>
        <span class="proj-badge">\${p.envs.length} env\${p.envs.length!==1?'s':''}</span>
        <div class="proj-acts" onclick="event.stopPropagation()">
          <button class="row-btn" title="Export project" onclick="act('exportProject',{projectId:'\${p.id}'})">${SVG.upload}</button>
          <button class="row-btn" title="Rename" onclick="openEditProj('\${p.id}','\${EQ(p.name)}')">${SVG.edit}</button>
          <button class="row-btn danger" title="Delete" onclick="askDelProj('\${p.id}','\${EQ(p.name)}')">${SVG.trash}</button>
        </div>
      </div>
      <div class="env-area \${open?'open':''}">
        <div class="env-pills">
          \${p.envs.map(e=>{
            const c=e.color||'#4ec994';
            return \`<span class="env-pill \${active&&active.envId===e.id?'sel':''}"
              style="background:\${c}20;color:\${c};border-color:\${c}50"
              onclick="openEnv('\${p.id}','\${e.id}','\${EQ(e.name)}','\${c}')">
              \${ESC(e.name)}
              <span class="pill-acts" onclick="event.stopPropagation()">
                <button class="pill-btn" title="Edit" onclick="openEditEnv('\${p.id}','\${e.id}','\${EQ(e.name)}','\${c}')">${SVG.editSm}</button>
                <button class="pill-btn" title="Delete" onclick="askDelEnv('\${p.id}','\${e.id}','\${EQ(e.name)}')">${SVG.xSm}</button>
              </span>
            </span>\`;
          }).join('')}
          <button class="add-env-btn" onclick="openNewEnv('\${p.id}')">${SVG.plusSm} Add env</button>
        </div>
      </div>
    </div>\`;
  }
  h+=\`<button class="dashed-btn" onclick="openNewProj()">${SVG.plus} Create project</button>\`;
  el.innerHTML=h;
}

function toggleProj(id){openSet.has(id)?openSet.delete(id):openSet.add(id);renderProjs();}

/* ── Project modal ── */
function openNewProj(){projMode='create';projId=null;G('projModalTitle').textContent='New project';G('projName').value='';open_('projModal');setTimeout(()=>G('projName').focus(),60);}
function openEditProj(id,n){projMode='rename';projId=id;G('projModalTitle').textContent='Rename project';G('projName').value=n;open_('projModal');setTimeout(()=>G('projName').focus(),60);}
function saveProjModal(){
  const n=G('projName').value.trim();
  if(!n){toast('Project name cannot be empty','err');G('projName').focus();return;}
  if(projMode==='create') vsc.postMessage({type:'createProject',name:n});
  else vsc.postMessage({type:'renameProject',projectId:projId,name:n});
  close_('projModal');
}

/* ── Delete confirms ── */
function askDelProj(id,n){G('confTitle').textContent='Delete project';G('confMsg').textContent='Delete "'+n+'"?';G('confSub').textContent='All environments, variables and runbooks will be permanently deleted.';confCb=()=>{openSet.delete(id);vsc.postMessage({type:'deleteProject',projectId:id});};open_('confModal');}
function askDelEnv(pid,eid,n){G('confTitle').textContent='Delete environment';G('confMsg').textContent='Delete "'+n+'"?';G('confSub').textContent='All variables and the runbook for this environment will be permanently deleted.';confCb=()=>{if(active&&active.envId===eid)goBack();vsc.postMessage({type:'deleteEnv',projectId:pid,envId:eid});};open_('confModal');}
function doConfirm(){if(confCb){confCb();confCb=null;}close_('confModal');}

/* ── Env modal ── */
function buildSwatches(){
  G('swatches').innerHTML=PALETTE.map(c=>\`<div class="swatch \${c===selColor?'sel':''}" style="background:\${c}" onclick="pickColor('\${c}')"></div>\`).join('');
  G('colorPick').value=selColor;refreshPill();
}
function pickColor(c){selColor=c;buildSwatches();}
G('colorPick').addEventListener('input',e=>{selColor=e.target.value;buildSwatches();});
G('envName').addEventListener('input',refreshPill);
function refreshPill(){const n=G('envName').value.trim()||'env';const p=G('pillPrev');p.textContent=n;p.style.color=selColor;p.style.background=selColor+'20';p.style.borderColor=selColor+'50';}

function openNewEnv(pid){envMode='create';envPid=pid;envEid=null;selColor='#4ec994';G('envModalTitle').textContent='New environment';G('envName').value='';buildSwatches();open_('envModal');setTimeout(()=>G('envName').focus(),60);}
function openEditEnv(pid,eid,n,c){envMode='rename';envPid=pid;envEid=eid;selColor=c||'#4ec994';G('envModalTitle').textContent='Edit environment';G('envName').value=n;buildSwatches();open_('envModal');setTimeout(()=>G('envName').focus(),60);}
function saveEnvModal(){
  const n=G('envName').value.trim();
  if(!n){toast('Environment name cannot be empty','err');G('envName').focus();return;}
  if(envMode==='create'){openSet.add(envPid);vsc.postMessage({type:'createEnv',projectId:envPid,name:n,color:selColor});}
  else{if(active&&active.envId===envEid){active.name=n;active.color=selColor;updateEnvHdr();}vsc.postMessage({type:'renameEnv',projectId:envPid,envId:envEid,name:n,color:selColor});}
  close_('envModal');
}

/* ── Modal open/close ── */
function open_(id){G(id).classList.add('open');}
function close_(id){G(id).classList.remove('open');}
['envModal','projModal','stageModal','cmdModal','confModal'].forEach(id=>{
  G(id).addEventListener('click',e=>{if(e.target===G(id))close_(id);});
});

/* ── Env screen ── */
function openEnv(pid,eid,name,color){
  active={projectId:pid,envId:eid,name,color};
  vars=[];rb={stages:[]};revealed={};revAll=false;expandedStages=new Set();
  G('varSearch').value='';
  updateEnvHdr();switchTab('vars');
  G('addForm').classList.remove('open');
  renderVars();
  vsc.postMessage({type:'getVars',projectId:pid,envId:eid});
  showScreen('env');
}
function updateEnvHdr(){
  if(!active)return;
  const p=idx.projects.find(p=>p.id===active.projectId);
  G('envDot').style.background=active.color||'#4ec994';
  G('envTitle').textContent=active.name;
  G('bc').innerHTML=\`<span class="bc-link" onclick="goBack()">\${ESC(p?p.name:'Projects')}</span><span class="bc-sep">›</span><span class="bc-cur">\${ESC(active.name)}</span>\`;
}

function switchTab(t){
  activeTab=t;
  G('tVars').classList.toggle('active',   t==='vars');
  G('tImport').classList.toggle('active', t==='import');
  G('tRunbook').classList.toggle('active',t==='runbook');
  G('cVars').style.display    =t==='vars'    ?'flex':'none';
  G('cImport').style.display  =t==='import'  ?'block':'none';
  G('cRunbook').style.display =t==='runbook' ?'flex':'none';
  G('copyBar').style.display  =t==='vars'    ?'flex':'none';
  const rb_=G('revBtn');
  rb_.style.display=t==='vars'?'flex':'none';
  if(t==='runbook') vsc.postMessage({type:'getRunbook',projectId:active.projectId,envId:active.envId});
}

/* ── Var list ── */
function renderVars(){
  const list=G('varList');
  const btn=G('revBtn');
  btn.classList.toggle('on',revAll);
  btn.innerHTML=(revAll?'${SVG.eyeOff}':'${SVG.eye}')+' '+(revAll?'Hide all':'Show all');

  const query = (G('varSearch').value || '').trim().toLowerCase();
  const filtered = query ? vars.filter(v => v.key.toLowerCase().includes(query) || v.value.toLowerCase().includes(query)) : vars;

  if(!vars.length){
    G('varSearchContainer').style.display = 'none';
    list.innerHTML=\`<div class="empty" style="padding:20px 16px">
      <div class="empty-ico">\${SVG.key}</div>
      <div class="empty-h">No variables yet</div>
      <div class="empty-p">Click + to add one, or use the Import tab.</div>
    </div>\`;
    list.innerHTML+=\`<div class="add-var-row" onclick="showAddVar()">\${SVG.plus}&nbsp; Add variable</div>\`;
    return;
  }

  G('varSearchContainer').style.display = 'flex';

  if(!filtered.length){
    list.innerHTML=\`<div class="empty" style="padding:20px 16px">
      <div class="empty-h">No matches found</div>
      <div class="empty-p">No variables match your search query.</div>
    </div>\`;
    return;
  }

  list.innerHTML=filtered.map(v=>{
    const show=revAll||!!revealed[v.id];
    return \`<div class="var-row">
      <span class="var-key">\${ESC(v.key)}</span>
      <span class="var-val \${show?'shown':''}">\${show?ESC(v.value):'••••••••••'}</span>
      <button class="vbtn" title="\${show?'Hide':'Reveal'}" onclick="toggleRev('\${v.id}')">\${show?'\${SVG.eyeOff}':'\${SVG.eye}'}</button>
      <button class="vbtn" title="Copy export" onclick="copyVar('\${v.id}')">\${SVG.copy}</button>
      <button class="vbtn danger" title="Delete" onclick="delVar('\${v.id}')">\${SVG.trash}</button>
    </div>\`;
  }).join('');
  list.innerHTML+=\`<div class="add-var-row" onclick="showAddVar()">\${SVG.plus}&nbsp; Add variable</div>\`;
}

function filterVars(){
  renderVars();
}

function toggleRevealAll(){revAll=!revAll;revealed={};renderVars();}
function toggleRev(id){revealed[id]=!revealed[id];renderVars();}
function copyVar(id){const v=vars.find(v=>v.id===id);if(v)vsc.postMessage({type:'copy',text:'export '+v.key+'='+v.value,label:'✓ '+v.key+' copied'});}
function delVar(id){if(active)vsc.postMessage({type:'deleteVar',projectId:active.projectId,envId:active.envId,varId:id});}
function showAddVar(){G('addForm').classList.add('open');G('nKey').value='';G('nVal').value='';setTimeout(()=>G('nKey').focus(),40);}
function hideAddVar(){G('addForm').classList.remove('open');}
function saveNewVar(){
  const key=(G('nKey').value||'').trim(),val=G('nVal').value;
  if(!key){toast('Key cannot be empty','err');G('nKey').focus();return;}
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)){toast('Invalid key: use letters, digits, underscores','err');G('nKey').focus();return;}
  if(!active)return;
  vsc.postMessage({type:'saveVar',projectId:active.projectId,envId:active.envId,var:{id:Math.random().toString(36).slice(2,10),key,value:val}});
  hideAddVar();
}
function copyAll(fmt){
  if(!vars.length){toast('No variables to copy','err');return;}
  const text=fmt==='export'?vars.map(v=>'export '+v.key+'='+v.value).join('\\n'):vars.map(v=>v.key+'='+v.value).join('\\n');
  vsc.postMessage({type:'copy',text,label:'✓ '+vars.length+' vars copied'});
}
function doImport(){
  if(!active)return;
  const text=(G('pasteBox').value||'').trim();
  if(!text){toast('Nothing to import','err');return;}
  vsc.postMessage({type:'bulkImport',projectId:active.projectId,envId:active.envId,text});
  G('pasteBox').value='';switchTab('vars');
}

/* ── Import / Export actions ── */
function act(type,extra={}){
  vsc.postMessage({type,...(active?{projectId:active.projectId,envId:active.envId}:{}), ...extra});
}

/* ══════════════════════════════════════════
   RUNBOOK
══════════════════════════════════════════ */
function renderRb(){
  const list=G('rbList');
  if(!rb.stages.length){
    list.innerHTML=\`<div class="empty" style="padding:26px 16px">
      <div class="empty-ico">${SVG.play}</div>
      <div class="empty-h">No stages yet</div>
      <div class="empty-p">Add stages like "Mock Data" or "Start Services" and attach commands to each one.</div>
    </div>
    <button class="dashed-btn" onclick="openNewStg()">${SVG.plus} Add first stage</button>\`;
    return;
  }
  let h='';
  rb.stages.forEach((stage,si)=>{
    const open = expandedStages.has(stage.id);
    h+=\`<div class="stage-card \${open?'':'collapsed'}">
      <div class="stage-hd" onclick="toggleStage('\${stage.id}')">
        <span class="stage-chevron \${open?'open':''}">${SVG.chevron}</span>
        <span class="stage-num">\${si+1}</span>
        <span class="stage-name">\${ESC(stage.name)}</span>
        <div class="stage-acts" onclick="event.stopPropagation()">
          <button class="s-btn" title="Rename" onclick="openEditStg(\${si})">${SVG.edit}</button>
          <button class="s-btn danger" title="Delete" onclick="askDelStg(\${si})">${SVG.trash}</button>
        </div>
      </div>
      <div style="\${open?'':'display:none'}">
        \${stage.commands.map((cmd,ci)=>\`<div class="cmd-row">
          <div class="cmd-info">
            <div class="cmd-label">\${ESC(cmd.label)}</div>
            <div class="cmd-code">\${ESC(cmd.cmd)}</div>
          </div>
          <div class="cmd-acts">
            <button class="c-btn copy" id="cb-\${si}-\${ci}" title="Copy" onclick="copyCmd(\${si},\${ci})">${SVG.copy}</button>
            <button class="c-btn run"  title="Run in terminal" onclick="runCmd(\${si},\${ci})">${SVG.terminal}</button>
            <button class="c-btn"      title="Edit" onclick="openEditCmd(\${si},\${ci})">${SVG.edit}</button>
            <button class="c-btn danger" title="Delete" onclick="askDelCmd(\${si},\${ci})">${SVG.trash}</button>
          </div>
        </div>\`).join('')}
        <div class="add-cmd-row" onclick="openNewCmd(\${si})">${SVG.plusSm}&nbsp; Add command</div>
      </div>
    </div>\`;
  });
  h+=\`<button class="dashed-btn" style="margin-top:2px" onclick="openNewStg()">${SVG.plus} Add stage</button>\`;
  list.innerHTML=h;
}

function toggleStage(id){
  expandedStages.has(id)?expandedStages.delete(id):expandedStages.add(id);
  renderRb();
}

function openNewStg(){stgMode='create';stgIdx=-1;G('stageTitle').textContent='New stage';G('stageName').value='';open_('stageModal');setTimeout(()=>G('stageName').focus(),60);}
function openEditStg(si){stgMode='rename';stgIdx=si;G('stageTitle').textContent='Rename stage';G('stageName').value=rb.stages[si].name;open_('stageModal');setTimeout(()=>G('stageName').focus(),60);}
function saveStageModal(){
  const n=G('stageName').value.trim();
  if(!n){toast('Stage name cannot be empty','err');G('stageName').focus();return;}
  if(stgMode==='create') rb.stages.push({id:Math.random().toString(36).slice(2,10),name:n,commands:[]});
  else rb.stages[stgIdx].name=n;
  saveRb();close_('stageModal');
}
function askDelStg(si){G('confTitle').textContent='Delete stage';G('confMsg').textContent='Delete "'+rb.stages[si].name+'"?';G('confSub').textContent='All commands in this stage will be deleted.';confCb=()=>{rb.stages.splice(si,1);saveRb();};open_('confModal');}

function openNewCmd(si){cmdStg=si;cmdIdx=-1;G('cmdTitle').textContent='New command';G('cmdLabel').value='';G('cmdText').value='';open_('cmdModal');setTimeout(()=>G('cmdLabel').focus(),60);}
function openEditCmd(si,ci){cmdStg=si;cmdIdx=ci;const c=rb.stages[si].commands[ci];G('cmdTitle').textContent='Edit command';G('cmdLabel').value=c.label;G('cmdText').value=c.cmd;open_('cmdModal');setTimeout(()=>G('cmdLabel').focus(),60);}
function saveCmdModal(){
  const label=G('cmdLabel').value.trim(),cmd=G('cmdText').value.trim();
  if(!label){toast('Label cannot be empty','err');G('cmdLabel').focus();return;}
  if(!cmd){toast('Command cannot be empty','err');G('cmdText').focus();return;}
  if(cmdIdx===-1) rb.stages[cmdStg].commands.push({id:Math.random().toString(36).slice(2,10),label,cmd});
  else rb.stages[cmdStg].commands[cmdIdx]={...rb.stages[cmdStg].commands[cmdIdx],label,cmd};
  saveRb();close_('cmdModal');
}
function askDelCmd(si,ci){const c=rb.stages[si].commands[ci];G('confTitle').textContent='Delete command';G('confMsg').textContent='Delete "'+c.label+'"?';G('confSub').textContent='This command will be permanently removed.';confCb=()=>{rb.stages[si].commands.splice(ci,1);saveRb();};open_('confModal');}

function copyCmd(si,ci){
  const c=rb.stages[si].commands[ci];
  vsc.postMessage({type:'copy',text:c.cmd,label:'✓ Command copied'});
  const b=G('cb-'+si+'-'+ci);if(b){b.classList.add('flashing');setTimeout(()=>b.classList.remove('flashing'),350);}
}
function runCmd(si,ci){vsc.postMessage({type:'runInTerminal',cmd:rb.stages[si].commands[ci].cmd});}
function saveRb(){
  vsc.postMessage({type:'saveRunbook',projectId:active.projectId,envId:active.envId,data:rb});
  renderRb();
}

/* ── Toast ── */
let _toastTimer=null;
function toast(msg,type='ok'){
  const el=G('toast');
  el.innerHTML=(type==='ok'?'${SVG.check}':'${SVG.x_}')+' '+ESC(msg);
  el.className='toast '+type+' show';
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(()=>el.classList.remove('show'),2800);
}

/* ── Keyboard ── */
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    ['envModal','projModal','stageModal','cmdModal','confModal'].forEach(close_);
  }
  if(e.key==='Enter'){
    if(e.target===G('nVal'))      {e.preventDefault();saveNewVar();}
    if(e.target===G('envName'))   {e.preventDefault();saveEnvModal();}
    if(e.target===G('projName'))  {e.preventDefault();saveProjModal();}
    if(e.target===G('stageName')) {e.preventDefault();saveStageModal();}
    if(e.target===G('cmdLabel'))  {e.preventDefault();G('cmdText').focus();}
  }
});
</script>
</body>
</html>`;

// ── Inline SVGs (own icons, not emoji, works on dark+light) ───────
// Replace SVG placeholders in HTML template
const htmlWithSvg = HTML
  .replace(/\$\{SVG\.([a-zA-Z_]+)\}/g, (_: string, name: string) => {
    const s = (SVG as Record<string, string>)[name];
    return s ?? '';
  });

// Patch _getHtml to return resolved HTML (SVG refs replaced)
(EnvStashProvider.prototype as any)['_getHtml'] = function() {
  return htmlWithSvg;
};

export function deactivate() {}
