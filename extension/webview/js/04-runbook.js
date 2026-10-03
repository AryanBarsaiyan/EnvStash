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
        ${stage.commands.map((cmd,ci)=>`<div class="cmd-row" data-si="${si}" data-ci="${ci}">
          ${stage.commands.length>1?`<span class="drag-handle cmd-handle" draggable="true" title="Drag to reorder">${SVG.drag}</span>`:''}
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
  // saveRb re-renders, which detaches the dragged element, so its dragend never reaches the list
  draggedStageIndex = null;
  saveRb();
}

/* ── Command reordering (within one stage) ── */
// Only the handle is draggable, so the command text stays selectable
let draggedCmd = null;  // {si, ci}
const CMD_DROP_MARKS = ['drag-over-top', 'drag-over-bottom'];
function dropsAbove(e, row) {
  const rect = row.getBoundingClientRect();
  return e.clientY - rect.top < rect.height / 2;
}
function dragStartCmd(e, row, si, ci) {
  draggedCmd = { si, ci };
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
    e.dataTransfer.setDragImage(row, 12, 12);
  }
  setTimeout(() => row.classList.add('dragging'), 0);
}
function dragOverCmd(e, row, si, ci) {
  // not cancelling the event is what tells the browser "you can't drop here"
  if (!draggedCmd || draggedCmd.si !== si) return;
  e.preventDefault();
  row.classList.remove(...CMD_DROP_MARKS);
  if (draggedCmd.ci !== ci) row.classList.add(dropsAbove(e, row) ? 'drag-over-top' : 'drag-over-bottom');
}
function dragLeaveCmd(e, row) {
  row.classList.remove(...CMD_DROP_MARKS);
}
function dragEndCmd() {
  document.querySelectorAll('.cmd-row').forEach(el => el.classList.remove('dragging', ...CMD_DROP_MARKS));
  draggedCmd = null;
}
function dropCmd(e, row, si, ci) {
  if (!draggedCmd || draggedCmd.si !== si) return;
  e.preventDefault();
  const from = draggedCmd.ci;
  dragEndCmd();
  if (from === ci) return;
  let target = dropsAbove(e, row) ? ci : ci + 1;
  const commands = rb.stages[si].commands;
  const [moved] = commands.splice(from, 1);
  if (from < target) target--;
  commands.splice(target, 0, moved);
  saveRb();
}
