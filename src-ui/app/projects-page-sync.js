import { createProjectsPageSyncState, state } from "./state.js";

const UP_TO_DATE_DURATION_MS = 5000;
const MIN_SYNCING_DURATION_MS = 400;

let resetTimer = null;
let syncingStartedAt = 0;
let activeSyncCount = 0;

export function beginProjectsPageSync() {
  clearResetTimer();
  activeSyncCount += 1;
  if (activeSyncCount === 1) {
    syncingStartedAt = performance.now();
    state.projectsPageSync = { status: "syncing" };
  }
}

export async function completeProjectsPageSync(render) {
  if (activeSyncCount <= 0) {
    return;
  }

  activeSyncCount -= 1;
  if (activeSyncCount > 0) {
    return;
  }

  clearResetTimer();
  const elapsed = syncingStartedAt ? performance.now() - syncingStartedAt : 0;
  const remaining = Math.max(0, MIN_SYNCING_DURATION_MS - elapsed);
  if (remaining > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, remaining));
  }

  state.projectsPageSync = { status: "upToDate" };
  syncingStartedAt = 0;
  resetTimer = window.setTimeout(() => {
    state.projectsPageSync = createProjectsPageSyncState();
    render();
  }, UP_TO_DATE_DURATION_MS);
}

export function failProjectsPageSync() {
  clearResetTimer();
  syncingStartedAt = 0;
  activeSyncCount = 0;
  state.projectsPageSync = createProjectsPageSyncState();
}

export function resetProjectsPageSync() {
  clearResetTimer();
  syncingStartedAt = 0;
  activeSyncCount = 0;
  state.projectsPageSync = createProjectsPageSyncState();
}

function clearResetTimer() {
  if (resetTimer) {
    window.clearTimeout(resetTimer);
    resetTimer = null;
  }
}
