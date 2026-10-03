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
                <button class="pill-btn" title="Duplicate" ${ON('openDupEnv',p.id,e.id)}>${SVG.copy}</button>
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
// Duplicating reuses the env dialog: envEid is the environment being copied
function openDupEnv(pid,eid){
  const env=findEnv(pid,eid);
  if(!env)return;
  const taken=new Set(findProj(pid).envs.map(e=>e.name.toLowerCase()));
  let name=env.name+' copy';
  for(let i=2;taken.has(name.toLowerCase());i++) name=env.name+' copy '+i;
  envMode='duplicate';envPid=pid;envEid=eid;selColor=COLOR(env.color);
  G('envModalTitle').textContent='Duplicate environment';G('envName').value=name;
  buildSwatches();open_('envModal');
  setTimeout(()=>{G('envName').focus();G('envName').select();},60);
}
function saveEnvModal(){
  const n=G('envName').value.trim();
  if(!n){toast('Environment name cannot be empty','err');G('envName').focus();return;}
  if(envMode==='create'){openSet.add(envPid);vsc.postMessage({type:'createEnv',projectId:envPid,name:n,color:selColor});}
  else if(envMode==='duplicate'){vsc.postMessage({type:'duplicateEnv',projectId:envPid,envId:envEid,name:n,color:selColor});}
  else{if(active&&active.envId===envEid){active.name=n;active.color=selColor;updateEnvHdr();}vsc.postMessage({type:'renameEnv',projectId:envPid,envId:envEid,name:n,color:selColor});}
  close_('envModal');
}

/* ── Modal open/close ── */
function open_(id){G(id).classList.add('open');}
function close_(id){G(id).classList.remove('open');}
const MODALS=['envModal','projModal','stageModal','cmdModal','confModal','cmpModal'];
MODALS.forEach(id=>{
  G(id).addEventListener('click',e=>{if(e.target===G(id))close_(id);});
});
