'use strict';
const vsc = acquireVsCodeApi();
const G   = id => document.getElementById(id);
const ESC = s => (s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const EQ  = s => (s??'').replace(/\\\\/g,'\\\\\\\\').replace(/'/g,"\\\\'").replace(/"/g,'&quot;');

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
if (typeof __INITIAL_INDEX__ !== 'undefined') {
  idx = __INITIAL_INDEX__;
  renderProjs();
} else {
  vsc.postMessage({type:'getIndex'});
}

window.addEventListener('message', e => {
  const m=e.data;
  if (m.type==='index')   { idx=m.data; renderProjs(); }
  if (m.type==='vars' && active && m.projectId===active.projectId && m.envId===active.envId) {
    vars=m.data; renderVars();
  }
  if (m.type==='runbook' && active && m.projectId===active.projectId && m.envId===active.envId) {
    rb=m.data||{stages:[]}; renderRb();
  }
  if (m.type==='notes' && active && m.projectId===active.projectId && m.envId===active.envId) {
    G('notesArea').value = m.data || '';
    G('notesStatus').textContent = 'All changes saved automatically';
    if (notesMode === 'preview') {
      G('notesPreview').innerHTML = renderMarkdown(m.data || '');
    }
  }
});

/* ── Screen switch ── */
function showScreen(s){
  G('sProj').classList.toggle('active',s==='proj');
  G('sEnv').classList.toggle('active', s==='env');
}
function goBack(){
  clearTimeout(notesTimeout);
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
    <button class="dashed-btn" onclick="openNewProj()">${SVG.plus} Create project</button>`;
    return;
  }
  let h='';
  for(const p of idx.projects){
    const open=openSet.has(p.id);
    h+=`<div class="proj-card">
      <div class="proj-row" onclick="toggleProj('${p.id}')">
        <span class="proj-chevron ${open?'open':''}">${SVG.chevron}</span>
        <span class="proj-icon">${SVG.folder}</span>
        <span class="proj-name">${ESC(p.name)}</span>
        <div class="proj-acts" onclick="event.stopPropagation()">
          <button class="row-btn" title="Export project" onclick="act('exportProject',{projectId:'${p.id}'})">${SVG.upload}</button>
          <button class="row-btn" title="Rename" onclick="openEditProj('${p.id}','${EQ(p.name)}')">${SVG.edit}</button>
          <button class="row-btn danger" title="Delete" onclick="askDelProj('${p.id}','${EQ(p.name)}')">${SVG.trash}</button>
        </div>
      </div>
      <div class="env-area ${open?'open':''}">
        <div class="env-pills">
          ${p.envs.map(e=>{
            const c=e.color||'#4ec994';
            return `<span class="env-pill ${active&&active.envId===e.id?'sel':''}"
              style="background:${c}20;color:${c};border-color:${c}50"
              onclick="openEnv('${p.id}','${e.id}','${EQ(e.name)}','${c}')">
              ${ESC(e.name)}
              <span class="pill-acts" onclick="event.stopPropagation()">
                <button class="pill-btn" title="Edit" onclick="openEditEnv('${p.id}','${e.id}','${EQ(e.name)}','${c}')">${SVG.editSm}</button>
                <button class="pill-btn" title="Delete" onclick="askDelEnv('${p.id}','${e.id}','${EQ(e.name)}')">${SVG.xSm}</button>
              </span>
            </span>`;
          }).join('')}
          <button class="add-env-btn" onclick="openNewEnv('${p.id}')">${SVG.plusSm} Add env</button>
        </div>
      </div>
    </div>`;
  }
  h+=`<button class="dashed-btn" onclick="openNewProj()">${SVG.plus} Create project</button>`;
  el.innerHTML=h;
}

function toggleProj(id){openSet.has(id)?openSet.delete(id):openSet.add(id);renderProjs();}

/* ── Project modal ── */
function openNewProj(){projMode='create';projId=null;G('projModalTitle').textContent='New project';G('projName').value='';open_('projModal');setTimeout(()=>G('projName').focus(),60);}
function openEditProj(id,n){projMode='rename';projId=id;G('projModalTitle').textContent='Rename project';G('projName').value=n;open_('projModal');setTimeout(()=>G('projName').focus(),60);}
function saveProjModal(){
  const n=G('projName').value.trim();
  if(!n){toast('Project name cannot be empty','err');G('projName').focus();return;}
  if(projMode==='create') vsc.postMessage({type:'createProject',name:n});
  else vsc.postMessage({type:'renameProject',projectId:projId,name:n});
  close_('projModal');
}

/* ── Delete confirms ── */
function askDelProj(id,n){G('confTitle').textContent='Delete project';G('confMsg').textContent='Delete "'+n+'"?';G('confSub').textContent='All environments, variables and runbooks will be permanently deleted.';confCb=()=>{openSet.delete(id);vsc.postMessage({type:'deleteProject',projectId:id});};open_('confModal');}
function askDelEnv(pid,eid,n){G('confTitle').textContent='Delete environment';G('confMsg').textContent='Delete "'+n+'"?';G('confSub').textContent='All variables and the runbook for this environment will be permanently deleted.';confCb=()=>{if(active&&active.envId===eid)goBack();vsc.postMessage({type:'deleteEnv',projectId:pid,envId:eid});};open_('confModal');}
function doConfirm(){if(confCb){confCb();confCb=null;}close_('confModal');}

/* ── Env modal ── */
function buildSwatches(){
  G('swatches').innerHTML=PALETTE.map(c=>`<div class="swatch ${c===selColor?'sel':''}" style="background:${c}" onclick="pickColor('${c}')"></div>`).join('');
  G('colorPick').value=selColor;refreshPill();
}
function pickColor(c){selColor=c;buildSwatches();}
G('colorPick').addEventListener('input',e=>{selColor=e.target.value;buildSwatches();});
G('envName').addEventListener('input',refreshPill);
function refreshPill(){const n=G('envName').value.trim()||'env';const p=G('pillPrev');p.textContent=n;p.style.color=selColor;p.style.background=selColor+'20';p.style.borderColor=selColor+'50';}

function openNewEnv(pid){envMode='create';envPid=pid;envEid=null;selColor='#4ec994';G('envModalTitle').textContent='New environment';G('envName').value='';buildSwatches();open_('envModal');setTimeout(()=>G('envName').focus(),60);}
function openEditEnv(pid,eid,n,c){envMode='rename';envPid=pid;envEid=eid;selColor=c||'#4ec994';G('envModalTitle').textContent='Edit environment';G('envName').value=n;buildSwatches();open_('envModal');setTimeout(()=>G('envName').focus(),60);}
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
function openEnv(pid,eid,name,color){
  clearTimeout(notesTimeout);
  active={projectId:pid,envId:eid,name,color};
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
  G('bc').innerHTML=`<span class="bc-link" onclick="goBack()">${ESC(p?p.name:'Projects')}</span><span class="bc-sep">›</span><span class="bc-cur">${ESC(active.name)}</span>`;
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
  if(t==='notes') {
    G('notesArea').value = '';
    G('notesStatus').textContent = 'Loading notes...';
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
    list.innerHTML+=`<div class="add-var-row" onclick="showAddVar()">${SVG.plus}&nbsp; Add variable</div>`;
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
      <button class="vbtn" title="${show?'Hide':'Reveal'}" onclick="toggleRev('${v.id}')">${show?'${SVG.eyeOff}':'${SVG.eye}'}</button>
      <button class="vbtn" title="Copy export" onclick="copyVar('${v.id}')">${SVG.copy}</button>
      <button class="vbtn danger" title="Delete" onclick="delVar('${v.id}')">${SVG.trash}</button>
    </div>`;
  }).join('');
  list.innerHTML+=`<div class="add-var-row" onclick="showAddVar()">${SVG.plus}&nbsp; Add variable</div>`;
}

