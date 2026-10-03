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
