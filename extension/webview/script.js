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


/* ── Projects render ── */
function renderProjs(){
  const el=G('projList');
  if(!idx.projects.length){
    el.innerHTML=`<div class="empty">
      <div class="empty-ico">${SVG.lock}</div>
      <div class="empty-h">No projects yet</div>
      <div class="empty-p">Create a project to securely store environment variables and runbooks.</div>
    </div>
    <button class="dashed-btn" ${ON('openNewProj')}>${SVG.plus} Create project</button>`;
    return;
  }
  let h='';
  for(const p of idx.projects){
    const open=openSet.has(p.id);
    h+=`<div class="proj-card">
      <div class="proj-row" ${ON('toggleProj',p.id)}>
        <span class="proj-chevron ${open?'open':''}">${SVG.chevron}</span>
        <span class="proj-icon">${SVG.folder}</span>
        <span class="proj-name">${ESC(p.name)}</span>
        <div class="proj-acts" data-stop>
          <button class="row-btn" title="Export project" ${ON('act','exportProject',{projectId:p.id})}>${SVG.upload}</button>
          <button class="row-btn" title="Rename" ${ON('openEditProj',p.id)}>${SVG.edit}</button>
          <button class="row-btn danger" title="Delete" ${ON('askDelProj',p.id)}>${SVG.trash}</button>
        </div>
      </div>
      <div class="env-area ${open?'open':''}">
        <div class="env-pills">
          ${p.envs.map(e=>{
            const c=COLOR(e.color);
            return `<span class="env-pill ${active&&active.envId===e.id?'sel':''}"
              style="background:${c}20;color:${c};border-color:${c}50"
              ${ON('openEnv',p.id,e.id)}>
              ${ESC(e.name)}
              <span class="pill-acts" data-stop>
                <button class="pill-btn" title="Edit" ${ON('openEditEnv',p.id,e.id)}>${SVG.editSm}</button>
                <button class="pill-btn" title="Delete" ${ON('askDelEnv',p.id,e.id)}>${SVG.xSm}</button>
              </span>
            </span>`;
          }).join('')}
          <button class="add-env-btn" ${ON('openNewEnv',p.id)}>${SVG.plusSm} Add env</button>
        </div>
      </div>
    </div>`;
  }
  h+=`<button class="dashed-btn" ${ON('openNewProj')}>${SVG.plus} Create project</button>`;
  el.innerHTML=h;
}

function findProj(id){return idx.projects.find(p=>p.id===id);}
function findEnv(pid,eid){return findProj(pid)?.envs.find(e=>e.id===eid);}
function toggleProj(id){openSet.has(id)?openSet.delete(id):openSet.add(id);renderProjs();}

/* ── Project modal ── */
function openNewProj(){projMode='create';projId=null;G('projModalTitle').textContent='New project';G('projName').value='';open_('projModal');setTimeout(()=>G('projName').focus(),60);}
function openEditProj(id){projMode='rename';projId=id;G('projModalTitle').textContent='Rename project';G('projName').value=findProj(id)?.name??'';open_('projModal');setTimeout(()=>G('projName').focus(),60);}
function saveProjModal(){
  const n=G('projName').value.trim();
  if(!n){toast('Project name cannot be empty','err');G('projName').focus();return;}
  if(projMode==='create') vsc.postMessage({type:'createProject',name:n});
  else vsc.postMessage({type:'renameProject',projectId:projId,name:n});
  close_('projModal');
}

/* ── Delete confirms ── */
function askDelProj(id){const n=findProj(id)?.name??'';G('confTitle').textContent='Delete project';G('confMsg').textContent='Delete "'+n+'"?';G('confSub').textContent='All environments, variables and runbooks will be permanently deleted.';confCb=()=>{openSet.delete(id);vsc.postMessage({type:'deleteProject',projectId:id});};open_('confModal');}
function askDelEnv(pid,eid){const n=findEnv(pid,eid)?.name??'';G('confTitle').textContent='Delete environment';G('confMsg').textContent='Delete "'+n+'"?';G('confSub').textContent='All variables and the runbook for this environment will be permanently deleted.';confCb=()=>{if(active&&active.envId===eid)goBack();vsc.postMessage({type:'deleteEnv',projectId:pid,envId:eid});};open_('confModal');}
function doConfirm(){if(confCb){confCb();confCb=null;}close_('confModal');}

