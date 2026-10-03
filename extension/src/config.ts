import * as vscode from 'vscode';

const MAX_SECONDS = 3600;

/** Reads an `envstash.*` duration setting in seconds; 0 means "turned off". */
function seconds(name: string, fallback: number): number {
  const n = vscode.workspace.getConfiguration('envstash').get<number>(name, fallback);
  return typeof n === 'number' && n > 0 ? Math.min(n, MAX_SECONDS) : 0;
}

export const config = {
  clipboardClearSeconds: () => seconds('clipboardClearSeconds', 30),
  autoHideSeconds: () => seconds('autoHideSeconds', 30),
};
