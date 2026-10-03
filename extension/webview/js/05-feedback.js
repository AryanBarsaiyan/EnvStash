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
    MODALS.forEach(close_);
  }
  if(e.key==='Enter'){
    if(e.target===G('nVal'))      {e.preventDefault();saveNewVar();}
    if(e.target===G('envName'))   {e.preventDefault();saveEnvModal();}
    if(e.target===G('projName'))  {e.preventDefault();saveProjModal();}
    if(e.target===G('stageName')) {e.preventDefault();saveStageModal();}
    if(e.target===G('cmdLabel'))  {e.preventDefault();G('cmdText').focus();}
  }
});
