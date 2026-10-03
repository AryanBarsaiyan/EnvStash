import { BUNDLE_VERSION, DEFAULT_ENV_COLOR, ExportBundle, VaultIndex } from '../model';
import { VaultStore } from '../storage/vaultStore';
import { uid } from '../util';

export interface ImportResult { index: VaultIndex; projects: number; environments: number; }

/** Turns the vault into a portable bundle and back. No dialogs, no files, no encryption. */
export class BackupService {
  constructor(private readonly _store: VaultStore) {}

  /** Collects one project, or every project when `projectId` is null. */
  async build(projectId: string | null): Promise<ExportBundle> {
    const idx = this._store.getIndex();
    const projects = projectId ? idx.projects.filter(p => p.id === projectId) : idx.projects;
    const result: ExportBundle['projects'] = [];
    for (const p of projects) {
      const envs = [];
      for (const e of p.envs) {
        envs.push({
          id: e.id, name: e.name, color: e.color,
          vars:    await this._store.getVars(p.id, e.id),
          runbook: await this._store.getRunbook(p.id, e.id),
          notes:   await this._store.getNotes(p.id, e.id),
        });
      }
      result.push({ id: p.id, name: p.name, envs });
    }
    return { version: BUNDLE_VERSION, exportedAt: new Date().toISOString(), projects: result };
  }

  /** Checks that parsed JSON has the shape of a bundle. */
  static assertBundle(value: unknown): asserts value is ExportBundle {
    if (!Array.isArray((value as ExportBundle | null)?.projects)) throw new Error('Invalid EnvStash export file');
  }

  /**
   * Writes a bundle into the vault. Projects and environments are matched by id, then by
   * name, so a backup from another machine lands in the existing entries instead of
   * duplicating them. With `merge`, variables missing from the bundle are kept.
   */
  async apply(bundle: ExportBundle, merge: boolean): Promise<ImportResult> {
    const idx = this._store.getIndex();
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
          env = { id: be.id || uid(), name: be.name.trim(), color: be.color || DEFAULT_ENV_COLOR };
          proj.envs.push(env);
        }
        if (be.vars?.length) {
          const existing = merge ? await this._store.getVars(proj.id, env.id) : [];
          const merged = [...existing];
          for (const v of be.vars) {
            if (!v.key?.trim()) continue;
            const exIdx = merged.findIndex(m => m.key === v.key);
            if (exIdx >= 0) merged[exIdx].value = v.value ?? '';
            else merged.push({ id: v.id || uid(), key: v.key.trim(), value: v.value ?? '' });
          }
          await this._store.saveVars(proj.id, env.id, merged);
        }
        if (be.runbook?.stages?.length) {
          await this._store.saveRunbook(proj.id, env.id, be.runbook);
        }
        if (be.notes) {
          await this._store.saveNotes(proj.id, env.id, be.notes);
        }
        imported++;
      }
    }
    await this._store.saveIndex(idx);
    return { index: idx, projects: bundle.projects.length, environments: imported };
  }
}
