import { DEFAULT_ENV_COLOR, VaultIndex } from '../model';
import { VaultStore } from '../storage/vaultStore';
import { uid } from '../util';

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Rules for projects and their environments. Every method returns the index as it
 * stands afterwards, so callers can show it without a second read.
 */
export class ProjectService {
  constructor(private readonly _store: VaultStore) {}

  getIndex(): VaultIndex { return this._store.getIndex(); }

  // ── Projects ────────────────────────────────────────────────────
  async createProject(rawName: unknown): Promise<VaultIndex> {
    const name = requireName(rawName, 'Project');
    const idx = this._store.getIndex();
    if (idx.projects.some(p => sameName(p.name, name)))
      throw new Error(`Project "${name}" already exists`);
    idx.projects.push({ id: uid(), name, envs: [] });
    await this._store.saveIndex(idx);
    return idx;
  }

  async renameProject(projectId: string, rawName: unknown): Promise<VaultIndex> {
    const name = requireName(rawName, 'Project');
    const idx = this._store.getIndex();
    if (idx.projects.some(p => p.id !== projectId && sameName(p.name, name)))
      throw new Error(`Project "${name}" already exists`);
    const p = idx.projects.find(p => p.id === projectId);
    if (p) { p.name = name; await this._store.saveIndex(idx); }
    return idx;
  }

  async deleteProject(projectId: string): Promise<VaultIndex> {
    const idx = this._store.getIndex();
    const p = idx.projects.find(p => p.id === projectId);
    if (p) {
      for (const e of p.envs) await this._store.deleteEnvData(projectId, e.id);
      idx.projects = idx.projects.filter(p => p.id !== projectId);
      await this._store.saveIndex(idx);
    }
    return idx;
  }

  // ── Environments ────────────────────────────────────────────────
  async createEnv(projectId: string, rawName: unknown, color?: string): Promise<VaultIndex> {
    const name = requireName(rawName, 'Environment');
    const idx = this._store.getIndex();
    const p = idx.projects.find(p => p.id === projectId);
    if (!p) throw new Error('Project not found');
    if (p.envs.some(e => sameName(e.name, name)))
      throw new Error(`Environment "${name}" already exists in this project`);
    p.envs.push({ id: uid(), name, color: color || DEFAULT_ENV_COLOR });
    await this._store.saveIndex(idx);
    return idx;
  }

  async renameEnv(projectId: string, envId: string, rawName: unknown, color?: string): Promise<VaultIndex> {
    const name = requireName(rawName, 'Environment');
    const idx = this._store.getIndex();
    const p = idx.projects.find(p => p.id === projectId);
    if (!p) throw new Error('Project not found');
    if (p.envs.some(e => e.id !== envId && sameName(e.name, name)))
      throw new Error(`Environment "${name}" already exists`);
    const e = p.envs.find(e => e.id === envId);
    if (e) { e.name = name; e.color = color || e.color; await this._store.saveIndex(idx); }
    return idx;
  }

  async deleteEnv(projectId: string, envId: string): Promise<VaultIndex> {
    const idx = this._store.getIndex();
    const p = idx.projects.find(p => p.id === projectId);
    if (p) {
      await this._store.deleteEnvData(projectId, envId);
      p.envs = p.envs.filter(e => e.id !== envId);
      await this._store.saveIndex(idx);
    }
    return idx;
  }
}

function requireName(raw: unknown, what: 'Project' | 'Environment'): string {
  const name = (typeof raw === 'string' ? raw : '').trim();
  if (!name) throw new Error(`${what} name cannot be empty`);
  return name;
}
