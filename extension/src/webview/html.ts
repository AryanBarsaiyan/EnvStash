import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { VaultIndex } from '../model';
import { SVG } from '../svgs';

/** What the page script receives as `__INITIAL__` when it starts. */
export interface InitialData {
  index: VaultIndex;
  autoHideMs: number;
  /** Environment to open straight away instead of the project list. */
  open?: { projectId: string; envId: string };
}

/** Assembles the panel page from webview/index.html, style.css and the scripts in webview/js. */
export function renderPanelHtml(extensionPath: string, data: InitialData): string {
  const dir = path.join(extensionPath, 'webview');
  const read = (file: string) => fs.readFileSync(path.join(dir, file), 'utf8');

  // The page runs one script: the files in webview/js joined in name order, so they share
  // a scope and the numeric prefixes decide what is defined first
  const scripts = fs.readdirSync(path.join(dir, 'js')).filter(f => f.endsWith('.js')).sort();

  // function replacers throughout: the inserted text may contain "$&"-style patterns
  let html = read('index.html');
  const css = read('style.css');
  const js = scripts.map(f => read(path.join('js', f))).join('\n');
  html = html.replace('/*PLACEHOLDER_CSS*/', () => css);
  html = html.replace('/*PLACEHOLDER_JS*/', () => js);

  // Replace SVG placeholders
  html = html.replace(/\$\{SVG\.([a-zA-Z_]+)\}/g, (_, name) => (SVG as Record<string, string>)[name] ?? '');

  // Only the nonce'd script may run; inline event handlers and remote content are blocked
  const nonce = crypto.randomBytes(16).toString('base64');
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'`;
  html = html.replace('__CSP__', () => csp).replace('__NONCE__', () => nonce);

  // User data goes in last so nothing above can rewrite it, with "<" escaped so it can't close the script tag
  const initialData = `const __INITIAL__ = ${JSON.stringify(data).replace(/</g, '\\u003c')};`;
  return html.replace('/*PLACEHOLDER_DATA*/', () => initialData);
}
