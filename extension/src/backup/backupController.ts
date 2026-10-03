import * as vscode from 'vscode';
import * as path from 'path';
import { VaultIndex } from '../model';
import { BackupService } from '../services/backupService';
import { decryptBundle, encryptBundle, isEncryptedBundle, MIN_PASSPHRASE } from '../services/backupCrypto';
import { ProjectService } from '../services/projectService';
import { SerialQueue } from '../util';

const FILE_FILTERS = { 'EnvStash JSON': ['json'] };

/**
 * The export/import conversations with the user: passphrase prompts, file dialogs,
 * reading and writing the file. Dialogs can stay open for minutes, so only the
 * moments that touch the vault go through the storage queue.
 */
export class BackupController {
  constructor(
    private readonly _backups: BackupService,
    private readonly _projects: ProjectService,
    private readonly _queue: SerialQueue,
    /** Called with the new index after an import changed the vault. */
    private readonly _onImported: (index: VaultIndex) => void,
  ) {}

  exportAll() {
    return this._export(null, 'envstash-all.json');
  }

  exportProject(projectId: string) {
    const p = this._projects.getIndex().projects.find(p => p.id === projectId);
    const fname = `envstash-${(p?.name ?? 'project').replace(/[^a-z0-9]/gi, '-').toLowerCase()}.json`;
    return this._export(projectId, fname);
  }

  async importFromFile(merge: boolean) {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
      filters: FILE_FILTERS, openLabel: 'Import'
    });
    if (!uris?.length) return;
    const raw = Buffer.from(await vscode.workspace.fs.readFile(uris[0])).toString('utf8');

    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error('Invalid JSON file'); }
    if (isEncryptedBundle(parsed)) {
      const pass = await vscode.window.showInputBox({
        title: 'EnvStash import', prompt: 'This backup is encrypted. Enter its passphrase.',
        password: true, ignoreFocusOut: true
      });
      if (!pass) return;
      const json = await decryptBundle(parsed, pass);
      try { parsed = JSON.parse(json); } catch { throw new Error('Invalid EnvStash export file'); }
    }
    BackupService.assertBundle(parsed);
    const bundle = parsed;

    const result = await this._queue.add(() => this._backups.apply(bundle, merge));
    this._onImported(result.index);
    vscode.window.showInformationMessage(`✓ Imported ${result.projects} project(s), ${result.environments} environment(s)`);
  }

  private async _export(projectId: string | null, fname: string) {
    const pass = await this._askNewPassphrase();
    if (pass === undefined) return;
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(fname),
      filters: FILE_FILTERS,
      saveLabel: 'Export'
    });
    if (!uri) return;
    const json = JSON.stringify(await this._queue.add(() => this._backups.build(projectId)), null, 2);
    const out = pass ? JSON.stringify(await encryptBundle(json, pass), null, 2) : json;
    await vscode.workspace.fs.writeFile(uri, Buffer.from(out, 'utf8'));
    vscode.window.showInformationMessage(`✓ Exported to ${path.basename(uri.fsPath)}${pass ? ' (encrypted)' : ' (not encrypted)'}`);
  }

  // Returns the passphrase, '' for a deliberately unencrypted export, or undefined if cancelled
  private async _askNewPassphrase(): Promise<string | undefined> {
    const pass = await vscode.window.showInputBox({
      title: 'EnvStash export',
      prompt: 'Passphrase to encrypt this backup. Leave empty to export as plain text.',
      password: true, ignoreFocusOut: true,
      validateInput: v => v && v.length < MIN_PASSPHRASE ? `Use at least ${MIN_PASSPHRASE} characters` : undefined
    });
    if (pass === undefined) return undefined;
    if (!pass) {
      const choice = await vscode.window.showWarningMessage('Export without encryption?',
        { modal: true, detail: 'The file will contain every secret in plain text.' }, 'Export unencrypted');
      return choice ? '' : undefined;
    }
    const again = await vscode.window.showInputBox({
      title: 'EnvStash export', prompt: 'Confirm passphrase', password: true, ignoreFocusOut: true
    });
    if (again === undefined) return undefined;
    if (again !== pass) throw new Error('Passphrases do not match');
    return pass;
  }
}
