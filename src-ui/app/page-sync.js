import { createSyncState } from "./sync-state.js";
import { state } from "./state.js";

const UP_TO_DATE_DURATION_MS = 5000;
const MIN_SYNCING_DURATION_MS = 400;

export function createPageSyncController({
  getState,
  setState,
  countConcurrent = false,
  minSyncingDurationMs = MIN_SYNCING_DURATION_MS,
  upToDateDurationMs = UP_TO_DATE_DURATION_MS,
}) {
  let resetTimer = null;
  let syncingStartedAt = 0;
  let activeSyncCount = 0;

  function clearResetTimer() {
    if (resetTimer) {
      window.clearTimeout(resetTimer);
      resetTimer = null;
    }
  }

  return {
    begin() {
      clearResetTimer();
      if (countConcurrent) {
        activeSyncCount += 1;
        if (activeSyncCount > 1) {
          return;
        }
      }

      syncingStartedAt = performance.now();
      setState({ status: "syncing", startedAt: syncingStartedAt });
    },

    async complete(render) {
      if (countConcurrent) {
        if (activeSyncCount <= 0) {
          return;
        }

        activeSyncCount -= 1;
        if (activeSyncCount > 0) {
          return;
        }
      }

      clearResetTimer();
      const elapsed = syncingStartedAt ? performance.now() - syncingStartedAt : 0;
      const remaining = Math.max(0, minSyncingDurationMs - elapsed);
      if (remaining > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remaining));
      }

      setState({ status: "upToDate", startedAt: null });
      syncingStartedAt = 0;
      render?.();
      resetTimer = window.setTimeout(() => {
        setState(createSyncState());
        render?.();
      }, upToDateDurationMs);
    },

    fail() {
      clearResetTimer();
      syncingStartedAt = 0;
      activeSyncCount = 0;
      setState(createSyncState());
    },

    reset() {
      clearResetTimer();
      syncingStartedAt = 0;
      activeSyncCount = 0;
      setState(createSyncState());
    },

    read() {
      return getState();
    },
  };
}

const pageSyncController = createPageSyncController({
  getState: () => state.pageSync,
  setState: (nextState) => {
    state.pageSync = nextState;
  },
});

const projectsPageSyncController = createPageSyncController({
  getState: () => state.projectsPageSync,
  setState: (nextState) => {
    state.projectsPageSync = nextState;
  },
  countConcurrent: true,
});

export function beginPageSync() {
  pageSyncController.begin();
}

export async function completePageSync(render) {
  await pageSyncController.complete(render);
}

export function failPageSync() {
  pageSyncController.fail();
}

export function resetPageSync() {
  pageSyncController.reset();
}

export function beginProjectsPageSync() {
  projectsPageSyncController.begin();
}

export async function completeProjectsPageSync(render) {
  await projectsPageSyncController.complete(render);
}

export function failProjectsPageSync() {
  projectsPageSyncController.fail();
}

export function resetProjectsPageSync() {
  projectsPageSyncController.reset();
}
