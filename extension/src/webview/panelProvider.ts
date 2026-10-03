import * as vscode from 'vscode';
import { config } from '../config';
import { EnvRef } from '../services/activeEnvService';
import { ProjectService } from '../services/projectService';
import { errorMessage, SerialQueue } from '../util';
import { renderPanelHtml } from './html';
import { MessageHandlers } from './messageHandlers';

export function reportError(err: unknown) {
  vscode.window.showErrorMessage(`EnvStash error: ${errorMessage(err)}`);
}

/** Owns the sidebar webview: renders the page and routes its messages to handlers. */
export class PanelProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'envstash.panel';

  private _view?: vscode.WebviewView;
  private _handlers?: MessageHandlers;
  /** An environment to show as soon as the page loads, when asked before the panel existed. */
  private _pendingOpen?: EnvRef;

  constructor(
    private readonly _extensionPath: string,
    private readonly _projects: ProjectService,
    /** Storage work runs one at a time so a read can never overtake the write before it. */
    readonly queue: SerialQueue,
  ) {}

  /** Set once at start-up; separate from the constructor because handlers need `post`. */
  setHandlers(handlers: MessageHandlers) { this._handlers = handlers; }

  /** Sends a message to the page; a no-op while the panel has never been opened. */
  readonly post = (message: object) => { this._view?.webview.postMessage(message); };

  /** Brings the EnvStash panel into view. */
  async reveal() {
    await vscode.commands.executeCommand(`${PanelProvider.viewId}.focus`);
  }

  /** Shows the panel with the given environment open. */
  async openEnv(ref: EnvRef) {
    if (this._view) this.post({ type: 'openEnv', projectId: ref.projectId, envId: ref.envId });
    else this._pendingOpen = ref;
    await this.reveal();
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this._view = view;
    view.onDidDispose(() => { if (this._view === view) this._view = undefined; });
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = renderPanelHtml(this._extensionPath, {
      index: this._projects.getIndex(),
      autoHideMs: config.autoHideSeconds() * 1000,
      open: this._pendingOpen,
    });
    this._pendingOpen = undefined;
    view.webview.onDidReceiveMessage(message => this._dispatch(message));
  }

  private _dispatch(message: any): Promise<void> {
    const type = typeof message?.type === 'string' ? message.type : '';
    // own-property lookups only: "constructor" or "toString" must not resolve to a handler
    const pick = (table?: Record<string, Function>) => table && Object.prototype.hasOwnProperty.call(table, type) ? table[type] : undefined;

    const direct = pick(this._handlers?.direct);
    const queued = pick(this._handlers?.queued);
    let work: Promise<unknown>;
    if (direct) work = Promise.resolve().then(() => direct(message));
    else if (queued) work = this.queue.add(() => queued(message));
    else return Promise.resolve();
    return work.then(() => undefined, reportError);
  }
}