/* ── Env modal ── */
function buildSwatches(){
  G('swatches').innerHTML=PALETTE.map(c=>`<div class="swatch ${c===selColor?'sel':''}" style="background:${c}" ${ON('pickColor',c)}></div>`).join('');
  G('colorPick').value=selColor;refreshPill();
}
function pickColor(c){selColor=c;buildSwatches();}
G('colorPick').addEventListener('input',e=>{selColor=e.target.value;buildSwatches();});
G('envName').addEventListener('input',refreshPill);
function refreshPill(){const n=G('envName').value.trim()||'env';const p=G('pillPrev');p.textContent=n;p.style.color=selColor;p.style.background=selColor+'20';p.style.borderColor=selColor+'50';}

function openNewEnv(pid){envMode='create';envPid=pid;envEid=null;selColor='#4ec994';G('envModalTitle').textContent='New environment';G('envName').value='';buildSwatches();open_('envModal');setTimeout(()=>G('envName').focus(),60);}
function openEditEnv(pid,eid){const env=findEnv(pid,eid);envMode='rename';envPid=pid;envEid=eid;selColor=COLOR(env?.color);G('envModalTitle').textContent='Edit environment';G('envName').value=env?.name??'';buildSwatches();open_('envModal');setTimeout(()=>G('envName').focus(),60);}
function saveEnvModal(){
  const n=G('envName').value.trim();
  if(!n){toast('Environment name cannot be empty','err');G('envName').focus();return;}
  if(envMode==='create'){openSet.add(envPid);vsc.postMessage({type:'createEnv',projectId:envPid,name:n,color:selColor});}
  else{if(active&&active.envId===envEid){active.name=n;active.color=selColor;updateEnvHdr();}vsc.postMessage({type:'renameEnv',projectId:envPid,envId:envEid,name:n,color:selColor});}
  close_('envModal');
}

/* ── Modal open/close ── */
function open_(id){G(id).classList.add('open');}
function close_(id){G(id).classList.remove('open');}
['envModal','projModal','stageModal','cmdModal','confModal'].forEach(id=>{
  G(id).addEventListener('click',e=>{if(e.target===G(id))close_(id);});
});

/* ── Env screen ── */
function openEnv(pid,eid){
  const env=findEnv(pid,eid);
  if(!env)return;
  flushNotes();notesFor=null;
  active={projectId:pid,envId:eid,name:env.name,color:COLOR(env.color)};
  vars=[];rb={stages:[]};revealed={};revAll=false;expandedStages=new Set();
  G('varSearch').value='';
  updateEnvHdr();switchTab('vars');
  setNotesMode('edit');
  G('addForm').classList.remove('open');
  renderVars();
  vsc.postMessage({type:'getVars',projectId:pid,envId:eid});
  showScreen('env');
}
function updateEnvHdr(){
  if(!active)return;
  const p=idx.projects.find(p=>p.id===active.projectId);
  G('envDot').style.background=active.color||'#4ec994';
  G('envTitle').textContent=active.name;
  G('bc').innerHTML=`<span class="bc-link" ${ON('goBack')}>${ESC(p?p.name:'Projects')}</span><span class="bc-sep">›</span><span class="bc-cur">${ESC(active.name)}</span>`;
}

function switchTab(t){
  activeTab=t;
  G('tVars').classList.toggle('active',   t==='vars');
  G('tImport').classList.toggle('active', t==='import');
  G('tRunbook').classList.toggle('active',t==='runbook');
  G('tNotes').classList.toggle('active',  t==='notes');
  G('cVars').style.display    =t==='vars'    ?'flex':'none';
  G('cImport').style.display  =t==='import'  ?'block':'none';
  G('cRunbook').style.display =t==='runbook' ?'flex':'none';
  G('cNotes').style.display   =t==='notes'   ?'flex':'none';
  G('copyBar').style.display  =t==='vars'    ?'flex':'none';
  const rb_=G('revBtn');
  rb_.style.display=t==='vars'?'flex':'none';
  if(t==='runbook') vsc.postMessage({type:'getRunbook',projectId:active.projectId,envId:active.envId});
  if(t!=='notes') flushNotes();
  else if(notesFor!==notesKeyOf(active)) {
    // read-only until the stored notes arrive, so typing can't overwrite them
    G('notesArea').value = '';
    G('notesArea').readOnly = true;
    updateNotesCount();
    setNotesStatus('Loading…', true);
    vsc.postMessage({type:'getNotes',projectId:active.projectId,envId:active.envId});
  }
}

