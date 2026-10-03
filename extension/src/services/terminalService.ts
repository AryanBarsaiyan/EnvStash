import * as vscode from 'vscode';
import { EXPORT_ENV_CMD } from '../model';
import { VaultStore } from '../storage/vaultStore';
import { dialectFor } from './shell';

const TERMINAL_NAME = 'EnvStash';

/** Sends runbook commands to the integrated terminal, in the syntax of whatever shell it runs. */
export class TerminalService {
  constructor(private readonly _store: VaultStore) {}

  private _terminal(): vscode.Terminal {
    return vscode.window.activeTerminal ?? vscode.window.createTerminal(TERMINAL_NAME);
  }

  /** Runs one command. `export-env` expands to the environment's variables. */
  async run(rawCmd: string | undefined, pid?: string, eid?: string) {
    let cmd = (rawCmd ?? '').trim();
    if (!cmd) return;

    const term = this._terminal();
    if (cmd === EXPORT_ENV_CMD && pid && eid) {
      const vars = await this._store.getVars(pid, eid);
      if (!vars.length) {
        vscode.window.showWarningMessage('No environment variables to export.');
        return;
      }
      cmd = dialectFor(term).exportVars(vars);
    }
    term.show(true);
    term.sendText(cmd);
  }

  /** Runs every command of the runbook as one line that stops at the first failure. */
  async runAll(pid: string | undefined, eid: string | undefined) {
    if (!pid || !eid) return;
    const rb = await this._store.getRunbook(pid, eid);
    const cmds = rb.stages.flatMap(s => s.commands).map(c => c.cmd.trim()).filter(Boolean);
    if (!cmds.length) {
      vscode.window.showWarningMessage('No commands in the playbook to run.');
      return;
    }

    const term = this._terminal();
    const dialect = dialectFor(term);
    const vars = await this._store.getVars(pid, eid);
    const envCmd = vars.length ? dialect.exportVars(vars) : 'echo "No environment variables to export"';

    term.show(true);
    term.sendText(dialect.chain(cmds.map(c => c === EXPORT_ENV_CMD ? envCmd : c)));
  }
}
