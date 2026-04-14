import { requireBrokerSession } from "./auth-flow.js";
import { selectedGlossary, selectedTeam } from "./glossary-shared.js";
import { markGlossaryTermsStale } from "./glossary-term-sync.js";
import { invoke } from "./runtime.js";
import { state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";

const GLOSSARY_SYNC_IDLE_MS = 10_000;

const glossaryBackgroundSyncSession = {
  key: "",
  intervalId: 0,
  lastScrollAt: 0,
  pendingSync: null,
};

function currentSessionKey() {
  if (state.screen !== "glossaryEditor" || !state.glossaryEditor?.glossaryId) {
    return "";
  }

  return state.glossaryEditor.glossaryId;
}

function sessionMatchesCurrentGlossary() {
  return (
    glossaryBackgroundSyncSession.key
    && glossaryBackgroundSyncSession.key === currentSessionKey()
  );
}

function ensureGlossarySyncSession(options = {}) {
  if (sessionMatchesCurrentGlossary()) {
    return true;
  }

  if (options.force !== true) {
    return false;
  }

  const key = currentSessionKey();
  if (!key) {
    return false;
  }

  if (glossaryBackgroundSyncSession.key !== key) {
    clearGlossaryBackgroundSyncInterval();
    glossaryBackgroundSyncSession.pendingSync = null;
  }

  glossaryBackgroundSyncSession.key = key;
  glossaryBackgroundSyncSession.lastScrollAt = performance.now();
  return true;
}

function activeGlossarySyncInput() {
  const team = selectedTeam();
  const glossary = selectedGlossary();
  const editorGlossary = state.glossaryEditor?.glossaryId ? state.glossaryEditor : null;
  const glossaryId = glossary?.id ?? editorGlossary?.glossaryId ?? null;
  const repoName = glossary?.repoName || editorGlossary?.repoName || "";
  const fullName = glossary?.fullName || editorGlossary?.fullName || "";
  if (
    !Number.isFinite(team?.installationId)
    || !repoName
    || !fullName
  ) {
    return null;
  }

  return {
    installationId: team.installationId,
    glossaryId,
    repoName,
    fullName,
    repoId:
      Number.isFinite(glossary?.repoId)
        ? glossary.repoId
        : Number.isFinite(editorGlossary?.repoId)
          ? editorGlossary.repoId
          : null,
    defaultBranchName: glossary?.defaultBranchName ?? editorGlossary?.defaultBranchName ?? "main",
    defaultBranchHeadOid: glossary?.defaultBranchHeadOid ?? editorGlossary?.defaultBranchHeadOid ?? null,
  };
}

function clearGlossaryBackgroundSyncInterval() {
  if (
    Number.isInteger(glossaryBackgroundSyncSession.intervalId)
    && glossaryBackgroundSyncSession.intervalId !== 0
  ) {
    window.clearInterval(glossaryBackgroundSyncSession.intervalId);
  }
  glossaryBackgroundSyncSession.intervalId = 0;
}

async function runGlossaryBackgroundSync(render) {
  if (!sessionMatchesCurrentGlossary()) {
    return false;
  }

  const input = activeGlossarySyncInput();
  if (!input) {
    return false;
  }

  try {
    const payload = await invoke("sync_gtms_glossary_editor_repo", {
      input,
      sessionToken: requireBrokerSession(),
    });
    if (!sessionMatchesCurrentGlossary()) {
      return false;
    }

    markGlossaryTermsStale(payload);
    return true;
  } catch (error) {
    if (sessionMatchesCurrentGlossary()) {
      const message = error instanceof Error ? error.message : String(error);
      showNoticeBadge(message || "Glossary background sync failed.", render, 2400);
    }
    return false;
  }
}

export async function maybeStartGlossaryBackgroundSync(render, options = {}) {
  if (!ensureGlossarySyncSession(options)) {
    return false;
  }

  if (glossaryBackgroundSyncSession.pendingSync) {
    return glossaryBackgroundSyncSession.pendingSync;
  }

  if (
    options.force !== true
    && (
      state.glossaryTermEditor?.isOpen === true
      || performance.now() - glossaryBackgroundSyncSession.lastScrollAt < GLOSSARY_SYNC_IDLE_MS
    )
  ) {
    return false;
  }

  const syncPromise = runGlossaryBackgroundSync(render);
  glossaryBackgroundSyncSession.pendingSync = syncPromise;
  try {
    return await syncPromise;
  } finally {
    glossaryBackgroundSyncSession.pendingSync = null;
  }
}

export function noteGlossaryBackgroundSyncScrollActivity() {
  if (!sessionMatchesCurrentGlossary()) {
    return;
  }

  glossaryBackgroundSyncSession.lastScrollAt = performance.now();
}

export function startGlossaryBackgroundSyncSession(render) {
  const key = currentSessionKey();
  clearGlossaryBackgroundSyncInterval();
  glossaryBackgroundSyncSession.key = key;
  glossaryBackgroundSyncSession.lastScrollAt = performance.now();
  glossaryBackgroundSyncSession.pendingSync = null;

  if (!key) {
    return;
  }

  glossaryBackgroundSyncSession.intervalId = window.setInterval(() => {
    void maybeStartGlossaryBackgroundSync(render);
  }, GLOSSARY_SYNC_IDLE_MS);
  void maybeStartGlossaryBackgroundSync(render, { force: true });
}

export async function syncAndStopGlossaryBackgroundSyncSession(render) {
  if (sessionMatchesCurrentGlossary()) {
    await maybeStartGlossaryBackgroundSync(render, { force: true });
  }

  clearGlossaryBackgroundSyncInterval();
  glossaryBackgroundSyncSession.key = "";
  glossaryBackgroundSyncSession.lastScrollAt = 0;
  glossaryBackgroundSyncSession.pendingSync = null;
}
