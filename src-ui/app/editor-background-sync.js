import { requireBrokerSession } from "./auth-flow.js";
import { flushDirtyEditorRows as flushDirtyEditorRowsFlow } from "./editor-persistence-flow.js";
import { markEditorRowsStale } from "./editor-row-sync-flow.js";
import {
  applyEditorSelectionsToProjectState,
  updateEditorChapterRow,
} from "./editor-state-flow.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import { invoke } from "./runtime.js";
import { state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";

const EDITOR_SYNC_IDLE_MS = 10_000;
const EDITOR_SYNC_LOCAL_COMMIT_THRESHOLD = 5;

const editorBackgroundSyncSession = {
  key: "",
  intervalId: 0,
  lastScrollAt: 0,
  lastSyncedHeadSha: null,
  pendingSync: null,
};

function currentSessionKey() {
  if (state.screen !== "translate" || !state.editorChapter?.chapterId) {
    return "";
  }

  return `${state.editorChapter.projectId ?? ""}:${state.editorChapter.chapterId}`;
}

function sessionMatchesCurrentEditor() {
  return editorBackgroundSyncSession.key && editorBackgroundSyncSession.key === currentSessionKey();
}

function persistenceOperations() {
  return {
    updateEditorChapterRow,
    applyEditorSelectionsToProjectState,
  };
}

function activeEditorSyncInput() {
  const team = selectedProjectsTeam();
  const context = findChapterContextById(state.editorChapter?.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name || !context?.chapter?.id) {
    return null;
  }

  return {
    installationId: team.installationId,
    projectId: context.project.id,
    repoName: context.project.name,
    fullName: context.project.fullName,
    repoId: Number.isFinite(context.project.repoId) ? context.project.repoId : null,
    defaultBranchName: context.project.defaultBranchName ?? "main",
    defaultBranchHeadOid: context.project.defaultBranchHeadOid ?? null,
    chapterId: context.chapter.id,
  };
}

function clearBackgroundSyncInterval() {
  if (Number.isInteger(editorBackgroundSyncSession.intervalId) && editorBackgroundSyncSession.intervalId !== 0) {
    window.clearInterval(editorBackgroundSyncSession.intervalId);
  }
  editorBackgroundSyncSession.intervalId = 0;
}

function setEditorBackgroundSyncState(status, error = "") {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    backgroundSyncStatus: status,
    backgroundSyncError: error,
  };
}

async function inspectPendingLocalCommitCount() {
  const input = activeEditorSyncInput();
  if (!input) {
    return { currentHeadSha: null, commitsSinceHead: 0 };
  }

  return invoke("inspect_gtms_project_editor_repo_sync_state", {
    input: {
      installationId: input.installationId,
      projectId: input.projectId,
      repoName: input.repoName,
      sinceHeadSha: editorBackgroundSyncSession.lastSyncedHeadSha,
    },
  });
}

async function runEditorBackgroundSync(render, options = {}) {
  if (!sessionMatchesCurrentEditor()) {
    return null;
  }

  const input = activeEditorSyncInput();
  if (!input) {
    return null;
  }

  if (options.skipDirtyFlush !== true) {
    if (await flushDirtyEditorRowsFlow(render, persistenceOperations()) === false) {
      return null;
    }
  }

  const previousSyncStatus = state.editorChapter?.backgroundSyncStatus ?? "";
  const previousSyncError = state.editorChapter?.backgroundSyncError ?? "";
  const hadVisibleErrorBanner = previousSyncStatus === "error" && Boolean(previousSyncError);
  setEditorBackgroundSyncState("syncing", "");

  try {
    const payload = await invoke("sync_gtms_project_editor_repo", {
      input,
      sessionToken: requireBrokerSession(),
    });

    if (!sessionMatchesCurrentEditor()) {
      return null;
    }

    editorBackgroundSyncSession.lastSyncedHeadSha =
      payload?.newHeadSha
      ?? payload?.oldHeadSha
      ?? editorBackgroundSyncSession.lastSyncedHeadSha;
    const visibleChangesApplied = markEditorRowsStale(payload);
    setEditorBackgroundSyncState("idle", "");
    if (visibleChangesApplied || hadVisibleErrorBanner) {
      render?.({ scope: "translate-body" });
    }
    return payload ?? null;
  } catch (error) {
    if (sessionMatchesCurrentEditor()) {
      const message = error instanceof Error ? error.message : String(error);
      setEditorBackgroundSyncState("error", message);
      if (!hadVisibleErrorBanner || previousSyncError !== message) {
        render?.({ scope: "translate-body" });
      }
      showNoticeBadge(message || "Background sync failed.", render, 2400);
    }
    return null;
  }
}

