/* ── Markdown rendering ── */
function mdInline(raw) {
  // Finished HTML is stashed so later rules can't rewrite it
  const stash = [];
  const keep = h => { stash.push(h); return '\x01' + (stash.length - 1) + '\x01'; };
  let s = ESC(raw).replace(/"/g, '&quot;');
  s = s.replace(/`([^`]+)`/g, (_, c) => keep('<code>' + c + '</code>'));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) =>
    /^(https?:\/\/|mailto:)/i.test(u) ? keep('<a href="' + u + '" title="' + u + '">') + t + keep('</a>') : m);
  s = s.replace(/(^|[\s(])(https?:\/\/\S*[^\s.,;:!?)])/g, (_, p, u) => p + keep('<a href="' + u + '">' + u + '</a>'));
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
       .replace(/\*(.+?)\*/g, '<em>$1</em>')
       .replace(/~~(.+?)~~/g, '<del>$1</del>');
  return s.replace(/\x01(\d+)\x01/g, (_, i) => stash[Number(i)]);
}

function renderMarkdown(md) {
  if (!md || !md.trim()) {
    return '<div class="empty-notes"><b>No notes yet</b><span>Switch to Write to add setup steps, links or reminders.</span></div>';
  }
  const FENCE = /^\s*```/, HEAD = /^(#{1,6})\s+(.*)$/, HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
  const QUOTE = /^\s*>\s?(.*)$/, LIST = /^(\s*)([-*+]|(\d+)[.)])\s+(.*)$/;
  // Keep one entry per source line so checkbox data-line indexes stay valid
  const lines = md.split('\n').map(l => l.replace(/\r$/, '').replace(/\x01/g, ''));
  const out = [];
  let i = 0, m;
  while (i < lines.length) {
    const line = lines[i];
    if (FENCE.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push('<pre><code>' + ESC(buf.join('\n')) + '</code></pre>');
      continue;
    }
    if (!line.trim()) { i++; continue; }
    if ((m = HEAD.exec(line))) {
      const n = Math.min(m[1].length, 3);
      out.push(`<h${n}>${mdInline(m[2].replace(/\s+#+\s*$/, ''))}</h${n}>`);
      i++;
      continue;
    }
    if (HR.test(line)) { out.push('<hr>'); i++; continue; }
    if (QUOTE.test(line)) {
      const buf = [];
      while (i < lines.length && (m = QUOTE.exec(lines[i]))) { buf.push(mdInline(m[1])); i++; }
      out.push('<blockquote>' + buf.join('<br>') + '</blockquote>');
      continue;
    }
    if (LIST.test(line)) {
      let html = '', tag = '';
      while (i < lines.length && !HR.test(lines[i]) && (m = LIST.exec(lines[i]))) {
        const t = m[3] ? 'ol' : 'ul';
        if (t !== tag) {
          if (tag) html += '</' + tag + '>';
          tag = t;
          html += t === 'ol' ? '<ol start="' + Number(m[3]) + '">' : '<ul>';
        }
        const d = Math.min(Math.floor(m[1].replace(/\t/g, '  ').length / 2), 3);
        const task = /^\[( |x|X)\]\s+(.*)$/.exec(m[4]);
        if (task) {
          const done = task[1] !== ' ';
          html += `<li class="task${d ? ' d' + d : ''}${done ? ' done' : ''}"><input type="checkbox" data-line="${i}"${done ? ' checked' : ''}><span>${mdInline(task[2])}</span></li>`;
        } else {
          html += `<li${d ? ' class="d' + d + '"' : ''}>${mdInline(m[4])}</li>`;
        }
        i++;
      }
      out.push(html + '</' + tag + '>');
      continue;
    }
    const buf = [];
    do { buf.push(mdInline(lines[i++])); }
    while (i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !HEAD.test(lines[i])
           && !HR.test(lines[i]) && !QUOTE.test(lines[i]) && !LIST.test(lines[i]));
    out.push('<p>' + buf.join('<br>') + '</p>');
  }
  return out.join('');
}