function filterVars(){
  renderVars();
}

function toggleRevealAll(){revAll=!revAll;revealed={};renderVars();}
function toggleRev(id){revealed[id]=!revealed[id];renderVars();}
function formatEnvValue(val) {
  if (!val) return '';
  if (val.includes('\n') || val.includes(' ') || val.includes('"') || val.includes("'") || val.includes('$')) {
    const escaped = val.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return val;
}
function copyVar(id){const v=vars.find(v=>v.id===id);if(v)vsc.postMessage({type:'copy',text:'export '+v.key+'='+formatEnvValue(v.value),label:'✓ '+v.key+' copied'});}
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
  vsc.postMessage({type:'copy',text,label:'✓ '+vars.length+' vars copied'});
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
    <button class="dashed-btn" onclick="openNewStg()">${SVG.plus} Add first stage</button>`;
    return;
  }
  let h='';
  rb.stages.forEach((stage,si)=>{
    const open = expandedStages.has(stage.id);
    h+=`<div class="stage-card ${open?'':'collapsed'}">
      <div class="stage-hd" draggable="true" ondragstart="dragStartStage(event, ${si})" ondragover="dragOverStage(event, ${si})" ondragleave="dragLeaveStage(event)" ondrop="dropStage(event, ${si})" ondragend="dragEndStage(event)" onclick="toggleStage('${stage.id}')">
        <span class="drag-handle" title="Drag to reorder" onclick="event.stopPropagation()">${SVG.drag}</span>
        <span class="stage-chevron ${open?'open':''}">${SVG.chevron}</span>
        <span class="stage-num">${si+1}</span>
        <span class="stage-name">${ESC(stage.name)}</span>
        <div class="stage-acts" onclick="event.stopPropagation()">
          <button class="s-btn" title="Rename" onclick="openEditStg(${si})">${SVG.edit}</button>
          <button class="s-btn danger" title="Delete" onclick="askDelStg(${si})">${SVG.trash}</button>
        </div>
      </div>
      <div style="${open?'':'display:none'}">
        ${stage.commands.map((cmd,ci)=>`<div class="cmd-row">
          <div class="cmd-info">
            <div class="cmd-label">${ESC(cmd.label)}</div>
            <div class="cmd-code">${ESC(cmd.cmd)}</div>
          </div>
          <div class="cmd-acts">
            <button class="c-btn copy" id="cb-${si}-${ci}" title="Copy" onclick="copyCmd(${si},${ci})">${SVG.copy}</button>
            <button class="c-btn run"  title="Run in terminal" onclick="runCmd(${si},${ci})">${SVG.terminal}</button>
            <button class="c-btn"      title="Edit" onclick="openEditCmd(${si},${ci})">${SVG.edit}</button>
            <button class="c-btn danger" title="Delete" onclick="askDelCmd(${si},${ci})">${SVG.trash}</button>
          </div>
        </div>`).join('')}
        <div class="add-cmd-row" onclick="openNewCmd(${si})">${SVG.plusSm}&nbsp; Add command</div>
      </div>
    </div>`;
  });
  h+=`<button class="dashed-btn" style="margin-top:2px" onclick="openNewStg()">${SVG.plus} Add stage</button>`;
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
function dragStartStage(e, index) {
  if (e.target.closest('.stage-acts') || e.target.closest('.s-btn')) {
    e.preventDefault();
    return;
  }
  draggedStageIndex = index;
  const card = e.currentTarget.closest('.stage-card');
  if (card) {
    setTimeout(() => {
      card.classList.add('dragging');
    }, 0);
  }
}
function dragOverStage(e, index) {
  e.preventDefault();
  if (draggedStageIndex === null || draggedStageIndex === index) return;
  const card = e.currentTarget.closest('.stage-card');
  if (!card) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const relativeY = e.clientY - rect.top;
  const isTop = relativeY < rect.height / 2;
  card.classList.remove('drag-over-top', 'drag-over-bottom');
  if (isTop) {
    card.classList.add('drag-over-top');
  } else {
    card.classList.add('drag-over-bottom');
  }
}
function dragLeaveStage(e) {
  const card = e.currentTarget.closest('.stage-card');
  if (card) {
    card.classList.remove('drag-over-top', 'drag-over-bottom');
  }
}
function dragEndStage(e) {
  const card = e.currentTarget.closest('.stage-card');
  if (card) {
    card.classList.remove('dragging');
  }
  document.querySelectorAll('.stage-card').forEach(el => {
    el.classList.remove('drag-over-top', 'drag-over-bottom');
  });
  draggedStageIndex = null;
}
function dropStage(e, index) {
  e.preventDefault();
  const card = e.currentTarget.closest('.stage-card');
  if (card) {
    card.classList.remove('drag-over-top', 'drag-over-bottom');
  }
  if (draggedStageIndex === null || draggedStageIndex === index) return;
  const rect = e.currentTarget.getBoundingClientRect();
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

function insertFormat(prefix, suffix = '') {
  const el = G('notesArea');
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const text = el.value;
  const sel = text.substring(start, end);
  const rep = prefix + sel + suffix;
  el.value = text.substring(0, start) + rep + text.substring(end);
  el.focus();
  el.setSelectionRange(start + prefix.length, start + prefix.length + sel.length);
  onNotesInput();
}

function renderMarkdown(md) {
  if (!md || !md.trim()) return '<div class="empty-notes">No notes yet. Click Edit to add some!</div>';
  let html = ESC(md);
  
  // Headers: ###, ##, #
  html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');
  
  // Bold: **text**
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Italic: *text*
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  
  // Code inline: `code`
  html = html.replace(/`(.*?)`/g, '<code>$1</code>');
  
  // Links: [text](url)
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>');
  
  // Bullet lists: - item or * item
  html = html.replace(/^\s*[-*]\s+(.*?)$/gm, '<li>$1</li>');
  
  // Wrap consecutive list items in <ul>
  html = html.replace(/(<li>.*?<\/li>)+/gs, '<ul>$&</ul>');
  
  // Code blocks: ```js ... ```
  html = html.replace(/```(.*?)\r?\n(.*?)\r?\n```/gs, '<pre><code>$2</code></pre>');
  
  // Newlines
  html = html.replace(/\n/g, '<br>');
  
  return html;
}

function onNotesInput() {
  G('notesStatus').textContent = 'Saving...';
  clearTimeout(notesTimeout);
  notesTimeout = setTimeout(() => {
    vsc.postMessage({
      type: 'saveNotes',
      projectId: active.projectId,
      envId: active.envId,
      notes: G('notesArea').value
    });
    G('notesStatus').textContent = 'All changes saved automatically';
  }, 800);
}
