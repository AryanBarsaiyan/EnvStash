/* ── Environment Notes ── */
let notesTimeout = null;
let notesMode = 'edit';
let notesFor = null;      // "projectId/envId" whose notes are loaded in the editor
let notesPending = null;  // env the unsaved edits belong to

function notesKeyOf(a) { return a ? a.projectId + '/' + a.envId : null; }

function setNotesStatus(text, busy) {
  const el = G('notesStatus');
  el.textContent = text;
  el.classList.toggle('busy', !!busy);
}

function updateNotesCount() {
  const v = G('notesArea').value;
  const w = (v.match(/\S+/g) || []).length;
  G('notesCount').textContent = w ? `${w} word${w === 1 ? '' : 's'} · ${v.length} chars` : '';
}

function setNotesMode(mode) {
  notesMode = mode;
  G('btnNotesEdit').classList.toggle('active', mode === 'edit');
  G('btnNotesPrev').classList.toggle('active', mode === 'preview');
  G('notesFormatBar').style.visibility = mode === 'edit' ? 'visible' : 'hidden';
  G('notesArea').style.display = mode === 'edit' ? 'block' : 'none';
  G('notesPreview').style.display = mode === 'preview' ? 'block' : 'none';

  if (mode === 'preview') {
    G('notesPreview').innerHTML = renderMarkdown(G('notesArea').value);
  }
}

function onNotesInput() {
  if (!active || notesFor !== notesKeyOf(active)) return;
  notesPending = { projectId: active.projectId, envId: active.envId };
  setNotesStatus('Saving…', true);
  updateNotesCount();
  clearTimeout(notesTimeout);
  notesTimeout = setTimeout(flushNotes, 800);
}

// Writes pending edits immediately; call before leaving the env or the tab.
function flushNotes() {
  if (!notesTimeout) return;
  clearTimeout(notesTimeout);
  notesTimeout = null;
  vsc.postMessage({
    type: 'saveNotes',
    projectId: notesPending.projectId,
    envId: notesPending.envId,
    notes: G('notesArea').value
  });
  setNotesStatus('Saved');
}

/* ── Notes editing helpers ── */
function notesReplace(start, end, text, selStart, selEnd) {
  const el = G('notesArea');
  if (el.readOnly) return;
  el.focus();
  el.setSelectionRange(start, end);
  // execCommand keeps the textarea's undo history intact
  const ok = text === ''
    ? (start === end || document.execCommand('delete'))
    : document.execCommand('insertText', false, text);
  if (!ok) el.setRangeText(text, start, end, 'end');
  if (selStart != null) el.setSelectionRange(selStart, selEnd ?? selStart);
  onNotesInput();
}

function notesWrap(prefix, suffix, placeholder) {
  const el = G('notesArea');
  const s = el.selectionStart, e = el.selectionEnd;
  const sel = el.value.substring(s, e) || placeholder;
  notesReplace(s, e, prefix + sel + suffix, s + prefix.length, s + prefix.length + sel.length);
}

function notesLinePrefix(prefix) {
  const el = G('notesArea');
  const v = el.value, s = el.selectionStart;
  let e = el.selectionEnd;
  if (e > s && v[e - 1] === '\n') e--;
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  let le = v.indexOf('\n', e);
  if (le < 0) le = v.length;
  const lines = v.substring(ls, le).split('\n');
  const all = lines.every(l => l.startsWith(prefix));
  const out = lines.map(l => all ? l.slice(prefix.length) : (l.startsWith(prefix) ? l : prefix + l)).join('\n');
  if (lines.length > 1) notesReplace(ls, le, out, ls, ls + out.length);
  else notesReplace(ls, le, out, ls + out.length);
}

function notesCode() {
  const el = G('notesArea');
  const v = el.value, s = el.selectionStart, e = el.selectionEnd;
  if (!v.substring(s, e).includes('\n')) { notesWrap('`', '`', 'code'); return; }
  const pre = (s > 0 && v[s - 1] !== '\n' ? '\n' : '') + '```\n';
  const suf = '\n```' + (e < v.length && v[e] !== '\n' ? '\n' : '');
  notesWrap(pre, suf, '');
}

function notesLink() {
  const el = G('notesArea');
  const s = el.selectionStart, e = el.selectionEnd;
  const sel = el.value.substring(s, e);
  if (/^https?:\/\/\S+$/i.test(sel)) notesReplace(s, e, '[text](' + sel + ')', s + 1, s + 5);
  else {
    const t = sel || 'text';
    notesReplace(s, e, '[' + t + '](https://)', s + t.length + 3, s + t.length + 11);
  }
}

// Enter continues a list / checklist; Enter on an empty item ends it
G('notesArea').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  const el = e.target;
  const s = el.selectionStart;
  if (s !== el.selectionEnd) return;
  const ls = el.value.lastIndexOf('\n', s - 1) + 1;
  const m = /^(\s*)([-*+]|(\d+)([.)]))\s+(\[[ xX]\]\s+)?(.*)$/.exec(el.value.substring(ls, s));
  if (!m) return;
  e.preventDefault();
  if (!m[6]) { notesReplace(ls, s, ''); return; }
  const marker = m[3] ? (Number(m[3]) + 1) + m[4] : m[2];
  notesReplace(s, s, '\n' + m[1] + marker + ' ' + (m[5] ? '[ ] ' : ''));
});

// Ticking a checkbox in the preview updates the matching "- [ ]" line
G('notesPreview').addEventListener('change', e => {
  const t = e.target;
  if (!t.matches || !t.matches('input[data-line]')) return;
  const el = G('notesArea');
  const lines = el.value.split('\n');
  const i = Number(t.dataset.line);
  if (lines[i] == null) return;
  lines[i] = lines[i].replace(/\[( |x|X)\]/, t.checked ? '[x]' : '[ ]');
  el.value = lines.join('\n');
  onNotesInput();
  G('notesPreview').innerHTML = renderMarkdown(el.value);
});
