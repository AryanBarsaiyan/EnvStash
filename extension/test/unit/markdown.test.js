'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { openPanel } = require('../helpers/panel');

const panel = openPanel();
after(() => panel.close());
const md = text => panel.window.renderMarkdown(text);

// Renders into a detached element so structure can be asserted without string matching
function dom(text) {
  const root = panel.document.createElement('div');
  root.innerHTML = md(text);
  return root;
}

test('shows a placeholder when there is nothing to render', () => {
  for (const empty of ['', '   \n  ', null, undefined]) assert.match(md(empty), /class="empty-notes"/);
});

test('renders headings, capping the level at h3', () => {
  assert.equal(md('# One'), '<h1>One</h1>');
  assert.equal(md('## Two'), '<h2>Two</h2>');
  assert.equal(md('### Three'), '<h3>Three</h3>');
  assert.equal(md('##### Five'), '<h3>Five</h3>');
  assert.equal(md('#NoSpace'), '<p>#NoSpace</p>');
});

test('keeps single line breaks inside a paragraph and splits on blank lines', () => {
  assert.equal(md('a\nb\n\nc'), '<p>a<br>b</p><p>c</p>');
});

test('renders bold, italic, strikethrough and inline code', () => {
  assert.equal(md('**b** *i* ~~s~~ `c`'), '<p><strong>b</strong> <em>i</em> <del>s</del> <code>c</code></p>');
});

test('does not format inside inline code or code blocks', () => {
  assert.equal(md('`DB_*_HOST and **x**`'), '<p><code>DB_*_HOST and **x**</code></p>');
  assert.equal(md('```\n**not bold**\n# not heading\n- not list\n```'), '<pre><code>**not bold**\n# not heading\n- not list</code></pre>');
});

test('renders a code block that is never closed', () => {
  assert.equal(md('```js\nlet a = 1;'), '<pre><code>let a = 1;</code></pre>');
});

test('renders bullet lists with either marker', () => {
  assert.equal(md('- a\n* b\n+ c'), '<ul><li>a</li><li>b</li><li>c</li></ul>');
});

test('indents nested list items', () => {
  const items = [...dom('- a\n  - b\n    - c\n          - deep').querySelectorAll('li')];
  assert.deepEqual(items.map(li => li.className), ['', 'd1', 'd2', 'd3']);
});

test('renders numbered lists and keeps the starting number', () => {
  assert.equal(md('3. c\n4. d'), '<ol start="3"><li>c</li><li>d</li></ol>');
  assert.equal(md('- a\n1. b'), '<ul><li>a</li></ul><ol start="1"><li>b</li></ol>');
});

test('renders checklists with their state and source line', () => {
  const boxes = [...dom('intro\n- [ ] todo\n- [x] done\n- [X] also done').querySelectorAll('input[type=checkbox]')];
  assert.deepEqual(boxes.map(b => b.checked), [false, true, true]);
  assert.deepEqual(boxes.map(b => b.dataset.line), ['1', '2', '3']);
  assert.deepEqual(boxes.map(b => b.closest('li').classList.contains('done')), [false, true, true]);
});

test('renders block quotes and horizontal rules', () => {
  assert.equal(md('> a\n> b'), '<blockquote>a<br>b</blockquote>');
  assert.equal(md('---'), '<hr>');
  assert.equal(md('***'), '<hr>');
  assert.equal(md('a\n\n---\n\nb'), '<p>a</p><hr><p>b</p>');
});

test('renders markdown links and bare URLs', () => {
  const [link] = dom('[docs](https://example.com/a?x=1&y=2)').querySelectorAll('a');
  assert.equal(link.getAttribute('href'), 'https://example.com/a?x=1&y=2');
  assert.equal(link.textContent, 'docs');

  const [bare] = dom('see https://example.com/a_b. next').querySelectorAll('a');
  assert.equal(bare.getAttribute('href'), 'https://example.com/a_b', 'trailing full stop is not part of the URL');
});

test('underscores and asterisks in a URL do not become formatting', () => {
  const [link] = dom('https://example.com/*a*/__b__').querySelectorAll('a');
  assert.equal(link.getAttribute('href'), 'https://example.com/*a*/__b__');
  assert.equal(link.querySelector('em'), null);
});

test('handles Windows line endings', () => {
  assert.equal(md('a\r\nb\r\n\r\n- c'), '<p>a<br>b</p><ul><li>c</li></ul>');
});

// ── notes are untrusted: they can arrive through an imported backup ──
test('escapes HTML in every position', () => {
  for (const text of [
    '<img src=x onerror=alert(1)>',
    '# <script>alert(1)</script>',
    '- <b onclick=alert(1)>x</b>',
    '> <iframe src=x>',
    '`<svg onload=alert(1)>`',
    '```\n</code></pre><script>alert(1)</script>\n```',
    '**<u>x</u>**',
  ]) {
    const root = dom(text);
    assert.equal(root.querySelector('img,script,b,iframe,svg,u'), null, `raw HTML leaked for: ${text}`);
  }
});

test('refuses links that are not http, https or mailto', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd']) {
    assert.equal(dom(`[x](${url})`).querySelector('a'), null, url);
  }
  assert.equal(dom('[m](mailto:a@b.co)').querySelector('a').getAttribute('href'), 'mailto:a@b.co');
});

test('a quote in a link cannot break out of the href attribute', () => {
  const link = dom('[y](https://a.com/"onmouseover="alert(1))').querySelector('a');
  assert.deepEqual(link.getAttributeNames().sort(), ['href', 'title']);
});

test('formatEnvValue quotes only when needed and escapes what it quotes', () => {
  const f = panel.window.formatEnvValue;
  assert.equal(f('plain'), 'plain');
  assert.equal(f(''), '');
  assert.equal(f('has space'), '"has space"');
  assert.equal(f('a"b'), '"a\\"b"');
  assert.equal(f('back\\slash here'), '"back\\\\slash here"');
  assert.equal(f('$HOME'), '"$HOME"');
  assert.equal(f('two\nlines'), '"two\nlines"');
});
