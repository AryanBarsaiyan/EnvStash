/* ── Event wiring ── */
// The webview's CSP blocks inline handlers, so markup carries data-act / data-args instead
const ACTIONS = {
  act, goBack, switchTab, toggleRevealAll, toggleRev, copyVar, editVar, delVar, showAddVar, hideAddVar, saveNewVar,
  copyAll, doImport, clearPaste,
  toggleProj, openNewProj, openEditProj, askDelProj, saveProjModal,
  openEnv, openNewEnv, openEditEnv, openDupEnv, askDelEnv, saveEnvModal, pickColor,
  openCompare, toggleCompareValues, toggleCompareSame, cmpCopyHere,
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
G('cmpOther').addEventListener('change', onCompareTargetChange);

// Stage drag-and-drop, delegated from the list to each .stage-hd
[['dragstart', dragStartStage], ['dragover', dragOverStage], ['dragleave', dragLeaveStage],
 ['drop', dropStage], ['dragend', dragEndStage]].forEach(([type, handler]) => {
  G('rbList').addEventListener(type, e => {
    const hd = elOf(e)?.closest('.stage-hd');
    if (hd) handler(e, hd, Number(hd.dataset.si));
  });
});

// Command drag-and-drop: starts on a row's handle, targets are the .cmd-row elements
[['dragstart', dragStartCmd], ['dragover', dragOverCmd], ['dragleave', dragLeaveCmd],
 ['drop', dropCmd], ['dragend', dragEndCmd]].forEach(([type, handler]) => {
  G('rbList').addEventListener(type, e => {
    const row = elOf(e)?.closest('.cmd-row');
    if (!row || (type === 'dragstart' && !elOf(e).closest('.cmd-handle'))) return;
    handler(e, row, Number(row.dataset.si), Number(row.dataset.ci));
  });
});

// Opened from the status bar before the panel existed: go straight to that environment.
// Last in the file on purpose, so every piece of state it touches is already defined.
if (typeof __INITIAL__ !== 'undefined' && __INITIAL__.open) openEnvFromHost(__INITIAL__.open);
