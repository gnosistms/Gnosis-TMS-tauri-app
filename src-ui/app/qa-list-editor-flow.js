import { requireBrokerSession } from "./auth-flow.js";
import { findIsoLanguageOption } from "../lib/language-options.js";
import { invoke, waitForNextPaint } from "./runtime.js";
import {
  createQaListEditorState,
  state,
} from "./state.js";
import {
  createQaListEditorQueryOptions,
  getCachedQaListEditorPayload,
} from "./qa-list-editor-query.js";
import { activeDefaultQaListIdsForTeam } from "./qa-list-default-flow.js";
import { loadTeamQaLists, primeQaListsLoadingState } from "./qa-list-discovery-flow.js";
import {
  applyQaListEditorPayload,
  normalizeQaList,
  selectedQaList,
} from "./qa-list-shared.js";
import {
  currentQaListTeam,
  selectedQaListTeamMatches,
  syncSingleQaListOrThrow,
  upsertQaListForTeam,
} from "./qa-list-top-level-state.js";
import { qaListRepoDescriptor, teamSupportsQaListRepos } from "./qa-list-repo-flow.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import { queryClient } from "./query-client.js";
import { showNoticeBadge } from "./status-feedback.js";
import { qaListTermWriteIsActive } from "./qa-term-write-coordinator.js";

function selectedQaListEditorMatches(team, qaList) {
  return Boolean(
    selectedQaListTeamMatches(team)
      && qaList?.id
      && state.screen === "qaListEditor"
      && state.selectedQaListId === qaList.id
      && state.qaListEditor?.qaListId === qaList.id,
  );
}

export function resolveQaListForEditor(qaListId = state.selectedQaListId, preferredQaList = null) {
  const selected = selectedQaList();
  if (selected?.repoName) {
    return selected;
  }

  const normalizedPreferred = normalizeQaList(preferredQaList);
  if (normalizedPreferred?.repoName) {
    return normalizedPreferred;
  }

  const editorQaListId = state.qaListEditor?.qaListId ?? null;
  const requestedQaListId = qaListId ?? editorQaListId;
  if (
    requestedQaListId
    && state.qaListEditor?.repoName
    && (editorQaListId === requestedQaListId || state.selectedQaListId == null)
  ) {
    return {
      id: requestedQaListId,
      repoName: state.qaListEditor.repoName,
      repoId: Number.isFinite(state.qaListEditor.repoId) ? state.qaListEditor.repoId : null,
      fullName: state.qaListEditor.fullName ?? "",
      defaultBranchName: state.qaListEditor.defaultBranchName ?? "main",
      defaultBranchHeadOid: state.qaListEditor.defaultBranchHeadOid ?? null,
      title: state.qaListEditor.title,
      language: state.qaListEditor.language,
      lifecycleState: state.qaListEditor.lifecycleState,
      termCount: state.qaListEditor.termCount,
    };
  }

  return null;
}

function qaListEditorContext(team, qaList) {
  return {
    teamId: team?.id ?? null,
    installationId: team?.installationId ?? null,
    qaListId: qaList?.id ?? qaList?.qaListId ?? null,
    repoName: qaList?.repoName ?? "",
    navigationSource: state.qaListEditor?.navigationSource ?? null,
  };
}

export function qaListEditorContextMatches(expectedContext) {
  const team = currentQaListTeam();
  return Boolean(
    state.screen === "qaListEditor"
      && team?.id === expectedContext?.teamId
      && team?.installationId === expectedContext?.installationId
      && state.selectedQaListId === expectedContext?.qaListId
      && state.qaListEditor?.qaListId === expectedContext?.qaListId
      && state.qaListEditor?.repoName === expectedContext?.repoName,
  );
}

export function qaListEditorPayloadMatches(payload, expectedContext) {
  return Boolean(
    (payload?.qaListId === expectedContext?.qaListId || payload?.id === expectedContext?.qaListId)
      && (!payload?.repoName || payload.repoName === expectedContext?.repoName),
  );
}

export function qaListEditorHasOpenDraft() {
  return state.qaTermEditor?.isOpen === true;
}

export function qaListEditorHasActiveTermWrite() {
  return qaListTermWriteIsActive();
}

export function qaListEditorHasActiveBackgroundSync() {
  return false;
}

