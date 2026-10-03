import * as vscode from 'vscode';
import { config } from '../config';
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

  resolveWebviewView(view: vscode.WebviewView) {
    this._view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = renderPanelHtml(this._extensionPath, {
      index: this._projects.getIndex(),
      autoHideMs: config.autoHideSeconds() * 1000,
    });
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
