import { invoke, waitForNextPaint } from "./runtime.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import { createGlossaryEditorState, state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { resolveGlossaryEditorNavigationSource } from "./glossary-editor-navigation-source.js";
import {
  glossaryBackgroundSyncIsActive,
  glossaryBackgroundSyncNeedsExitSync,
  markGlossaryBackgroundSyncDirty,
  startGlossaryBackgroundSyncSession,
  syncAndStopGlossaryBackgroundSyncSession,
} from "./glossary-background-sync.js";
import {
  applyGlossaryEditorPayload,
  canManageGlossaries,
  selectedGlossary,
  selectedGlossaryRepoName,
  selectedTeam,
  upsertGlossarySummary,
} from "./glossary-shared.js";
import {
  getGlossarySyncIssueMessage,
  ensureGlossaryNotTombstoned,
  syncSingleGlossaryForTeam,
} from "./glossary-repo-flow.js";
import { refreshCurrentUserTeamAccess } from "./team-query.js";
import { anyGlossaryTermWriteIsActive } from "./glossary-term-write-coordinator.js";
import {
  createGlossaryEditorQueryOptions,
  getCachedGlossaryEditorPayload,
  removeGlossaryEditorQuery,
} from "./glossary-editor-query.js";
import { queryClient } from "./query-client.js";

function resolveGlossaryForEditor(glossaryId = state.selectedGlossaryId, preferredGlossary = null) {
  const selected = selectedGlossary();
  if (selected?.repoName) {
    return selected;
  }

  const normalizedPreferred = upsertGlossarySummary(preferredGlossary);
  if (normalizedPreferred?.repoName) {
    return normalizedPreferred;
  }

  const editorGlossaryId = state.glossaryEditor?.glossaryId ?? null;
  const requestedGlossaryId = glossaryId ?? editorGlossaryId;
  if (
    requestedGlossaryId
    && state.glossaryEditor?.repoName
    && (editorGlossaryId === requestedGlossaryId || state.selectedGlossaryId == null)
  ) {
    return {
      id: requestedGlossaryId,
      repoName: state.glossaryEditor.repoName,
      repoId: Number.isFinite(state.glossaryEditor.repoId) ? state.glossaryEditor.repoId : null,
      fullName: state.glossaryEditor.fullName ?? "",
      defaultBranchName: state.glossaryEditor.defaultBranchName ?? "main",
      defaultBranchHeadOid: state.glossaryEditor.defaultBranchHeadOid ?? null,
      title: state.glossaryEditor.title,
      sourceLanguage: state.glossaryEditor.sourceLanguage,
      targetLanguage: state.glossaryEditor.targetLanguage,
      lifecycleState: state.glossaryEditor.lifecycleState,
      termCount: state.glossaryEditor.termCount,
    };
  }

  return null;
}

function glossaryEditorContext(team, glossary, options = {}) {
  return {
    teamId: team?.id ?? null,
    installationId: team?.installationId ?? null,
    glossaryId: glossary?.id ?? glossary?.glossaryId ?? null,
    repoName: glossary?.repoName ?? "",
    navigationSource:
      options.navigationSource
      ?? state.glossaryEditor?.navigationSource
      ?? null,
  };
}

export function glossaryEditorContextMatches(expectedContext) {
  const team = selectedTeam();
  return Boolean(
    state.screen === "glossaryEditor"
      && team?.id === expectedContext?.teamId
      && team?.installationId === expectedContext?.installationId
      && state.selectedGlossaryId === expectedContext?.glossaryId
      && state.glossaryEditor?.glossaryId === expectedContext?.glossaryId
      && state.glossaryEditor?.repoName === expectedContext?.repoName,
  );
}

export function glossaryEditorPayloadMatches(payload, expectedContext) {
  return Boolean(
    payload?.glossaryId === expectedContext?.glossaryId
      && (!payload?.repoName || payload.repoName === expectedContext?.repoName),
  );
}

export function glossaryEditorHasOpenDraft() {
  return state.glossaryTermEditor?.isOpen === true;
}

export function glossaryEditorHasActiveTermWrite() {
  return anyGlossaryTermWriteIsActive();
}

export function glossaryEditorHasActiveBackgroundSync() {
  return glossaryBackgroundSyncIsActive() || glossaryBackgroundSyncNeedsExitSync();
}

export function glossaryEditorHasPendingLocalTerms() {
  return (state.glossaryEditor?.terms ?? []).some((term) =>
    term?.pendingMutation === "save"
      || term?.pendingMutation === "create"
      || Boolean(term?.optimisticClientId)
      || Boolean(term?.pendingError),
  );
}

