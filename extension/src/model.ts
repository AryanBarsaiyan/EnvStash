// ── Data model ────────────────────────────────────────────────────
export interface VaultIndex { projects: Project[]; }
export interface Project    { id: string; name: string; envs: Env[]; }
export interface Env        { id: string; name: string; color: string; }
export interface EnvVar     { id: string; key: string; value: string; }
export interface Runbook    { stages: Stage[]; }
export interface Stage      { id: string; name: string; commands: Cmd[]; }
export interface Cmd        { id: string; label: string; cmd: string; }

// Export bundle: everything in one JSON
export interface ExportBundle {
  version: string;
  exportedAt: string;
  projects: Array<{
    id: string; name: string;
    envs: Array<{
      id: string; name: string; color: string;
      vars: EnvVar[];
      runbook: Runbook;
      notes?: string;
    }>;
  }>;
}

export const BUNDLE_VERSION = '1.0.0';
export const DEFAULT_ENV_COLOR = '#4ec994';

/** Runbook command that expands to "set every variable of this environment". */
export const EXPORT_ENV_CMD = 'export-env';
