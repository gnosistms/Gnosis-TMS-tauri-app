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
  waitForPendingEditorWrites,
}) {
  if (currentScreen !== "translate") {
    return true;
  }

  // A refresh must not turn the current draft into a save request. The chapter
  // loader keeps dirty text in memory; only already submitted writes must finish.
  await waitForPendingEditorWrites();
  return true;
}