export function canApplyGlossaryEditorSnapshot(expectedContext) {
  if (!glossaryEditorContextMatches(expectedContext)) {
    return { canApply: false, reason: "stale-context" };
  }
  if (glossaryEditorHasOpenDraft()) {
    return { canApply: false, reason: "open-draft" };
  }
  if (glossaryEditorHasActiveTermWrite()) {
    return { canApply: false, reason: "active-write" };
  }
  if (glossaryEditorHasActiveBackgroundSync()) {
    return { canApply: false, reason: "active-background-sync" };
  }
  if (glossaryEditorHasPendingLocalTerms()) {
    return { canApply: false, reason: "pending-local-terms" };
  }
  return { canApply: true, reason: "ready" };
}

export function maybeApplyGlossaryEditorSnapshot(payload, expectedContext, render, options = {}) {
  if (!glossaryEditorContextMatches(expectedContext)) {
    return { applied: false, reason: "stale-context" };
  }
  if (!glossaryEditorPayloadMatches(payload, expectedContext)) {
    return { applied: false, reason: "payload-mismatch" };
  }

  const decision = canApplyGlossaryEditorSnapshot(expectedContext);
  if (!decision.canApply) {
    if (options.showDeferredNotice === true) {
      showNoticeBadge(
        "Glossary refreshed. Finish the current edit to update the term list.",
        render,
        2400,
      );
    }
    return { applied: false, reason: decision.reason };
  }

  applyGlossaryEditorPayload(payload);
  render?.();
  return { applied: true, reason: "applied" };
}

export function primeSelectedGlossaryEditorLoadingState(options = {}) {
  const glossaryId = options.glossaryId ?? state.selectedGlossaryId;
  const glossary = resolveGlossaryForEditor(glossaryId, options.preferredGlossary ?? null);
  const preservedSearchQuery = state.glossaryEditor?.searchQuery ?? "";
  const navigationSource = resolveGlossaryEditorNavigationSource(
    options,
    state.glossaryEditor?.navigationSource,
  );

  if (!glossary?.repoName) {
    state.glossaryEditor = {
      ...createGlossaryEditorState(),
      status: "error",
      error: "Could not determine which glossary to open.",
      navigationSource,
      searchQuery: preservedSearchQuery,
    };
    return;
  }

  state.glossaryEditor = {
    ...createGlossaryEditorState(),
    status: "loading",
    error: "",
    navigationSource,
    glossaryId,
    repoName: glossary.repoName,
    repoId: Number.isFinite(glossary.repoId) ? glossary.repoId : null,
    fullName: glossary.fullName ?? "",
    defaultBranchName: glossary.defaultBranchName ?? "main",
    defaultBranchHeadOid: glossary.defaultBranchHeadOid ?? null,
    title: glossary.title,
    sourceLanguage: glossary.sourceLanguage,
    targetLanguage: glossary.targetLanguage,
    lifecycleState: glossary.lifecycleState,
    termCount: glossary.termCount,
    searchQuery: preservedSearchQuery,
  };
}

export async function loadSelectedGlossaryEditorData(render, options = {}) {
  const preserveVisibleData = options.preserveVisibleData === true;
  const glossaryId = options.glossaryId ?? state.selectedGlossaryId ?? state.glossaryEditor?.glossaryId ?? null;
  const team = selectedTeam();
  const glossary = resolveGlossaryForEditor(glossaryId, options.preferredGlossary ?? null);
  const expectedContext = glossaryEditorContext(team, glossary, {
    navigationSource: state.glossaryEditor?.navigationSource ?? null,
  });
  if (!Number.isFinite(team?.installationId) || !glossary?.repoName) {
    state.glossaryEditor = {
      ...state.glossaryEditor,
      status: "error",
      error: "Could not determine which glossary to open.",
      terms: [],
    };
    render();
    return;
  }
  if (await ensureGlossaryNotTombstoned(render, team, glossary, { showNotice: false })) {
    removeGlossaryEditorQuery(team, glossary);
    state.glossaryEditor = {
      ...createGlossaryEditorState(),
      status: "error",
      error: "This glossary was permanently deleted.",
      searchQuery: state.glossaryEditor?.searchQuery ?? "",
    };
    render();
    return;
  }

  beginPageSync();
  if (preserveVisibleData && state.glossaryEditor?.status === "ready") {
    state.glossaryEditor = {
      ...state.glossaryEditor,
      error: "",
      glossaryId: glossary.id,
      repoName: glossary.repoName,
      repoId: Number.isFinite(glossary.repoId) ? glossary.repoId : null,
      fullName: glossary.fullName ?? state.glossaryEditor.fullName ?? "",
      defaultBranchName: glossary.defaultBranchName ?? state.glossaryEditor.defaultBranchName ?? "main",
      defaultBranchHeadOid: glossary.defaultBranchHeadOid ?? state.glossaryEditor.defaultBranchHeadOid ?? null,
      title: glossary.title,
      sourceLanguage: glossary.sourceLanguage,
      targetLanguage: glossary.targetLanguage,
      lifecycleState: glossary.lifecycleState,
      termCount: glossary.termCount,
    };
  } else {
    state.glossaryEditor = {
      ...state.glossaryEditor,
      status: "loading",
      error: "",
      glossaryId,
      repoName: glossary.repoName,
      repoId: Number.isFinite(glossary.repoId) ? glossary.repoId : null,
      fullName: glossary.fullName ?? state.glossaryEditor.fullName ?? "",
      defaultBranchName: glossary.defaultBranchName ?? state.glossaryEditor.defaultBranchName ?? "main",
      defaultBranchHeadOid: glossary.defaultBranchHeadOid ?? state.glossaryEditor.defaultBranchHeadOid ?? null,
      title: glossary.title,
      sourceLanguage: glossary.sourceLanguage,
      targetLanguage: glossary.targetLanguage,
      lifecycleState: glossary.lifecycleState,
      termCount: glossary.termCount,
      terms: [],
    };
  }
  render();
  await waitForNextPaint();

  try {
    const queryOptions = createGlossaryEditorQueryOptions(team, glossary);
    await queryClient.invalidateQueries({ queryKey: queryOptions.queryKey, exact: true });
    const payload = await queryClient.fetchQuery(queryOptions);
    const applyResult = maybeApplyGlossaryEditorSnapshot(payload, expectedContext, render, {
      showDeferredNotice: true,
    });
    if (glossaryEditorContextMatches(expectedContext)) {
      await completePageSync(render);
      if (applyResult.applied) {
        render();
      }
    }
  } catch (error) {
    failPageSync();
    if (
      glossaryEditorContextMatches(expectedContext)
      && (!preserveVisibleData || state.glossaryEditor?.status !== "ready")
    ) {
      state.glossaryEditor = {
        ...state.glossaryEditor,
        status: "error",
        error: error?.message ?? String(error),
        terms: [],
      };
      showNoticeBadge(error?.message ?? String(error), render);
      render();
    }
  }
}