export function qaListEditorHasPendingLocalTerms() {
  return (state.qaListEditor?.terms ?? []).some((term) =>
    term?.pendingMutation === "save"
      || term?.pendingMutation === "create"
      || Boolean(term?.optimisticClientId)
      || Boolean(term?.pendingError),
  );
}

export function canApplyQaListEditorSnapshot(expectedContext) {
  if (!qaListEditorContextMatches(expectedContext)) {
    return { canApply: false, reason: "stale-context" };
  }
  if (qaListEditorHasOpenDraft()) {
    return { canApply: false, reason: "open-draft" };
  }
  if (qaListEditorHasActiveTermWrite()) {
    return { canApply: false, reason: "active-write" };
  }
  if (qaListEditorHasActiveBackgroundSync()) {
    return { canApply: false, reason: "active-background-sync" };
  }
  if (qaListEditorHasPendingLocalTerms()) {
    return { canApply: false, reason: "pending-local-terms" };
  }
  return { canApply: true, reason: "ready" };
}

export function maybeApplyQaListEditorSnapshot(payload, expectedContext, render, options = {}) {
  if (!qaListEditorContextMatches(expectedContext)) {
    return { applied: false, reason: "stale-context" };
  }
  if (!qaListEditorPayloadMatches(payload, expectedContext)) {
    return { applied: false, reason: "payload-mismatch" };
  }

  const decision = canApplyQaListEditorSnapshot(expectedContext);
  if (!decision.canApply) {
    if (options.showDeferredNotice === true) {
      showNoticeBadge(
        "QA list refreshed. Finish the current edit to update the term list.",
        render,
        2400,
      );
    }
    return { applied: false, reason: decision.reason };
  }

  applyQaListEditorPayload(payload);
  render?.();
  return { applied: true, reason: "applied" };
}

async function loadRepoBackedQaListEditorSnapshot(team, qaList) {
  const queryOptions = createQaListEditorQueryOptions(team, qaList);
  await queryClient.invalidateQueries({ queryKey: queryOptions.queryKey, exact: true });
  const response = await queryClient.fetchQuery(queryOptions);
  return normalizeQaList({ ...qaList, ...response });
}

async function loadQaListEditorPayloadFromDisk(team, qaList) {
  const queryOptions = createQaListEditorQueryOptions(team, qaList);
  await queryClient.invalidateQueries({ queryKey: queryOptions.queryKey, exact: true });
  return queryClient.fetchQuery(queryOptions);
}

async function syncQaListEditorRepoThenRefresh(render, team, qaList, expectedContext) {
  if (!teamSupportsQaListRepos(team) || !qaList?.repoName) {
    return;
  }
  const descriptor = qaListRepoDescriptor(qaList);
  if (!descriptor) {
    return;
  }

  try {
    await invoke("sync_gtms_qa_list_editor_repo", {
      input: {
        installationId: team.installationId,
        ...descriptor,
      },
      sessionToken: requireBrokerSession(),
    });
    const response = await loadQaListEditorPayloadFromDisk(team, qaList);
    maybeApplyQaListEditorSnapshot(response, expectedContext, render, {
      showDeferredNotice: true,
    });
  } catch (error) {
    if (qaListEditorContextMatches(expectedContext)) {
      showNoticeBadge(error?.message ?? String(error), render);
      render?.();
    }
  }
}

export function applyQaListEditorSnapshot(team, qaList, normalized) {
  if (!selectedQaListEditorMatches(team, qaList)) {
    return false;
  }

  applyQaListEditorPayload(normalized);
  upsertQaListForTeam(team, normalized);
  return true;
}

export async function syncAndRefreshQaListEditorSnapshot(team, qaList) {
  await syncSingleQaListOrThrow(team, qaList);
  const normalized = await loadRepoBackedQaListEditorSnapshot(team, qaList);
  applyQaListEditorSnapshot(team, qaList, normalized);
  return normalized;
}

