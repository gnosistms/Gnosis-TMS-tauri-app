// Decides whether a window close request may proceed while editor durable writes
// are pending. A forced close never fakes save success: it only stops preventing
// the close, leaving pending operations pending (see
// plans/repo-write-queue-stuck-state-handoff.md, "Local editor/metadata save is
// stuck").

export const EDITOR_CLOSE_GUARD_NOTICE =
  "Editor changes are still saving. The app will stay open until saving finishes. Close again to close anyway — unsaved changes may be lost.";

export const EDITOR_CLOSE_GUARD_NOTICE_DURATION_MS = 6000;
export const EDITOR_CLOSE_GUARD_REPEAT_MIN_DELAY_MS = 1000;
export const EDITOR_CLOSE_GUARD_REPEAT_WINDOW_MS = 30000;

export function createEditorCloseGuard({
  hasPendingDurableWrites,
  showBlockedNotice,
  now = () => Date.now(),
}) {
  let blockedAt = null;

  return {
    handleCloseRequest() {
      if (!hasPendingDurableWrites()) {
        blockedAt = null;
        return { allowClose: true, forced: false };
      }

      const sinceBlocked = blockedAt === null ? null : now() - blockedAt;
      if (
        sinceBlocked !== null
        && sinceBlocked >= EDITOR_CLOSE_GUARD_REPEAT_MIN_DELAY_MS
        && sinceBlocked <= EDITOR_CLOSE_GUARD_REPEAT_WINDOW_MS
      ) {
        blockedAt = null;
        return { allowClose: true, forced: true };
      }

      // A repeat attempt under the minimum delay keeps the original timestamp so
      // an accidental double close cannot arm and fire the escape hatch at once;
      // an attempt past the window counts as a fresh first attempt.
      if (sinceBlocked === null || sinceBlocked > EDITOR_CLOSE_GUARD_REPEAT_WINDOW_MS) {
        blockedAt = now();
      }
      showBlockedNotice?.(EDITOR_CLOSE_GUARD_NOTICE);
      return { allowClose: false, forced: false };
    },
  };
}
