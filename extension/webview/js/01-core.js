'use strict';
const vsc = acquireVsCodeApi();
const G   = id => document.getElementById(id);
const ESC = s => (s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const ATTR= s => ESC(String(s??'')).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
// Click wiring for generated markup: handled by the delegated listener in "Event wiring"
const ON  = (name,...args) => `data-act="${name}"` + (args.length ? ` data-args="${ATTR(JSON.stringify(args))}"` : '');
const COLOR = c => /^#[0-9a-fA-F]{3,8}$/.test(c||'') ? c : '#4ec994';

/* ── SVG icon refs (inlined by template) ── */
/* Icons come from the HTML literals above — no runtime refs needed */

const PALETTE = [
  '#4ec994','#f48771','#dca84f','#569cd6','#c586c0',
  '#9cdcfe','#61afef','#e06c75','#98c379','#e5c07b',
  '#56b6c2','#d19a66','#abb2bf','#ff79c6','#bd93f9','#50fa7b'
];

/* ── State ── */
let idx     = {projects:[]};
let openSet = new Set();      // expanded project ids
let expandedStages = new Set();  // expanded stage ids
let active  = null;           // {projectId,envId,name,color}
let vars    = [];
let rb      = {stages:[]};    // current runbook
let revealed= {};
let revAll  = false;
let activeTab = 'vars';

// modal state
let envMode='create', envPid=null, envEid=null;
let projMode='create', projId=null;
let stgMode='create',  stgIdx=-1;
let cmdStg=-1, cmdIdx=-1;
let selColor='#4ec994';
let confCb=null;
let menuOpen=false;

/* ── Boot ── */
if (typeof __INITIAL__ !== 'undefined') {
  idx = __INITIAL__.index;
  renderProjs();
} else {
  vsc.postMessage({type:'getIndex'});
}

window.addEventListener('message', e => {
  const m=e.data;
  if (m.type==='index')   {
    idx=m.data; renderProjs();
    // a backup import may have replaced the open env's notes
    if (active && !notesTimeout) {
      if (activeTab==='notes') vsc.postMessage({type:'getNotes',projectId:active.projectId,envId:active.envId});
      else notesFor=null;
    }
  }
  if (m.type==='vars' && active && m.projectId===active.projectId && m.envId===active.envId) {
    vars=m.data; renderVars();
  }
  if (m.type==='openEnv') openEnvFromHost(m);
  if (m.type==='compare') onCompareResult(m);
  if (m.type==='runbook' && active && m.projectId===active.projectId && m.envId===active.envId) {
    rb=m.data||{stages:[]}; renderRb();
  }
  if (m.type==='notes' && active && m.projectId===active.projectId && m.envId===active.envId) {
    if (notesTimeout) return; // unsaved local edits are newer than this reply
    const data = m.data || '', el = G('notesArea');
    const first = notesFor !== notesKeyOf(active);
    if (el.value !== data) el.value = data;
    el.readOnly = false;
    notesFor = notesKeyOf(active);
    updateNotesCount();
    setNotesStatus('Saved');
    if (first) setNotesMode(data.trim() ? 'preview' : 'edit');
    else if (notesMode === 'preview') G('notesPreview').innerHTML = renderMarkdown(data);
  }
});

/* ── Screen switch ── */
function showScreen(s){
  G('sProj').classList.toggle('active',s==='proj');
  G('sEnv').classList.toggle('active', s==='env');
}
function goBack(){
  flushNotes();notesFor=null;clearTimeout(hideTimer);
  active=null;vars=[];rb={stages:[]};revealed={};revAll=false;expandedStages=new Set();
  renderProjs(); showScreen('proj');
}