export async function openQaListEditor(render, qaListId, options = {}) {
  state.selectedQaListId = qaListId;
  const qaList =
    resolveQaListForEditor(qaListId, options.preferredQaList ?? null)
    ?? state.qaLists.find((item) => item.id === qaListId);
  if (!qaList) {
    return;
  }

  const team = currentQaListTeam();
  const cachedPayload =
    Number.isFinite(team?.installationId) && qaList?.repoName
      ? getCachedQaListEditorPayload(team, qaList)
      : null;
  applyQaListEditorSummary(qaList, {
    navigationSource: options.navigationSource ?? null,
    status: cachedPayload || !qaList.repoName ? "ready" : "loading",
    terms: cachedPayload ? [] : undefined,
  });
  state.screen = "qaListEditor";
  if (cachedPayload) {
    maybeApplyQaListEditorSnapshot(cachedPayload, qaListEditorContext(team, qaList), null);
  }
  render();
  if (qaList.repoName && options.skipRefresh !== true) {
    await loadSelectedQaListEditorData(render, {
      qaListId,
      preferredQaList: options.preferredQaList ?? null,
      preserveVisibleData: cachedPayload != null,
    });
  }
}

export function resolveDefaultQaListForLanguage(languageCode, team = currentQaListTeam()) {
  const normalizedLanguageCode = String(languageCode ?? "").trim();
  if (!normalizedLanguageCode) {
    return null;
  }

  const defaultQaListId = activeDefaultQaListIdsForTeam(team)[normalizedLanguageCode];
  if (!defaultQaListId) {
    return null;
  }

  return (state.qaLists ?? []).find((qaList) =>
    qaList.id === defaultQaListId
    && qaList.lifecycleState === "active"
    && qaList.language?.code === normalizedLanguageCode
  ) ?? null;
}

export async function openEditorQaList(render, options = {}) {
  const targetLanguageCode = String(
    options.languageCode
    ?? state.editorChapter?.selectedTargetLanguageCode
    ?? "",
  ).trim();
  const team = currentQaListTeam();
  if (!targetLanguageCode || !team) {
    return;
  }

  primeQaListsLoadingState(team.id, { preserveVisibleData: state.qaLists.length > 0 });
  let qaList = resolveDefaultQaListForLanguage(targetLanguageCode, team);
  state.screen = "qaListEditor";
  let openedQaListEditor = false;
  if (qaList) {
    const cachedPayload = getCachedQaListEditorPayload(team, qaList);
    applyQaListEditorSummary(qaList, {
      navigationSource: "editor",
      status: cachedPayload ? "ready" : "loading",
      terms: cachedPayload ? [] : [],
    });
    if (cachedPayload) {
      maybeApplyQaListEditorSnapshot(cachedPayload, qaListEditorContext(team, qaList), null);
    }
    openedQaListEditor = true;
  } else {
    state.selectedQaListId = null;
    state.qaListEditor = {
      ...createQaListEditorState(),
      status: "loading",
      navigationSource: "editor",
      title: "QA List",
      language: findIsoLanguageOption(targetLanguageCode),
    };
  }
  render();

  if (!qaList) {
    await loadTeamQaLists(render, team.id);
    qaList = resolveDefaultQaListForLanguage(targetLanguageCode, team);
  }

  if (!qaList) {
    state.screen = "qa";
    render();
    return;
  }

  if (!openedQaListEditor) {
    const cachedPayload = getCachedQaListEditorPayload(team, qaList);
    applyQaListEditorSummary(qaList, {
      navigationSource: "editor",
      status: cachedPayload ? "ready" : "loading",
      terms: cachedPayload ? [] : [],
    });
    state.screen = "qaListEditor";
    if (cachedPayload) {
      maybeApplyQaListEditorSnapshot(cachedPayload, qaListEditorContext(team, qaList), null);
    }
    render();
  }
  await loadSelectedQaListEditorData(render);
}

function applyQaListEditorSummary(qaList, options = {}) {
  const searchQuery =
    options.preserveSearchQuery === true ? (state.qaListEditor?.searchQuery ?? "") : "";
  state.selectedQaListId = qaList.id;
  state.qaListEditor = {
    ...createQaListEditorState(),
    status: options.status ?? "ready",
    error: "",
    navigationSource: options.navigationSource ?? state.qaListEditor?.navigationSource ?? null,
    qaListId: qaList.id,
    title: qaList.title,
    lifecycleState: qaList.lifecycleState,
    language: qaList.language,
    termCount: qaList.termCount,
    repoName: qaList.repoName,
    fullName: qaList.fullName,
    repoId: qaList.repoId,
    defaultBranchName: qaList.defaultBranchName,
    defaultBranchHeadOid: qaList.defaultBranchHeadOid,
    searchQuery,
    terms: Array.isArray(options.terms) ? options.terms : (qaList.terms ?? []),
  };
}

