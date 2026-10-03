import * as vscode from 'vscode';
import { BackupController } from '../backup/backupController';
import { VaultIndex } from '../model';
import { ActiveEnvService } from '../services/activeEnvService';
import { ClipboardService } from '../services/clipboardService';
import { diffVars } from '../services/compare';
import { EnvDataService } from '../services/envDataService';
import { ProjectService } from '../services/projectService';
import { TerminalService } from '../services/terminalService';

export interface Services {
  projects: ProjectService;
  envData: EnvDataService;
  activeEnv: ActiveEnvService;
  terminal: TerminalService;
  clipboard: ClipboardService;
  backup: BackupController;
}

/** Sends a message back to the panel. */
export type Post = (message: object) => void;
/** Announces a changed index to everything that shows it (panel, status bar). */
export type PublishIndex = (index: VaultIndex) => void;

// Messages come from the webview, so their shape is only as trustworthy as the page
type Message = { type?: string; [field: string]: any };
type Handler = (msg: Message) => Promise<void> | void;

export interface MessageHandlers {
  /** Touch the vault: run one at a time, in arrival order. */
  queued: Record<string, Handler>;
  /** Wait on dialogs: run immediately and queue their own vault access. */
  direct: Record<string, Handler>;
}

/**
 * One handler per message type the panel can send. Handlers translate between the
 * message protocol and the services; the rules themselves live in the services.
 */
export function createMessageHandlers(s: Services, post: Post, publishIndex: PublishIndex): MessageHandlers {
  const scope = (msg: Message) => ({ projectId: msg.projectId, envId: msg.envId });
  const postVars = (msg: Message, data: object) => post({ type: 'vars', ...scope(msg), data });

  const queued: Record<string, Handler> = {
    // INDEX
    getIndex: () => post({ type: 'index', data: s.projects.getIndex() }),

    // PROJECTS
    createProject: async msg => publishIndex(await s.projects.createProject(msg.name)),
    renameProject: async msg => publishIndex(await s.projects.renameProject(msg.projectId, msg.name)),
    deleteProject: async msg => publishIndex(await s.projects.deleteProject(msg.projectId)),

    // ENVIRONMENTS
    createEnv: async msg => publishIndex(await s.projects.createEnv(msg.projectId, msg.name, msg.color)),
    renameEnv: async msg => publishIndex(await s.projects.renameEnv(msg.projectId, msg.envId, msg.name, msg.color)),
    duplicateEnv: async msg => publishIndex(await s.projects.duplicateEnv(msg.projectId, msg.envId, msg.name, msg.color)),
    deleteEnv: async msg => publishIndex(await s.projects.deleteEnv(msg.projectId, msg.envId)),
    setActiveEnv: msg => s.activeEnv.set({ projectId: msg.projectId, envId: msg.envId }),
    compareEnvs: async msg => {
      const [mine, theirs] = [
        await s.envData.getVars(msg.projectId, msg.envId),
        await s.envData.getVars(msg.otherProjectId, msg.otherEnvId),
      ];
      post({
        type: 'compare', ...scope(msg),
        otherProjectId: msg.otherProjectId, otherEnvId: msg.otherEnvId,
        data: diffVars(mine, theirs),
      });
    },

    // VARS
    getVars:   async msg => postVars(msg, await s.envData.getVars(msg.projectId, msg.envId)),
    saveVar:   async msg => postVars(msg, await s.envData.saveVar(msg.projectId, msg.envId, msg.var)),
    deleteVar: async msg => postVars(msg, await s.envData.deleteVar(msg.projectId, msg.envId, msg.varId)),
    bulkImport: async msg => {
      const result = await s.envData.importDotenv(msg.projectId, msg.envId, msg.text ?? '');
      postVars(msg, result.vars);
      vscode.window.showInformationMessage(`✓ Imported ${result.added} new · ${result.updated} updated vars`);
    },

    // RUNBOOK
    getRunbook: async msg => post({ type: 'runbook', ...scope(msg), data: await s.envData.getRunbook(msg.projectId, msg.envId) }),
    saveRunbook: msg => s.envData.saveRunbook(msg.projectId, msg.envId, msg.data),

    // NOTES
    getNotes: async msg => post({ type: 'notes', ...scope(msg), data: await s.envData.getNotes(msg.projectId, msg.envId) }),
    saveNotes: msg => s.envData.saveNotes(msg.projectId, msg.envId, msg.notes),

    // CLIPBOARD / TERMINAL
    copy: async msg => {
      const text = msg.text ?? '';
      if (!text) return;
      const secs = await s.clipboard.copy(text, !!msg.secret);
      vscode.window.showInformationMessage((msg.label || '✓ Copied') + (secs > 0 ? ` · clipboard clears in ${secs}s` : ''));
    },
    runInTerminal: msg => s.terminal.run(msg.cmd, msg.projectId, msg.envId),
    runAll: msg => s.terminal.runAll(msg.projectId, msg.envId),
  };

  const direct: Record<string, Handler> = {
    // IMPORT / EXPORT
    exportProject: msg => s.backup.exportProject(msg.projectId),
    exportAll: () => s.backup.exportAll(),
    importFile: msg => s.backup.importFromFile(msg.merge ?? true),
  };

  return { queued, direct };
}