export async function openGlossaryEditor(render, glossaryId, options = {}) {
  if (
    state.screen === "glossaryEditor"
    && state.glossaryEditor?.glossaryId
    && state.glossaryEditor.glossaryId !== glossaryId
  ) {
    await syncAndStopGlossaryBackgroundSyncSession(render);
  }

  state.selectedGlossaryId = glossaryId;
  state.screen = "glossaryEditor";
  primeSelectedGlossaryEditorLoadingState({
    glossaryId,
    navigationSource: options.navigationSource ?? null,
    preferredGlossary: options.preferredGlossary ?? null,
  });
  const team = selectedTeam();
  const glossary = resolveGlossaryForEditor(glossaryId, options.preferredGlossary ?? null);
  const expectedContext = glossaryEditorContext(team, glossary, {
    navigationSource: state.glossaryEditor?.navigationSource ?? null,
  });
  const cachedPayload =
    Number.isFinite(team?.installationId) && glossary?.repoName
      ? getCachedGlossaryEditorPayload(team, glossary)
      : null;
  if (cachedPayload) {
    maybeApplyGlossaryEditorSnapshot(cachedPayload, expectedContext, null);
  }
  render();
  void refreshCurrentUserTeamAccess({ render }).catch(() => null);
  await loadSelectedGlossaryEditorData(render, {
    glossaryId,
    preferredGlossary: options.preferredGlossary ?? null,
    preserveVisibleData: cachedPayload != null,
  });
  if (
    state.screen === "glossaryEditor"
    && state.glossaryEditor?.glossaryId === glossaryId
    && state.glossaryEditor.status === "ready"
  ) {
    startGlossaryBackgroundSyncSession(render);
  }
}

export function updateGlossaryTermSearchQuery(render, value) {
  state.glossaryEditor = {
    ...state.glossaryEditor,
    searchQuery: value,
  };
  render();
}

export async function deleteGlossaryTerm(render, termId) {
  const team = selectedTeam();
  const repoName = selectedGlossaryRepoName();
  const glossary = selectedGlossary();
  if (!Number.isFinite(team?.installationId) || !repoName || !termId) {
    return;
  }

  if (!canManageGlossaries(team)) {
    showNoticeBadge("You do not have permission to edit glossary terms in this team.", render);
    return;
  }
  if (await ensureGlossaryNotTombstoned(render, team, glossary)) {
    return;
  }

  try {
    await invoke("delete_gtms_glossary_term", {
      input: {
        installationId: team.installationId,
        glossaryId: glossary?.id ?? null,
        repoName,
        termId,
      },
    });
    removeGlossaryEditorQuery(team, glossary);
    const syncIssue = getGlossarySyncIssueMessage(
      await syncSingleGlossaryForTeam(team, selectedGlossary()),
    );
    markGlossaryBackgroundSyncDirty();
    if (syncIssue?.message) {
      showNoticeBadge(syncIssue.message, render);
    }
    await loadSelectedGlossaryEditorData(render);
  } catch (error) {
    showNoticeBadge(error?.message ?? String(error), render);
  }
}