export function primeSelectedQaListEditorLoadingState(options = {}) {
  const qaListId = options.qaListId ?? state.selectedQaListId;
  const qaList = resolveQaListForEditor(qaListId, options.preferredQaList ?? null);
  const preservedSearchQuery = state.qaListEditor?.searchQuery ?? "";
  if (qaList) {
    applyQaListEditorSummary(qaList, {
      navigationSource: options.navigationSource ?? state.qaListEditor?.navigationSource ?? null,
      status: "loading",
      terms: [],
      preserveSearchQuery: true,
    });
    return;
  }

  state.qaListEditor = {
    ...createQaListEditorState(),
    status: "error",
    error: "Could not find this QA list.",
    navigationSource: options.navigationSource ?? state.qaListEditor?.navigationSource ?? null,
    searchQuery: preservedSearchQuery,
  };
}

export async function loadSelectedQaListEditorData(render, options = {}) {
  const preserveVisibleData = options.preserveVisibleData === true;
  const qaListId = options.qaListId ?? state.selectedQaListId ?? state.qaListEditor?.qaListId ?? null;
  const qaList = resolveQaListForEditor(qaListId, options.preferredQaList ?? null);
  if (!qaList) {
    state.qaListEditor = {
      ...createQaListEditorState(),
      status: "error",
      error: "Could not find this QA list.",
    };
    render();
    return;
  }

  const team = currentQaListTeam();
  const expectedContext = qaListEditorContext(team, qaList);
  beginPageSync();
  if (preserveVisibleData && state.qaListEditor?.status === "ready") {
    state.qaListEditor = {
      ...state.qaListEditor,
      error: "",
      qaListId: qaList.id,
      repoName: qaList.repoName,
      repoId: Number.isFinite(qaList.repoId) ? qaList.repoId : null,
      fullName: qaList.fullName ?? state.qaListEditor.fullName ?? "",
      defaultBranchName: qaList.defaultBranchName ?? state.qaListEditor.defaultBranchName ?? "main",
      defaultBranchHeadOid: qaList.defaultBranchHeadOid ?? state.qaListEditor.defaultBranchHeadOid ?? null,
      title: qaList.title,
      language: qaList.language,
      lifecycleState: qaList.lifecycleState,
      termCount: qaList.termCount,
    };
  } else {
    state.qaListEditor = {
      ...state.qaListEditor,
      status: "loading",
      error: "",
      qaListId,
      repoName: qaList.repoName,
      repoId: Number.isFinite(qaList.repoId) ? qaList.repoId : null,
      fullName: qaList.fullName ?? state.qaListEditor.fullName ?? "",
      defaultBranchName: qaList.defaultBranchName ?? state.qaListEditor.defaultBranchName ?? "main",
      defaultBranchHeadOid: qaList.defaultBranchHeadOid ?? state.qaListEditor.defaultBranchHeadOid ?? null,
      title: qaList.title,
      language: qaList.language,
      lifecycleState: qaList.lifecycleState,
      termCount: qaList.termCount,
      terms: [],
    };
  }
  render();
  await waitForNextPaint();

  try {
    if (teamSupportsQaListRepos(team) && qaList.repoName) {
      const response = await loadQaListEditorPayloadFromDisk(team, qaList);
      maybeApplyQaListEditorSnapshot(response, expectedContext, render, {
        showDeferredNotice: true,
      });
      if (qaListEditorContextMatches(expectedContext)) {
        await completePageSync(render);
        await syncQaListEditorRepoThenRefresh(render, team, qaList, expectedContext);
      }
      return;
    }

    if (!selectedQaListEditorMatches(team, qaList)) {
      return;
    }
    state.qaListEditor = {
      ...state.qaListEditor,
      status: "ready",
      qaListId: qaList.id,
      title: qaList.title,
      lifecycleState: qaList.lifecycleState,
      language: qaList.language,
      termCount: qaList.termCount,
      terms: qaList.terms ?? [],
      error: "",
    };
    await completePageSync(render);
  } catch (error) {
    failPageSync();
    if (!selectedQaListEditorMatches(team, qaList)) {
      return;
    }
    state.qaListEditor = {
      ...state.qaListEditor,
      status: "error",
      error: error?.message ?? "Could not load this QA list.",
    };
  }
  render();
}

export function updateQaTermSearchQuery(render, query) {
  state.qaListEditor = {
    ...state.qaListEditor,
    searchQuery: query,
  };
  render();
}

export { selectedQaListEditorMatches };
