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

  if (await flushDirtyEditorRows(render, {}, { waitForDurable: true })) {
    return true;
  }

  showBlockedNotice?.("Local save is still pending or failed. Wait for it to finish, or resolve the row before leaving the editor.");
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
