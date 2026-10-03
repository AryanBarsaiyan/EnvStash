import * as vscode from 'vscode';
import { Env, Project } from '../model';
import { ProjectService } from './projectService';

export interface EnvRef { projectId: string; envId: string; }

const ACTIVE_KEY = 'envstash_active_env';

/**
 * Remembers which environment this workspace is working with: the one last opened in
 * the panel or picked from the status bar. Stored per workspace, so each folder keeps its own.
 */
export class ActiveEnvService {
  /** Called after the active environment changes. */
  onDidChange?: () => void;

  constructor(
    private readonly _state: vscode.Memento,
    private readonly _projects: ProjectService,
  ) {}

  /** The active environment, or undefined if none is set or it has since been deleted. */
  resolve(): { project: Project; env: Env } | undefined {
    const ref = this._state.get<EnvRef>(ACTIVE_KEY);
    if (!ref) return undefined;
    const project = this._projects.getIndex().projects.find(p => p.id === ref.projectId);
    const env = project?.envs.find(e => e.id === ref.envId);
    return project && env ? { project, env } : undefined;
  }

  async set(ref: EnvRef) {
    await this._state.update(ACTIVE_KEY, { projectId: ref.projectId, envId: ref.envId });
    this.onDidChange?.();
  }
}
