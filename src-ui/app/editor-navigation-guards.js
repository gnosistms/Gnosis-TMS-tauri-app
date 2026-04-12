export async function guardLeavingTranslateEditor({
  currentScreen,
  nextScreen,
  render,
  flushDirtyEditorRows,
  showBlockedNotice,
}) {
  if (currentScreen !== "translate" || nextScreen === "translate") {
    return true;
  }

  if (await flushDirtyEditorRows(render)) {
    return true;
  }

  showBlockedNotice?.("Finish saving the current row before leaving the editor.");
  return false;
}

export async function guardRefreshingTranslateEditor({
  currentScreen,
  render,
  flushDirtyEditorRows,
}) {
  if (currentScreen !== "translate") {
    return true;
  }

  return flushDirtyEditorRows(render);
}
