/* ── Compare environments ── */
// The open environment ("this") against another one, key by key
let cmpTargets = [];        // [{projectId, envId, label}] everything except the open environment
let cmpOther = null;        // the target being compared against
let cmpRows = null;         // diff rows from the extension; null while loading
let cmpShowValues = false;
let cmpShowSame = false;

function compareTargets(){
  // another project's environment carries its project name: two projects can both have a "dev"
  const all = idx.projects.flatMap(p => p.envs.map(e => ({projectId:p.id, envId:e.id, label:p.id===active.projectId ? e.name : p.name+' / '+e.name})));
  const others = all.filter(t => !(t.projectId===active.projectId && t.envId===active.envId));
  // environments of the same project first: that is the usual comparison
  return [...others.filter(t => t.projectId===active.projectId), ...others.filter(t => t.projectId!==active.projectId)];
}
const sameTarget = (a,b) => !!a && !!b && a.projectId===b.projectId && a.envId===b.envId;

function openCompare(){
  if(!active) return;
  cmpTargets = compareTargets();
  if(!cmpTargets.length){toast('Add another environment to compare with','err');return;}
  cmpOther = cmpTargets.find(t => sameTarget(t,cmpOther)) || cmpTargets[0];
  cmpShowValues = false; cmpShowSame = false;
  G('cmpThis').textContent = active.name;
  G('cmpOther').innerHTML = cmpTargets.map((t,i) =>
    `<option value="${i}" ${sameTarget(t,cmpOther)?'selected':''}>${ESC(t.label)}</option>`).join('');
  open_('cmpModal');
  loadCompare();
}
function loadCompare(){
  cmpRows = null;
  renderCompare();
  vsc.postMessage({type:'compareEnvs',projectId:active.projectId,envId:active.envId,otherProjectId:cmpOther.projectId,otherEnvId:cmpOther.envId});
}
function onCompareTargetChange(){
  cmpOther = cmpTargets[Number(G('cmpOther').value)] || cmpOther;
  loadCompare();
}
function onCompareResult(m){
  // ignore answers for a pair that is no longer the one on screen
  if(!active || !cmpOther || m.projectId!==active.projectId || m.envId!==active.envId) return;
  if(m.otherProjectId!==cmpOther.projectId || m.otherEnvId!==cmpOther.envId) return;
  cmpRows = m.data || [];
  renderCompare();
}
function toggleCompareValues(){cmpShowValues=!cmpShowValues;renderCompare();armAutoHide();}
function toggleCompareSame(){cmpShowSame=!cmpShowSame;renderCompare();}

// Copies a variable that only the other environment has into the open one
function cmpCopyHere(key){
  const row = (cmpRows||[]).find(r => r.key===key && r.status==='onlyRight');
  if(!row || !active) return;
  vsc.postMessage({type:'saveVar',projectId:active.projectId,envId:active.envId,var:{key:row.key,value:row.right}});
  loadCompare();
}

function renderCompare(){
  if(!G('cmpModal').classList.contains('open') || !active || !cmpOther) return;
  const list = G('cmpList'), summary = G('cmpSummary'), showBtn = G('cmpShowBtn');
  showBtn.textContent = cmpShowValues ? 'Hide values' : 'Show values';
  if(cmpRows === null){summary.textContent='Comparing…';list.innerHTML='';return;}

  const count = s => cmpRows.filter(r => r.status===s).length;
  const n = {different:count('different'), onlyLeft:count('onlyLeft'), onlyRight:count('onlyRight'), same:count('same')};
  const differing = n.different + n.onlyLeft + n.onlyRight;
  if(!cmpRows.length) summary.textContent = 'Both environments have no variables.';
  else if(!differing) summary.textContent = `Identical: all ${n.same} variable${n.same===1?'':'s'} match.`;
  else summary.textContent = [
    n.different && `${n.different} different`,
    n.onlyLeft && `${n.onlyLeft} only in ${active.name}`,
    n.onlyRight && `${n.onlyRight} only in ${cmpOther.label}`,
    n.same && `${n.same} identical`,
  ].filter(Boolean).join(' · ');

  const BADGE = {different:'Different', onlyLeft:'Only in '+active.name, onlyRight:'Only in '+cmpOther.label, same:'Same'};
  const value = (env,val) => `<div class="cmp-val"><span class="cmp-env">${ESC(env)}</span><span class="cmp-v ${cmpShowValues?'shown':''}">${cmpShowValues?ESC(val):'••••••••••'}</span></div>`;
  const shown = cmpRows.filter(r => r.status!=='same' || cmpShowSame);
  let h = shown.map(r => `<div class="cmp-row cmp-${r.status}">
      <div class="cmp-key"><span class="var-key">${ESC(r.key)}</span><span class="cmp-badge">${ESC(BADGE[r.status])}</span></div>
      ${r.status==='same' ? '' : `<div class="cmp-vals">
        ${r.left!==undefined ? value(active.name,r.left) : ''}
        ${r.right!==undefined ? value(cmpOther.label,r.right) : ''}
      </div>`}
      ${r.status==='onlyRight' ? `<button class="cmp-add" ${ON('cmpCopyHere',r.key)}>${SVG.plusSm} Add to ${ESC(active.name)}</button>` : ''}
    </div>`).join('');
  if(n.same && differing) h += `<button class="cmp-more" ${ON('toggleCompareSame')}>${cmpShowSame?'Hide':'Show'} ${n.same} identical</button>`;
  list.innerHTML = h;
}