/* ── Var list ── */
function renderVars(){
  const list=G('varList');
  const btn=G('revBtn');
  btn.classList.toggle('on',revAll);
  btn.innerHTML=(revAll?'${SVG.eyeOff}':'${SVG.eye}')+' '+(revAll?'Hide all':'Show all');

  const query = (G('varSearch').value || '').trim().toLowerCase();
  const filtered = query ? vars.filter(v => v.key.toLowerCase().includes(query) || v.value.toLowerCase().includes(query)) : vars;

  if(!vars.length){
    G('varSearchContainer').style.display = 'none';
    list.innerHTML=`<div class="empty" style="padding:20px 16px">
      <div class="empty-ico">${SVG.key}</div>
      <div class="empty-h">No variables yet</div>
      <div class="empty-p">Click + to add one, or use the Import tab.</div>
    </div>`;
    list.innerHTML+=`<div class="add-var-row" ${ON('showAddVar')}>${SVG.plus}&nbsp; Add variable</div>`;
    return;
  }

  G('varSearchContainer').style.display = 'flex';

  if(!filtered.length){
    list.innerHTML=`<div class="empty" style="padding:20px 16px">
      <div class="empty-h">No matches found</div>
      <div class="empty-p">No variables match your search query.</div>
    </div>`;
    return;
  }

  list.innerHTML=filtered.map(v=>{
    const show=revAll||!!revealed[v.id];
    return `<div class="var-row">
      <span class="var-key">${ESC(v.key)}</span>
      <span class="var-val ${show?'shown':''}">${show?ESC(v.value):'••••••••••'}</span>
      <button class="vbtn" title="${show?'Hide':'Reveal'}" ${ON('toggleRev',v.id)}>${show?'${SVG.eyeOff}':'${SVG.eye}'}</button>
      <button class="vbtn" title="Copy export" ${ON('copyVar',v.id)}>${SVG.copy}</button>
      <button class="vbtn danger" title="Delete" ${ON('delVar',v.id)}>${SVG.trash}</button>
    </div>`;
  }).join('');
  list.innerHTML+=`<div class="add-var-row" ${ON('showAddVar')}>${SVG.plus}&nbsp; Add variable</div>`;
}

function filterVars(){
  renderVars();
}

function toggleRevealAll(){revAll=!revAll;revealed={};renderVars();armAutoHide();}
function toggleRev(id){revealed[id]=!revealed[id];renderVars();armAutoHide();}
function clearPaste(){G('pasteBox').value='';}

// Revealed values hide themselves again after a while, and as soon as the panel is hidden
const AUTO_HIDE_MS = typeof __INITIAL__ !== 'undefined' ? __INITIAL__.autoHideMs : 30000;
let hideTimer = null;
function hideSecrets(){
  clearTimeout(hideTimer);
  if(!revAll && !Object.values(revealed).some(Boolean)) return;
  revAll=false;revealed={};
  if(active) renderVars();
}
function armAutoHide(){
  clearTimeout(hideTimer);
  if(AUTO_HIDE_MS>0 && (revAll || Object.values(revealed).some(Boolean))) hideTimer=setTimeout(hideSecrets,AUTO_HIDE_MS);
}
document.addEventListener('visibilitychange',()=>{ if(document.hidden) hideSecrets(); });
function formatEnvValue(val) {
  if (!val) return '';
  if (val.includes('\n') || val.includes(' ') || val.includes('"') || val.includes("'") || val.includes('$')) {
    const escaped = val.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return val;
}
function copyVar(id){const v=vars.find(v=>v.id===id);if(v)vsc.postMessage({type:'copy',text:'export '+v.key+'='+formatEnvValue(v.value),label:'✓ '+v.key+' copied',secret:true});}
function delVar(id){if(active)vsc.postMessage({type:'deleteVar',projectId:active.projectId,envId:active.envId,varId:id});}
function showAddVar(){G('addForm').classList.add('open');G('nKey').value='';G('nVal').value='';G('nValArea').value='';G('isMulti').checked=false;G('nVal').style.display='block';G('nValArea').style.display='none';setTimeout(()=>G('nKey').focus(),40);}
function hideAddVar(){G('addForm').classList.remove('open');}
function toggleMultiVal(){
  const isMulti = G('isMulti').checked;
  G('nVal').style.display = isMulti ? 'none' : 'block';
  G('nValArea').style.display = isMulti ? 'block' : 'none';
  if(isMulti){
    G('nValArea').value = G('nVal').value;
    G('nValArea').focus();
  } else {
    G('nVal').value = G('nValArea').value;
    G('nVal').focus();
  }
}
function saveNewVar(){
  const key=(G('nKey').value||'').trim();
  const val=G('isMulti').checked ? G('nValArea').value : G('nVal').value;
  if(!key){toast('Key cannot be empty','err');G('nKey').focus();return;}
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)){toast('Invalid key: use letters, digits, underscores','err');G('nKey').focus();return;}
  if(!active)return;
  vsc.postMessage({type:'saveVar',projectId:active.projectId,envId:active.envId,var:{id:Math.random().toString(36).slice(2,10),key,value:val}});
  hideAddVar();
}
function copyAll(fmt){
  if(!vars.length){toast('No variables to copy','err');return;}
  const text=fmt==='export'?vars.map(v=>'export '+v.key+'='+formatEnvValue(v.value)).join('\n'):vars.map(v=>v.key+'='+formatEnvValue(v.value)).join('\n');
  vsc.postMessage({type:'copy',text,label:'✓ '+vars.length+' vars copied',secret:true});
}
function doImport(){
  if(!active)return;
  const text=(G('pasteBox').value||'').trim();
  if(!text){toast('Nothing to import','err');return;}
  vsc.postMessage({type:'bulkImport',projectId:active.projectId,envId:active.envId,text});
  G('pasteBox').value='';switchTab('vars');
}

