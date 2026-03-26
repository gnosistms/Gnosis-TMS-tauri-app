import { state } from "./state.js";

const UP_TO_DATE_DURATION_MS = 5000;

let resetTimer = null;

export function createPageSyncState() {
  return { status: "idle" };
}

export function beginPageSync() {
  clearResetTimer();
  state.pageSync = { status: "syncing" };
}

export function completePageSync(render) {
  clearResetTimer();
  state.pageSync = { status: "upToDate" };
  resetTimer = window.setTimeout(() => {
    state.pageSync = createPageSyncState();
    render();
  }, UP_TO_DATE_DURATION_MS);
}

export function failPageSync() {
  clearResetTimer();
  state.pageSync = createPageSyncState();
}

export function resetPageSync() {
  clearResetTimer();
  state.pageSync = createPageSyncState();
}

function clearResetTimer() {
  if (resetTimer) {
    window.clearTimeout(resetTimer);
    resetTimer = null;
  }
}