export async function maybeStartEditorBackgroundSync(render, options = {}) {
  if (!sessionMatchesCurrentEditor()) {
    return false;
  }

  if (editorBackgroundSyncSession.pendingSync) {
    return editorBackgroundSyncSession.pendingSync;
  }

  if (options.force !== true) {
    if (performance.now() - editorBackgroundSyncSession.lastScrollAt < EDITOR_SYNC_IDLE_MS) {
      return false;
    }

    const syncState = await inspectPendingLocalCommitCount();
    if (!sessionMatchesCurrentEditor()) {
      return false;
    }
    if (typeof syncState?.currentHeadSha === "string" && syncState.currentHeadSha.trim()) {
      state.editorChapter = {
        ...state.editorChapter,
        chapterBaseCommitSha: syncState.currentHeadSha,
      };
    }
    if ((syncState?.commitsSinceHead ?? 0) < EDITOR_SYNC_LOCAL_COMMIT_THRESHOLD) {
      return false;
    }
  }

  const syncPromise = runEditorBackgroundSync(render, options);
  editorBackgroundSyncSession.pendingSync = syncPromise;
  try {
    return await syncPromise;
  } finally {
    editorBackgroundSyncSession.pendingSync = null;
  }
}

export async function syncEditorBackgroundNow(render, options = {}) {
  if (!sessionMatchesCurrentEditor()) {
    return null;
  }

  if (options.afterLocalCommit === true) {
    while (editorBackgroundSyncSession.pendingSync) {
      await editorBackgroundSyncSession.pendingSync;
      if (!sessionMatchesCurrentEditor()) {
        return null;
      }
    }
  } else if (editorBackgroundSyncSession.pendingSync) {
    return editorBackgroundSyncSession.pendingSync;
  }

  if (editorBackgroundSyncSession.pendingSync) {
    return editorBackgroundSyncSession.pendingSync;
  }

  const syncPromise = runEditorBackgroundSync(render, {
    skipDirtyFlush: options.skipDirtyFlush === true,
  });
  editorBackgroundSyncSession.pendingSync = syncPromise;
  try {
    return await syncPromise;
  } finally {
    editorBackgroundSyncSession.pendingSync = null;
  }
}

export function noteEditorBackgroundSyncHead(headSha) {
  const normalizedHeadSha =
    typeof headSha === "string" && headSha.trim()
      ? headSha.trim()
      : "";
  if (!normalizedHeadSha || !sessionMatchesCurrentEditor()) {
    return;
  }

  editorBackgroundSyncSession.lastSyncedHeadSha = normalizedHeadSha;
}

export function noteEditorBackgroundSyncScrollActivity() {
  if (!sessionMatchesCurrentEditor()) {
    return;
  }

  editorBackgroundSyncSession.lastScrollAt = performance.now();
}

export function startEditorBackgroundSyncSession(render) {
  const key = currentSessionKey();
  clearBackgroundSyncInterval();
  editorBackgroundSyncSession.key = key;
  editorBackgroundSyncSession.lastScrollAt = performance.now();
  editorBackgroundSyncSession.pendingSync = null;
  editorBackgroundSyncSession.lastSyncedHeadSha =
    typeof state.editorChapter?.chapterBaseCommitSha === "string" && state.editorChapter.chapterBaseCommitSha.trim()
      ? state.editorChapter.chapterBaseCommitSha
      : null;

  if (!key) {
    return;
  }

  editorBackgroundSyncSession.intervalId = window.setInterval(() => {
    void maybeStartEditorBackgroundSync(render);
  }, EDITOR_SYNC_IDLE_MS);
  void maybeStartEditorBackgroundSync(render, { force: true });
}

export async function syncAndStopEditorBackgroundSyncSession(render) {
  if (sessionMatchesCurrentEditor()) {
    await maybeStartEditorBackgroundSync(render, { force: true });
  }

  clearBackgroundSyncInterval();
  editorBackgroundSyncSession.key = "";
  editorBackgroundSyncSession.lastScrollAt = 0;
  editorBackgroundSyncSession.lastSyncedHeadSha = null;
  editorBackgroundSyncSession.pendingSync = null;
}
