import { state } from "./state.js";

const UP_TO_DATE_DURATION_MS = 5000;
const MIN_SYNCING_DURATION_MS = 400;

let resetTimer = null;
let syncingStartedAt = 0;

export function createPageSyncState() {
  return { status: "idle", startedAt: null };
}

export function beginPageSync() {
  clearResetTimer();
  syncingStartedAt = performance.now();
  state.pageSync = { status: "syncing", startedAt: syncingStartedAt };
}

export async function completePageSync(render) {
  clearResetTimer();
  const elapsed = syncingStartedAt ? performance.now() - syncingStartedAt : 0;
  const remaining = Math.max(0, MIN_SYNCING_DURATION_MS - elapsed);
  if (remaining > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, remaining));
  }
  state.pageSync = { status: "upToDate", startedAt: null };
  syncingStartedAt = 0;
  render();
  resetTimer = window.setTimeout(() => {
    state.pageSync = createPageSyncState();
    render();
  }, UP_TO_DATE_DURATION_MS);
}

export function failPageSync() {
  clearResetTimer();
  syncingStartedAt = 0;
  state.pageSync = createPageSyncState();
}

export function resetPageSync() {
  clearResetTimer();
  syncingStartedAt = 0;
  state.pageSync = createPageSyncState();
}

function clearResetTimer() {
  if (resetTimer) {
    window.clearTimeout(resetTimer);
    resetTimer = null;
  }
}