/* ── Import / Export actions ── */
function act(type,extra={}){
  vsc.postMessage({type,...(active?{projectId:active.projectId,envId:active.envId}:{}), ...extra});
}

/* ══════════════════════════════════════════
   RUNBOOK
══════════════════════════════════════════ */
function renderRb(){
  const list=G('rbList');
  const hasCmds = rb.stages.some(s => s.commands.length > 0);
  G('rbBar').style.display = hasCmds ? 'flex' : 'none';

  if(!rb.stages.length){
    list.innerHTML=`<div class="empty" style="padding:26px 16px">
      <div class="empty-ico">${SVG.play}</div>
      <div class="empty-h">No stages yet</div>
      <div class="empty-p">Add stages like "Mock Data" or "Start Services" and attach commands to each one.</div>
    </div>
    <button class="dashed-btn" ${ON('openNewStg')}>${SVG.plus} Add first stage</button>`;
    return;
  }
  let h='';
  rb.stages.forEach((stage,si)=>{
    const open = expandedStages.has(stage.id);
    h+=`<div class="stage-card ${open?'':'collapsed'}">
      <div class="stage-hd" draggable="true" data-si="${si}" ${ON('toggleStage',stage.id)}>
        <span class="drag-handle" title="Drag to reorder" data-stop>${SVG.drag}</span>
        <span class="stage-chevron ${open?'open':''}">${SVG.chevron}</span>
        <span class="stage-num">${si+1}</span>
        <span class="stage-name">${ESC(stage.name)}</span>
        <div class="stage-acts" data-stop>
          <button class="s-btn" title="Rename" ${ON('openEditStg',si)}>${SVG.edit}</button>
          <button class="s-btn danger" title="Delete" ${ON('askDelStg',si)}>${SVG.trash}</button>
        </div>
      </div>
      <div style="${open?'':'display:none'}">
        ${stage.commands.map((cmd,ci)=>`<div class="cmd-row">
          <div class="cmd-info">
            <div class="cmd-label">${ESC(cmd.label)}</div>
            <div class="cmd-code">${ESC(cmd.cmd)}</div>
          </div>
          <div class="cmd-acts">
            <button class="c-btn copy" id="cb-${si}-${ci}" title="Copy" ${ON('copyCmd',si,ci)}>${SVG.copy}</button>
            <button class="c-btn run"  title="Run in terminal" ${ON('runCmd',si,ci)}>${SVG.terminal}</button>
            <button class="c-btn"      title="Edit" ${ON('openEditCmd',si,ci)}>${SVG.edit}</button>
            <button class="c-btn danger" title="Delete" ${ON('askDelCmd',si,ci)}>${SVG.trash}</button>
          </div>
        </div>`).join('')}
        <div class="add-cmd-row" ${ON('openNewCmd',si)}>${SVG.plusSm}&nbsp; Add command</div>
      </div>
    </div>`;
  });
  h+=`<button class="dashed-btn" style="margin-top:2px" ${ON('openNewStg')}>${SVG.plus} Add stage</button>`;
  list.innerHTML=h;
}

