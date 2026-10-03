import type * as vscode from 'vscode';
import type { EnvVar } from '../model';

export type ShellKind = 'pwsh' | 'cmd' | 'bash';

/** How one family of shells spells "set these variables" and "run these in order". */
export interface ShellDialect {
  /** One command line that sets every variable. */
  exportVars(vars: EnvVar[]): string;
  /** One command line that runs each command only if the previous one succeeded. */
  chain(commands: string[]): string;
}

const DIALECTS: Record<ShellKind, ShellDialect> = {
  pwsh: {
    exportVars: vars => vars.map(v => `$env:${v.key}="${v.value.replace(/"/g, '`"')}"`).join('; '),
    chain: commands => commands.map((c, i) => i === 0 ? c : `if ($?) { ${c} }`).join('; '),
  },
  cmd: {
    exportVars: vars => vars.map(v => `set ${v.key}=${v.value}`).join(' && '),
    chain: commands => commands.join(' && '),
  },
  bash: {
    exportVars: vars => vars.map(v => `export ${v.key}="${v.value.replace(/"/g, '\\"')}"`).join(' && '),
    chain: commands => commands.join(' && '),
  },
};

export function dialectFor(term: vscode.Terminal): ShellDialect {
  return DIALECTS[detectShell(term)];
}

export function detectShell(term: vscode.Terminal): ShellKind {
  const name = term.name.toLowerCase();
  if (name.includes('powershell') || name.includes('pwsh')) {
    return 'pwsh';
  }
  if (/\bcmd\b|command prompt/.test(name)) {
    return 'cmd';
  }
  // whole words only: a bare "sh" substring also matches our own "EnvStash" terminal
  if (/\b(bash|zsh|sh|fish)\b/.test(name)) {
    return 'bash';
  }

  const opt = term.creationOptions as vscode.TerminalOptions;
  if (opt?.shellPath) {
    // match the executable name, not folder names along the path
    const exe = (opt.shellPath.toLowerCase().split(/[\\/]/).pop() ?? '').replace(/\.exe$/, '');
    if (exe === 'powershell' || exe === 'pwsh') {
      return 'pwsh';
    }
    if (exe === 'cmd') {
      return 'cmd';
    }
    if (['bash', 'zsh', 'sh', 'fish', 'dash', 'ksh'].includes(exe)) {
      return 'bash';
    }
  }

  if (process.platform === 'win32') {
    if (process.env.SHELL && (process.env.SHELL.includes('bash') || process.env.SHELL.includes('zsh'))) {
      return 'bash';
    }
    return 'pwsh';
  }
  return 'bash';
}
