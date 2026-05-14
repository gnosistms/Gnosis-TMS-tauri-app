import { saveStoredQaListsForTeam } from "./qa-list-cache.js";
import {
  applyQaListsQuerySnapshotToState,
  createQaListsQuerySnapshot,
  persistQaListsQueryDataForTeam,
  preserveQaListLifecyclePatchesInSnapshot,
  upsertQaListQueryData,
} from "./qa-list-query.js";
import { syncSingleQaListForTeam, syncQaListReposForTeam, teamSupportsQaListRepos, getQaListSyncIssueMessage } from "./qa-list-repo-flow.js";
import { qaListKeys, queryClient } from "./query-client.js";
import { normalizeQaList, selectedTeam, sortQaLists } from "./qa-list-shared.js";
import { setResourcePageDataOwner } from "./resource-page-controller.js";
import { state } from "./state.js";
import { teamCacheKey } from "./team-cache.js";

export function createQaResourceId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function currentQaListTeam() {
  return selectedTeam();
}

export function selectedQaListTeamMatches(team) {
  const selected = currentQaListTeam();
  return Boolean(
    team
      && selected
      && selected.id === team.id
      && selected.installationId === team.installationId,
  );
}

export function qaListSnapshotFromList(qaLists = []) {
  const normalized = sortQaLists(
    (Array.isArray(qaLists) ? qaLists : [])
      .map(normalizeQaList)
      .filter(Boolean),
  );
  return {
    items: normalized.filter((qaList) => qaList.lifecycleState !== "deleted"),
    deletedItems: normalized.filter((qaList) => qaList.lifecycleState === "deleted"),
  };
}

export function applyQaListSnapshotToState(
  snapshot,
  {
    teamId = state.selectedTeamId,
    fallbackToFirstActive = true,
    cacheKey,
    cacheUpdatedAt = null,
  } = {},
) {
  if (state.selectedTeamId !== teamId) {
    return;
  }

  const nextQaLists = sortQaLists([
    ...(Array.isArray(snapshot?.items) ? snapshot.items : []),
    ...(Array.isArray(snapshot?.deletedItems) ? snapshot.deletedItems : []),
  ]);
  const normalizedQaLists = nextQaLists
    .map(normalizeQaList)
    .filter(Boolean);
  state.qaLists = normalizedQaLists;
  const team = state.teams.find((item) => item?.id === teamId);
  setResourcePageDataOwner(state.qaListsPage, {
    teamId,
    cacheKey: cacheKey ?? teamCacheKey(team),
    cacheUpdatedAt,
  });
  if (
    fallbackToFirstActive
    && !normalizedQaLists.some(
      (qaList) => qaList.lifecycleState !== "deleted" && qaList.id === state.selectedQaListId,
    )
  ) {
    state.selectedQaListId =
      normalizedQaLists.find((qaList) => qaList.lifecycleState !== "deleted")?.id ?? null;
  }
  if (!normalizedQaLists.some((qaList) => qaList.lifecycleState === "deleted")) {
    state.showDeletedQaLists = false;
  }
}

export function persistQaListsForTeam(team) {
  saveStoredQaListsForTeam(team, state.qaLists);
}

export function removeQaListFromState(qaListId, repoName) {
  state.qaLists = (Array.isArray(state.qaLists) ? state.qaLists : []).filter((qaList) =>
    qaList?.id !== qaListId && qaList?.repoName !== repoName
  );
  if (state.selectedQaListId === qaListId) {
    state.selectedQaListId = null;
  }
  if (state.qaListEditor?.qaListId === qaListId || state.qaListEditor?.repoName === repoName) {
    state.qaListEditor = {
      ...state.qaListEditor,
      qaListId: null,
      repoName: "",
      status: "idle",
      error: "",
      terms: [],
    };
  }
}

export function ensureQaListsQueryDataForTeam(team) {
  if (!team?.id) {
    return null;
  }
  const queryKey = qaListKeys.byTeam(team.id);
  let queryData = queryClient.getQueryData(queryKey);
  if (!queryData) {
    queryData = createQaListsQuerySnapshot({
      qaLists: state.qaLists,
      discovery: state.qaListDiscovery,
    });
    queryClient.setQueryData(queryKey, queryData);
  }
  return queryData;
}

export function applyQaListsQueryDataForTeam(team, queryData, render, { isFetching = false } = {}) {
  if (!team?.id || !queryData) {
    return null;
  }
  const queryKey = qaListKeys.byTeam(team.id);
  const reconciledQueryData = preserveQaListLifecyclePatchesInSnapshot(
    queryData,
    queryClient.getQueryData(queryKey),
  );
  queryClient.setQueryData(queryKey, reconciledQueryData);
  applyQaListsQuerySnapshotToState(reconciledQueryData, {
    teamId: team.id,
    isFetching,
  });
  persistQaListsQueryDataForTeam(team, reconciledQueryData);
  render?.();
  return reconciledQueryData;
}

export function upsertQaListForTeam(team, qaList, render, options = {}) {
  const currentQueryData = ensureQaListsQueryDataForTeam(team);
  const existingQaLists = Array.isArray(currentQueryData?.qaLists) ? currentQueryData.qaLists : [];
  const shouldPreserveCreate =
    options.preserveCreate === true
    && !existingQaLists.some((item) => item?.id === qaList?.id);
  const nextQueryData = upsertQaListQueryData(currentQueryData, {
    ...qaList,
    ...(shouldPreserveCreate
      ? {
          localLifecycleIntent: "create",
          pendingMutation: null,
        }
      : {}),
  });
  return applyQaListsQueryDataForTeam(team, nextQueryData, render);
}

export function saveCurrentTeamQaLists() {
  const team = currentQaListTeam();
  if (team) {
    persistQaListsForTeam(team);
  }
}

export function repoBackedQaListInput(team, qaList) {
  return {
    installationId: team.installationId,
    repoName: qaList.repoName,
    qaListId: qaList.id,
  };
}

export function repoBackedQaTermRollbackInput(team, qaList, previousHeadSha) {
  return {
    ...repoBackedQaListInput(team, qaList),
    previousHeadSha,
  };
}

export function triggerQaListRepoSync(team, qaListOrRepo) {
  if (!teamSupportsQaListRepos(team)) {
    return;
  }

  const repo = qaListOrRepo?.fullName
    ? {
        qaListId: qaListOrRepo.id ?? qaListOrRepo.qaListId ?? null,
        name: qaListOrRepo.repoName ?? qaListOrRepo.name,
        fullName: qaListOrRepo.fullName,
        repoId: Number.isFinite(qaListOrRepo.repoId) ? qaListOrRepo.repoId : null,
        defaultBranchName: qaListOrRepo.defaultBranchName || "main",
        defaultBranchHeadOid: qaListOrRepo.defaultBranchHeadOid || null,
      }
    : null;
  if (!repo?.name || !repo.fullName) {
    return;
  }

  void syncQaListReposForTeam(team, [repo]).catch(() => null);
}

export async function syncSingleQaListOrThrow(team, qaList) {
  const syncIssue = getQaListSyncIssueMessage(await syncSingleQaListForTeam(team, qaList));
  if (syncIssue.message) {
    throw new Error(syncIssue.message);
  }
}

export function qaListCreationRollbackMessage(error, rollbackError) {
  return `${error?.message ?? String(error)} Automatic QA list create rollback also failed: ${
    rollbackError?.message ?? String(rollbackError)
  }`;
}