function toggleStage(id){
  expandedStages.has(id)?expandedStages.delete(id):expandedStages.add(id);
  renderRb();
}

function openNewStg(){
  stgMode='create';stgIdx=-1;
  G('stageTitle').textContent='New stage';
  G('stageName').value='';
  G('stageTypeField').style.display='flex';
  const radioEmpty = document.querySelector('input[name="stageType"][value="empty"]');
  if (radioEmpty) radioEmpty.checked = true;
  open_('stageModal');
  setTimeout(()=>G('stageName').focus(),60);
}
function openEditStg(si){
  stgMode='rename';stgIdx=si;
  G('stageTitle').textContent='Rename stage';
  G('stageName').value=rb.stages[si].name;
  G('stageTypeField').style.display='none';
  open_('stageModal');
  setTimeout(()=>G('stageName').focus(),60);
}
function saveStageModal(){
  const n=G('stageName').value.trim();
  if(!n){toast('Stage name cannot be empty','err');G('stageName').focus();return;}
  if(stgMode==='create'){
    const isEnv = document.querySelector('input[name="stageType"]:checked')?.value === 'env';
    const commands = [];
    if (isEnv) {
      commands.push({
        id: Math.random().toString(36).slice(2,10),
        label: 'Export environment variables',
        cmd: 'export-env'
      });
    }
    rb.stages.push({id:Math.random().toString(36).slice(2,10),name:n,commands});
  } else {
    rb.stages[stgIdx].name=n;
  }
  saveRb();close_('stageModal');
}
function askDelStg(si){G('confTitle').textContent='Delete stage';G('confMsg').textContent='Delete "'+rb.stages[si].name+'"?';G('confSub').textContent='All commands in this stage will be deleted.';confCb=()=>{rb.stages.splice(si,1);saveRb();};open_('confModal');}

function openNewCmd(si){cmdStg=si;cmdIdx=-1;G('cmdTitle').textContent='New command';G('cmdLabel').value='';G('cmdText').value='';open_('cmdModal');setTimeout(()=>G('cmdLabel').focus(),60);}
function openEditCmd(si,ci){cmdStg=si;cmdIdx=ci;const c=rb.stages[si].commands[ci];G('cmdTitle').textContent='Edit command';G('cmdLabel').value=c.label;G('cmdText').value=c.cmd;open_('cmdModal');setTimeout(()=>G('cmdLabel').focus(),60);}
function saveCmdModal(){
  const label=G('cmdLabel').value.trim(),cmd=G('cmdText').value.trim();
  if(!label){toast('Label cannot be empty','err');G('cmdLabel').focus();return;}
  if(!cmd){toast('Command cannot be empty','err');G('cmdText').focus();return;}
  if(cmdIdx===-1) rb.stages[cmdStg].commands.push({id:Math.random().toString(36).slice(2,10),label,cmd});
  else rb.stages[cmdStg].commands[cmdIdx]={...rb.stages[cmdStg].commands[cmdIdx],label,cmd};
  saveRb();close_('cmdModal');
}
function askDelCmd(si,ci){const c=rb.stages[si].commands[ci];G('confTitle').textContent='Delete command';G('confMsg').textContent='Delete "'+c.label+'"?';G('confSub').textContent='This command will be permanently removed.';confCb=()=>{rb.stages[si].commands.splice(ci,1);saveRb();};open_('confModal');}

function copyCmd(si,ci){
  const c=rb.stages[si].commands[ci];
  vsc.postMessage({type:'copy',text:c.cmd,label:'✓ Command copied'});
  const b=G('cb-'+si+'-'+ci);if(b){b.classList.add('flashing');setTimeout(()=>b.classList.remove('flashing'),350);}
}
function runCmd(si,ci){vsc.postMessage({type:'runInTerminal',projectId:active?.projectId,envId:active?.envId,cmd:rb.stages[si].commands[ci].cmd});}
function runAll(){if(active)vsc.postMessage({type:'runAll',projectId:active.projectId,envId:active.envId});}
function saveRb(){
  vsc.postMessage({type:'saveRunbook',projectId:active.projectId,envId:active.envId,data:rb});
  renderRb();
}

