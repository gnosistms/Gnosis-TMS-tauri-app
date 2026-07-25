// Owns the "saving changes before closing" wait session opened when a window
// close request is blocked by pending durable editor writes. While open, it
// polls the write sources, keeps `state.editorCloseWait` current for the modal,
// and closes the window automatically once the guard predicate drains. See
// plans/editor-close-wait-feedback-plan.md.

import { state, createEditorCloseWaitState } from "./state.js";
import { countPendingEditorWriteRows } from "./editor-persistence-flow.js";
import { getEditorOperationQueueSnapshot } from "./editor-operation-queue.js";
import { getRepoWriteQueueSnapshot } from "./repo-write-queue.js";

export const EDITOR_CLOSE_WAIT_POLL_MS = 250;

// Progress signal for the modal, not an exact ledger: a running row save can
// also appear as a repo write queue operation. Completion is driven by the
// guard predicate, never by this count reaching zero.
function defaultPendingWriteCount() {
  return (
    countPendingEditorWriteRows(state.editorChapter)
    + getEditorOperationQueueSnapshot().activeCount
    + getRepoWriteQueueSnapshot().activeCount
  );
}

export function createEditorCloseWaitController({
  getPendingWriteCount = defaultPendingWriteCount,
  schedule = (callback, delayMs) => setInterval(callback, delayMs),
  cancel = (handle) => clearInterval(handle),
} = {}) {
  let pollHandle = null;
  let session = null;

  function stopPolling() {
    if (pollHandle !== null) {
      cancel(pollHandle);
      pollHandle = null;
    }
  }

  function closeSession() {
    stopPolling();
    session = null;
    state.editorCloseWait = createEditorCloseWaitState();
  }

  function pollOnce() {
    if (!session) {
      return;
    }

    const { render, hasPendingDurableWrites, closeWindow } = session;
    if (!hasPendingDurableWrites()) {
      closeSession();
      render();
      closeWindow();
      return;
    }

    const pendingCount = getPendingWriteCount();
    if (pendingCount === state.editorCloseWait.pendingCount) {
      return;
    }

    state.editorCloseWait = {
      ...state.editorCloseWait,
      pendingCount,
      initialCount: Math.max(state.editorCloseWait.initialCount, pendingCount),
    };
    render();
  }

  return {
    begin(render, { hasPendingDurableWrites, closeWindow }) {
      if (session) {
        // A repeated close click while the modal is open is absorbed: the
        // session (and its close-intent) is already running.
        return;
      }

      const pendingCount = getPendingWriteCount();
      session = { render, hasPendingDurableWrites, closeWindow };
      state.editorCloseWait = {
        isOpen: true,
        pendingCount,
        initialCount: pendingCount,
      };
      pollHandle = schedule(pollOnce, EDITOR_CLOSE_WAIT_POLL_MS);
      render();
    },
    keepOpen(render) {
      if (!session) {
        return;
      }
      closeSession();
      render();
    },
    forceClose(render) {
      if (!session) {
        return;
      }
      const { closeWindow } = session;
      closeSession();
      render();
      closeWindow({ force: true });
    },
    isOpen() {
      return session !== null;
    },
  };
}

const defaultController = createEditorCloseWaitController();

export function beginEditorCloseWait(render, dependencies) {
  defaultController.begin(render, dependencies);
}

export function keepAppOpenFromEditorCloseWait(render) {
  defaultController.keepOpen(render);
}

export function forceCloseFromEditorCloseWait(render) {
  defaultController.forceClose(render);
}
