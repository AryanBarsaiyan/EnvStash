import * as vscode from 'vscode';
import { ActiveEnvService, EnvRef } from './services/activeEnvService';
import { ProjectService } from './services/projectService';
import { PanelProvider } from './webview/panelProvider';

export const SWITCH_ENV_COMMAND = 'envstash.switchEnvironment';

/** Shows the active environment in the status bar; clicking it runs the switch command. */
export class EnvStatusBar implements vscode.Disposable {
  private readonly _item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

  constructor(private readonly _active: ActiveEnvService) {
    this._item.command = SWITCH_ENV_COMMAND;
    this.refresh();
    this._item.show();
  }

  /** Re-reads the active environment; call after it, or anything it is named after, changes. */
  refresh() {
    const active = this._active.resolve();
    this._item.text = active ? `$(lock) ${active.project.name} / ${active.env.name}` : '$(lock) EnvStash';
    this._item.tooltip = active
      ? `EnvStash environment: ${active.env.name} (${active.project.name}). Click to switch.`
      : 'EnvStash: no environment selected. Click to pick one.';
  }

  dispose() { this._item.dispose(); }
}

/** Quick-pick over every environment; the choice becomes active and opens in the panel. */
export async function switchEnvironment(projects: ProjectService, active: ActiveEnvService, panel: PanelProvider) {
  const current = active.resolve();
  const items: Array<vscode.QuickPickItem & { ref: EnvRef }> = projects.getIndex().projects.flatMap(p =>
    p.envs.map(e => ({
      label: e.name,
      description: p.name + (current?.env.id === e.id && current.project.id === p.id ? '  ·  current' : ''),
      ref: { projectId: p.id, envId: e.id },
    })));

  if (!items.length) {
    vscode.window.showInformationMessage('EnvStash has no environments yet. Create one in the EnvStash panel.');
    await panel.reveal();
    return;
  }
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: 'Switch EnvStash environment', matchOnDescription: true
  });
  if (!pick) return;
  await active.set(pick.ref);
  await panel.openEnv(pick.ref);
}
