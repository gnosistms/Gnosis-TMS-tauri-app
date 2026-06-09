import { requireBrokerSession } from "./auth-flow.js";
import { selectedQaList, selectedTeam } from "./qa-list-shared.js";
import { markQaTermsStale } from "./qa-term-sync.js";
import { invoke } from "./runtime.js";
import { state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";
import { isDeletedRepoResource } from "./repo-transport-eligibility.js";

const QA_LIST_SYNC_IDLE_MS = 10_000;

const qaListBackgroundSyncSession = {
  key: "",
  intervalId: 0,
  lastScrollAt: 0,
  pendingSync: null,
  hasLocalMutations: false,
};

function currentSessionKey() {
  if (state.screen !== "qaListEditor" || !state.qaListEditor?.qaListId) {
    return "";
  }

  return state.qaListEditor.qaListId;
}

function sessionMatchesCurrentQaList() {
  return (
    qaListBackgroundSyncSession.key
    && qaListBackgroundSyncSession.key === currentSessionKey()
  );
}

function ensureQaListSyncSession(options = {}) {
  if (sessionMatchesCurrentQaList()) {
    return true;
  }

  if (options.force !== true) {
    return false;
  }

  const key = currentSessionKey();
  if (!key) {
    return false;
  }

  if (qaListBackgroundSyncSession.key !== key) {
    clearQaListBackgroundSyncInterval();
    qaListBackgroundSyncSession.pendingSync = null;
    qaListBackgroundSyncSession.hasLocalMutations = false;
  }

  qaListBackgroundSyncSession.key = key;
  qaListBackgroundSyncSession.lastScrollAt = performance.now();
  return true;
}

function activeQaListSyncInput() {
  const team = selectedTeam();
  const qaList = selectedQaList();
  const editorQaList = state.qaListEditor?.qaListId ? state.qaListEditor : null;
  const qaListId = qaList?.id ?? editorQaList?.qaListId ?? null;
  const repoName = qaList?.repoName || editorQaList?.repoName || "";
  const fullName = qaList?.fullName || editorQaList?.fullName || "";
  if (isDeletedRepoResource(qaList) || isDeletedRepoResource(editorQaList)) {
    return null;
  }
  if (
    !Number.isFinite(team?.installationId)
    || !repoName
    || !fullName
  ) {
    return null;
  }

  return {
    installationId: team.installationId,
    qaListId,
    repoName,
    fullName,
    repoId:
      Number.isFinite(qaList?.repoId)
        ? qaList.repoId
        : Number.isFinite(editorQaList?.repoId)
          ? editorQaList.repoId
          : null,
    defaultBranchName: qaList?.defaultBranchName ?? editorQaList?.defaultBranchName ?? "main",
    defaultBranchHeadOid: qaList?.defaultBranchHeadOid ?? editorQaList?.defaultBranchHeadOid ?? null,
    lifecycleState: qaList?.lifecycleState ?? editorQaList?.lifecycleState ?? null,
    recordState: qaList?.recordState ?? editorQaList?.recordState ?? null,
    remoteState: qaList?.remoteState ?? editorQaList?.remoteState ?? null,
    status: qaList?.status ?? editorQaList?.status ?? null,
  };
}

function clearQaListBackgroundSyncInterval() {
  if (
    Number.isInteger(qaListBackgroundSyncSession.intervalId)
    && qaListBackgroundSyncSession.intervalId !== 0
  ) {
    window.clearInterval(qaListBackgroundSyncSession.intervalId);
  }
  qaListBackgroundSyncSession.intervalId = 0;
}

async function runQaListBackgroundSync(render) {
  if (!sessionMatchesCurrentQaList()) {
    return false;
  }

  const input = activeQaListSyncInput();
  if (!input) {
    return false;
  }

  try {
    const payload = await invoke("sync_gtms_qa_list_editor_repo", {
      input,
      sessionToken: requireBrokerSession(),
    });
    if (!sessionMatchesCurrentQaList()) {
      return false;
    }

    markQaTermsStale(payload);
    return true;
  } catch (error) {
    if (sessionMatchesCurrentQaList()) {
      const message = error instanceof Error ? error.message : String(error);
      const handled = await handleSyncFailure(classifySyncError(error), { render });
      if (!handled) {
        showNoticeBadge(message || "QA list background sync failed.", render, 2400);
      }
    }
    return false;
  }
}

export async function maybeStartQaListBackgroundSync(render, options = {}) {
  if (!ensureQaListSyncSession(options)) {
    return false;
  }

  if (qaListBackgroundSyncSession.pendingSync) {
    return qaListBackgroundSyncSession.pendingSync;
  }

  if (
    options.force !== true
    && (
      state.qaTermEditor?.isOpen === true
      || performance.now() - qaListBackgroundSyncSession.lastScrollAt < QA_LIST_SYNC_IDLE_MS
    )
  ) {
    return false;
  }

  const syncPromise = runQaListBackgroundSync(render);
  qaListBackgroundSyncSession.pendingSync = syncPromise;
  try {
    return await syncPromise;
  } finally {
    qaListBackgroundSyncSession.pendingSync = null;
  }
}

export function noteQaListBackgroundSyncScrollActivity() {
  if (!sessionMatchesCurrentQaList()) {
    return;
  }

  qaListBackgroundSyncSession.lastScrollAt = performance.now();
}

export function startQaListBackgroundSyncSession(render) {
  const key = currentSessionKey();
  clearQaListBackgroundSyncInterval();
  qaListBackgroundSyncSession.key = key;
  qaListBackgroundSyncSession.lastScrollAt = performance.now();
  qaListBackgroundSyncSession.pendingSync = null;
  qaListBackgroundSyncSession.hasLocalMutations = false;

  if (!key) {
    return;
  }

  qaListBackgroundSyncSession.intervalId = window.setInterval(() => {
    void maybeStartQaListBackgroundSync(render);
  }, QA_LIST_SYNC_IDLE_MS);
  void maybeStartQaListBackgroundSync(render, { force: true });
}

export function markQaListBackgroundSyncDirty() {
  if (!currentSessionKey()) {
    return;
  }

  qaListBackgroundSyncSession.hasLocalMutations = true;
}

export function qaListBackgroundSyncNeedsExitSync() {
  return sessionMatchesCurrentQaList() && qaListBackgroundSyncSession.hasLocalMutations === true;
}

export function qaListBackgroundSyncIsActive() {
  return sessionMatchesCurrentQaList() && Boolean(qaListBackgroundSyncSession.pendingSync);
}

export async function syncAndStopQaListBackgroundSyncSession(render, options = {}) {
  const shouldForceSync =
    options.force === true
    || (options.skipDirtyCheck !== true && qaListBackgroundSyncNeedsExitSync());

  if (shouldForceSync && sessionMatchesCurrentQaList()) {
    await maybeStartQaListBackgroundSync(render, { force: true });
  }

  clearQaListBackgroundSyncInterval();
  qaListBackgroundSyncSession.key = "";
  qaListBackgroundSyncSession.lastScrollAt = 0;
  qaListBackgroundSyncSession.pendingSync = null;
  qaListBackgroundSyncSession.hasLocalMutations = false;
}
