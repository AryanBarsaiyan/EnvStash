'use strict';
// Loads the real webview HTML into jsdom and wires it to a test host, so a test can
// click through the panel exactly as a user would while the real extension code answers.
const { JSDOM, VirtualConsole } = require('jsdom');
const { createHost, sleep } = require('./host');

const clone = value => JSON.parse(JSON.stringify(value));

/**
 *   const panel = openPanel();            // or openPanel(existingHost)
 *   await panel.click('.dashed-btn');
 *   panel.text('.proj-name')
 */
function openPanel(host = createHost()) {
  const errors = [];
  const pending = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));

  const dom = new JSDOM(host.html(), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      // messages cross the webview boundary as structured clones, never shared objects
      window.acquireVsCodeApi = () => ({ postMessage: message => { pending.push(host.send(clone(message))); } });
      // jsdom has no editing commands; the panel then falls back to setRangeText
      window.document.execCommand = () => false;
    },
  });
  const { window } = dom;
  const { document } = window;
  host.onPost = message => window.dispatchEvent(new window.MessageEvent('message', { data: clone(message) }));

  const find = target => typeof target === 'string' ? document.querySelector(target) : target;
  const need = target => {
    const el = find(target);
    if (!el) throw new Error(`no element matches ${target}`);
    return el;
  };

  const panel = {
    host, dom, window, document, errors,
    $: selector => document.querySelector(selector),
    $$: selector => [...document.querySelectorAll(selector)],
    text: target => need(target).textContent.trim(),
    visible: target => {
      for (let el = find(target); el && el !== document.body; el = el.parentElement) {
        if (window.getComputedStyle(el).display === 'none') return false;
      }
      return !!find(target);
    },

    /** Waits until the extension has answered everything the panel sent. */
    async settle() {
      while (pending.length) await pending.shift();
      await host.settle();
    },
    async click(target) {
      need(target).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await panel.settle();
    },
    /** Replaces a field's content the way typing does (fires "input"). */
    async type(target, value) {
      const el = need(target);
      el.value = value;
      el.dispatchEvent(new window.Event('input', { bubbles: true }));
      await panel.settle();
    },
    async fire(target, type, init = {}) {
      const event = new window.Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, init);
      need(target).dispatchEvent(event);
      await panel.settle();
      return event;
    },
    async setHidden(hidden) {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      document.dispatchEvent(new window.Event('visibilitychange'));
      await panel.settle();
    },

    // ── common user journeys ──
    async createProject(name) {
      await panel.click('#projList .dashed-btn');
      await panel.type('#projName', name);
      await panel.click('#projModal .btn-primary');
    },
    async createEnv(name, projectIndex = 0) {
      const card = panel.$$('.proj-card')[projectIndex];
      if (!card.querySelector('.env-area.open')) await panel.click(card.querySelector('.proj-row'));
      await panel.click(panel.$$('.proj-card')[projectIndex].querySelector('.add-env-btn'));
      await panel.type('#envName', name);
      await panel.click('#envModal .btn-primary');
    },
    async openEnv(name) {
      const pill = panel.$$('.env-pill').find(p => p.firstChild.textContent.trim() === name);
      if (!pill) throw new Error(`no environment pill named ${name}`);
      await panel.click(pill);
    },
    async addVar(key, value) {
      await panel.click('.add-var-row');
      await panel.type('#nKey', key);
      await panel.type('#nVal', value);
      await panel.click('#addForm .btn-primary');
    },
    varRows: () => panel.$$('.var-row').map(row => ({
      key: row.querySelector('.var-key').textContent,
      value: row.querySelector('.var-val').textContent,
      row,
    })),

    async close() {
      await panel.settle();
      window.close();
      await host.close();
    },
  };
  return panel;
}

module.exports = { openPanel, sleep };
