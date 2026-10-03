import { EnvVar, Runbook } from '../model';
import { VaultStore } from '../storage/vaultStore';
import { uid } from '../util';
import { parseDotenv } from './dotenv';

export interface DotenvImportResult { vars: EnvVar[]; added: number; updated: number; }

/** Rules for what lives inside one environment: its variables, runbook and notes. */
export class EnvDataService {
  constructor(private readonly _store: VaultStore) {}

  // ── Variables ───────────────────────────────────────────────────
  getVars(pid: string, eid: string): Promise<EnvVar[]> {
    return this._store.getVars(pid, eid);
  }

  /** Adds a variable, or updates the one with the same id. Returns the full list. */
  async saveVar(pid: string, eid: string, input: Partial<EnvVar> | undefined): Promise<EnvVar[]> {
    const key = (input?.key ?? '').trim();
    if (!key) throw new Error('Variable key cannot be empty');
    const value = input?.value ?? '';
    const vars = await this._store.getVars(pid, eid);
    const existing = vars.find(v => v.id === input?.id);
    if (existing) {
      existing.key = key;
      existing.value = value;
    } else {
      if (vars.some(v => v.key === key)) throw new Error(`Key "${key}" already exists`);
      vars.push({ id: input?.id || uid(), key, value });
    }
    await this._store.saveVars(pid, eid, vars);
    return vars;
  }

  async deleteVar(pid: string, eid: string, varId: string): Promise<EnvVar[]> {
    const vars = (await this._store.getVars(pid, eid)).filter(v => v.id !== varId);
    await this._store.saveVars(pid, eid, vars);
    return vars;
  }

  /** Merges a pasted .env block: existing keys are updated in place, new keys appended. */
  async importDotenv(pid: string, eid: string, text: string): Promise<DotenvImportResult> {
    const existing = await this._store.getVars(pid, eid);
    const newVars: EnvVar[] = [];
    let updated = 0;
    for (const { key, value } of parseDotenv(text)) {
      const match = existing.find(v => v.key === key);
      if (match) {
        match.value = value;
        updated++;
      } else {
        newVars.push({ id: uid(), key, value });
      }
    }
    const vars = [...existing, ...newVars];
    await this._store.saveVars(pid, eid, vars);
    return { vars, added: newVars.length, updated };
  }

  // ── Runbook ─────────────────────────────────────────────────────
  getRunbook(pid: string, eid: string): Promise<Runbook> {
    return this._store.getRunbook(pid, eid);
  }

  async saveRunbook(pid: string, eid: string, data: Runbook | undefined) {
    if (!data?.stages) throw new Error('Invalid runbook data');
    await this._store.saveRunbook(pid, eid, data);
  }

  // ── Notes ───────────────────────────────────────────────────────
  getNotes(pid: string, eid: string): Promise<string> {
    return this._store.getNotes(pid, eid);
  }

  async saveNotes(pid: string, eid: string, notes: string | undefined) {
    await this._store.saveNotes(pid, eid, notes ?? '');
  }
}
