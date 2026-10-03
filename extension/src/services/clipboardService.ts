import * as vscode from 'vscode';
import { config } from '../config';

/** Copies text, and takes secrets back off the clipboard after a while. */
export class ClipboardService {
  private _pending?: { text: string; timer: NodeJS.Timeout };

  /** Returns the delay in seconds after which the text will be cleared (0 = never). */
  async copy(text: string, secret: boolean): Promise<number> {
    await vscode.env.clipboard.writeText(text);
    this._cancel();
    const secs = secret ? config.clipboardClearSeconds() : 0;
    if (secs > 0) {
      const timer = setTimeout(() => { this._pending = undefined; void clearIfUnchanged(text); }, secs * 1000);
      this._pending = { text, timer };
    }
    return secs;
  }

  /** Clears a secret still waiting on its timer, e.g. when VS Code shuts down first. */
  async dispose() {
    const pending = this._pending;
    if (!pending) return;
    this._cancel();
    await clearIfUnchanged(pending.text);
  }

  private _cancel() {
    if (this._pending) clearTimeout(this._pending.timer);
    this._pending = undefined;
  }
}

// leave the clipboard alone if the user has copied something else since
async function clearIfUnchanged(text: string) {
  try {
    if (await vscode.env.clipboard.readText() === text) await vscode.env.clipboard.writeText('');
  } catch { /* clipboard unavailable */ }
}
