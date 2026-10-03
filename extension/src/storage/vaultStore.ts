import * as vscode from 'vscode';
import { EnvVar, Runbook, VaultIndex } from '../model';
import { safeJson } from '../util';

// Storage keys are part of the on-disk format: changing one orphans existing users' data
const INDEX_KEY = 'envstash_index';
function envKey(pid: string, eid: string)  { return `envstash_proj_${pid}_env_${eid}`; }
function runKey(pid: string, eid: string)  { return `envstash_run_${pid}_env_${eid}`; }
function noteKey(pid: string, eid: string) { return `envstash_note_${pid}_env_${eid}`; }

/**
 * The only place that knows where data lives: the project/environment index in
 * global state, everything sensitive (variables, runbooks, notes) in secret storage.
 */
export class VaultStore {
  constructor(
    private readonly _state: vscode.Memento,
    private readonly _secrets: vscode.SecretStorage,
  ) {}

  getIndex(): VaultIndex {
    return safeJson(this._state.get<string>(INDEX_KEY), { projects: [] });
  }
  async saveIndex(index: VaultIndex) {
    await this._state.update(INDEX_KEY, JSON.stringify(index));
  }

  async getVars(pid: string, eid: string): Promise<EnvVar[]> {
    return safeJson(await this._secrets.get(envKey(pid, eid)), []);
  }
  async saveVars(pid: string, eid: string, vars: EnvVar[]) {
    await this._secrets.store(envKey(pid, eid), JSON.stringify(vars));
  }

  async getRunbook(pid: string, eid: string): Promise<Runbook> {
    return safeJson(await this._secrets.get(runKey(pid, eid)), { stages: [] });
  }
  async saveRunbook(pid: string, eid: string, rb: Runbook) {
    await this._secrets.store(runKey(pid, eid), JSON.stringify(rb));
  }

  async getNotes(pid: string, eid: string): Promise<string> {
    return await this._secrets.get(noteKey(pid, eid)) ?? '';
  }
  async saveNotes(pid: string, eid: string, notes: string) {
    await this._secrets.store(noteKey(pid, eid), notes);
  }

  /** Removes everything stored for one environment. */
  async deleteEnvData(pid: string, eid: string) {
    await this._secrets.delete(envKey(pid, eid));
    await this._secrets.delete(runKey(pid, eid));
    await this._secrets.delete(noteKey(pid, eid));
  }
}