let draggedStageIndex = null;
function dragStartStage(e, hd, index) {
  draggedStageIndex = index;
  const card = hd.closest('.stage-card');
  if (card) {
    setTimeout(() => {
      card.classList.add('dragging');
    }, 0);
  }
}
function dragOverStage(e, hd, index) {
  e.preventDefault();
  if (draggedStageIndex === null || draggedStageIndex === index) return;
  const card = hd.closest('.stage-card');
  if (!card) return;
  const rect = hd.getBoundingClientRect();
  const relativeY = e.clientY - rect.top;
  const isTop = relativeY < rect.height / 2;
  card.classList.remove('drag-over-top', 'drag-over-bottom');
  if (isTop) {
    card.classList.add('drag-over-top');
  } else {
    card.classList.add('drag-over-bottom');
  }
}
function dragLeaveStage(e, hd) {
  const card = hd.closest('.stage-card');
  if (card) {
    card.classList.remove('drag-over-top', 'drag-over-bottom');
  }
}
function dragEndStage(e, hd) {
  const card = hd.closest('.stage-card');
  if (card) {
    card.classList.remove('dragging');
  }
  document.querySelectorAll('.stage-card').forEach(el => {
    el.classList.remove('drag-over-top', 'drag-over-bottom');
  });
  draggedStageIndex = null;
}
function dropStage(e, hd, index) {
  e.preventDefault();
  const card = hd.closest('.stage-card');
  if (card) {
    card.classList.remove('drag-over-top', 'drag-over-bottom');
  }
  if (draggedStageIndex === null || draggedStageIndex === index) return;
  const rect = hd.getBoundingClientRect();
  const relativeY = e.clientY - rect.top;
  const isTop = relativeY < rect.height / 2;
  let targetIndex = isTop ? index : index + 1;

  const stageToMove = rb.stages[draggedStageIndex];
  rb.stages.splice(draggedStageIndex, 1);
  if (draggedStageIndex < targetIndex) {
    targetIndex--;
  }
  rb.stages.splice(targetIndex, 0, stageToMove);
  saveRb();
}

/* ── Toast ── */
let _toastTimer=null;
function toast(msg,type='ok'){
  const el=G('toast');
  el.innerHTML=(type==='ok'?'${SVG.check}':'${SVG.x_}')+' '+ESC(msg);
  el.className='toast '+type+' show';
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(()=>el.classList.remove('show'),2800);
}

/* ── Keyboard ── */
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    ['envModal','projModal','stageModal','cmdModal','confModal'].forEach(close_);
  }
  if(e.key==='Enter'){
    if(e.target===G('nVal'))      {e.preventDefault();saveNewVar();}
    if(e.target===G('envName'))   {e.preventDefault();saveEnvModal();}
    if(e.target===G('projName'))  {e.preventDefault();saveProjModal();}
    if(e.target===G('stageName')) {e.preventDefault();saveStageModal();}
    if(e.target===G('cmdLabel'))  {e.preventDefault();G('cmdText').focus();}
  }
});

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

/* ── Event wiring ── */
// The webview's CSP blocks inline handlers, so markup carries data-act / data-args instead
const ACTIONS = {
  act, goBack, switchTab, toggleRevealAll, toggleRev, copyVar, delVar, showAddVar, hideAddVar, saveNewVar,
  copyAll, doImport, clearPaste,
  toggleProj, openNewProj, openEditProj, askDelProj, saveProjModal,
  openEnv, openNewEnv, openEditEnv, askDelEnv, saveEnvModal, pickColor,
  toggleStage, openNewStg, openEditStg, askDelStg, saveStageModal,
  openNewCmd, openEditCmd, askDelCmd, saveCmdModal, copyCmd, runCmd, runAll,
  setNotesMode, notesWrap, notesLinePrefix, notesCode, notesLink,
  close_, doConfirm
};
const elOf = e => e.target.nodeType === 1 ? e.target : e.target.parentElement;

document.addEventListener('click', e => {
  // data-stop marks areas whose clicks must not reach an enclosing data-act
  const el = elOf(e)?.closest('[data-act],[data-stop]');
  if (!el || !el.dataset.act) return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) fn(...JSON.parse(el.dataset.args || '[]'));
});

G('varSearch').addEventListener('input', filterVars);
G('isMulti').addEventListener('change', toggleMultiVal);
G('notesArea').addEventListener('input', onNotesInput);

// Stage drag-and-drop, delegated from the list to each .stage-hd
[['dragstart', dragStartStage], ['dragover', dragOverStage], ['dragleave', dragLeaveStage],
 ['drop', dropStage], ['dragend', dragEndStage]].forEach(([type, handler]) => {
  G('rbList').addEventListener(type, e => {
    const hd = elOf(e)?.closest('.stage-hd');
    if (hd) handler(e, hd, Number(hd.dataset.si));
  });
});
