// Decides whether a window close request may proceed while editor durable writes
// are pending. A blocked request opens the close-wait session (see
// editor-close-wait-flow.js), which shows saving progress, closes the app when
// writes drain, and owns the explicit force-close path. Blocking never fakes
// save success: pending operations stay pending (see
// plans/repo-write-queue-stuck-state-handoff.md, "Local editor/metadata save is
// stuck").

export function createEditorCloseGuard({
  hasPendingDurableWrites,
  onCloseBlocked,
}) {
  return {
    handleCloseRequest() {
      if (!hasPendingDurableWrites()) {
        return { allowClose: true };
      }

      onCloseBlocked?.();
      return { allowClose: false };
    },
  };
}
