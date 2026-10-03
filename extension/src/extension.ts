import * as vscode from 'vscode';
import { BackupController } from './backup/backupController';
import { VaultIndex } from './model';
import { ActiveEnvService } from './services/activeEnvService';
import { BackupService } from './services/backupService';
import { ClipboardService } from './services/clipboardService';
import { EnvDataService } from './services/envDataService';
import { ProjectService } from './services/projectService';
import { TerminalService } from './services/terminalService';
import { EnvStatusBar, SWITCH_ENV_COMMAND, switchEnvironment } from './statusBar';
import { VaultStore } from './storage/vaultStore';
import { SerialQueue } from './util';
import { createMessageHandlers } from './webview/messageHandlers';
import { PanelProvider, reportError } from './webview/panelProvider';

let clipboard: ClipboardService | undefined;

// Composition root: the only place that knows how the pieces fit together
export function activate(context: vscode.ExtensionContext) {
  const store = new VaultStore(context.globalState, context.secrets);
  const queue = new SerialQueue();

  const projects = new ProjectService(store);
  const envData = new EnvDataService(store);
  const terminal = new TerminalService(store);
  const activeEnv = new ActiveEnvService(context.workspaceState, projects);
  clipboard = new ClipboardService();

  const panel = new PanelProvider(context.extensionPath, projects, queue);
  const statusBar = new EnvStatusBar(activeEnv);
  activeEnv.onDidChange = () => statusBar.refresh();

  // a rename or delete can change what the status bar shows, so it follows every index change
  const publishIndex = (index: VaultIndex) => {
    panel.post({ type: 'index', data: index });
    statusBar.refresh();
  };
  const backup = new BackupController(new BackupService(store), projects, queue, publishIndex);
  panel.setHandlers(createMessageHandlers(
    { projects, envData, activeEnv, terminal, clipboard, backup }, panel.post, publishIndex));

  context.subscriptions.push(
    statusBar,
    vscode.window.registerWebviewViewProvider(PanelProvider.viewId, panel, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('envstash.open', () => {
      vscode.commands.executeCommand('workbench.view.extension.envstash');
    }),
    vscode.commands.registerCommand(SWITCH_ENV_COMMAND,
      () => switchEnvironment(projects, activeEnv, panel).catch(reportError)),
    // Export / import from the command palette
    vscode.commands.registerCommand('envstash.exportAll', () => backup.exportAll().catch(reportError)),
    vscode.commands.registerCommand('envstash.importAll', () => backup.importFromFile(true).catch(reportError)),
  );
}

// Clears a secret we put on the clipboard if VS Code shuts down before the timer fires
export function deactivate() { return clipboard?.dispose(); }
