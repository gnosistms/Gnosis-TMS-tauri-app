import { saveStoredQaListsForTeam } from "./qa-list-cache.js";
import {
  applyQaListsQuerySnapshotToState,
  createQaListsQuerySnapshot,
  persistQaListsQueryDataForTeam,
  preserveQaListLifecyclePatchesInSnapshot,
  upsertQaListQueryData,
} from "./qa-list-query.js";
import {
  getQaListSyncIssueMessage,
  syncQaListReposForTeam,
  syncSingleQaListForTeam,
  teamSupportsQaListRepos,
} from "./qa-list-repo-flow.js";
import { normalizeQaList, selectedTeam, sortQaLists } from "./qa-list-shared.js";
import { qaListKeys } from "./query-client.js";
import { createRepoResourceTopLevelState } from "./repo-resource/top-level-state.js";

const qaListTopLevelState = createRepoResourceTopLevelState({
  identity: {
    collectionField: "qaLists",
    selectedIdField: "selectedQaListId",
    editorField: "qaListEditor",
    queryKeys: qaListKeys,
  },
  normalizeSummary: normalizeQaList,
  sortSummaries: sortQaLists,
  createQuerySnapshot(appState) {
    return createQaListsQuerySnapshot({
      qaLists: appState.qaLists,
      discovery: appState.qaListDiscovery,
    });
  },
  selectedTeam,
  saveStoredForTeam: saveStoredQaListsForTeam,
  applyQuerySnapshotToState: applyQaListsQuerySnapshotToState,
  persistQueryDataForTeam: persistQaListsQueryDataForTeam,
  preserveLifecyclePatchesInSnapshot: preserveQaListLifecyclePatchesInSnapshot,
  upsertQueryData: upsertQaListQueryData,
  teamSupportsRepos: teamSupportsQaListRepos,
  syncReposForTeam: syncQaListReposForTeam,
});

export function createQaResourceId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function currentQaListTeam() {
  return qaListTopLevelState.currentTeam();
}

export function selectedQaListTeamMatches(team) {
  return qaListTopLevelState.selectedTeamMatches(team);
}

export function qaListSnapshotFromList(qaLists = []) {
  return qaListTopLevelState.snapshotFromList(qaLists);
}

export function applyQaListSnapshotToState(snapshot, options = {}) {
  return qaListTopLevelState.applySnapshotToState(snapshot, options);
}

export function persistQaListsForTeam(team) {
  return qaListTopLevelState.persistForTeam(team);
}

export function removeQaListFromState(qaListId, repoName) {
  return qaListTopLevelState.removeFromState(qaListId, repoName);
}

export function ensureQaListsQueryDataForTeam(team) {
  return qaListTopLevelState.ensureQueryDataForTeam(team);
}

export function applyQaListsQueryDataForTeam(team, queryData, render, options = {}) {
  return qaListTopLevelState.applyQueryDataForTeam(team, queryData, render, options);
}

export function upsertQaListForTeam(team, qaList, render, options = {}) {
  return qaListTopLevelState.upsertForTeam(team, qaList, render, options);
}

export function saveCurrentTeamQaLists() {
  const team = currentQaListTeam();
  if (team) {
    persistQaListsForTeam(team);
  }
}

export function repoBackedQaListInput(team, qaList) {
  return qaListTopLevelState.repoBackedInput(team, qaList);
}

export function repoBackedQaTermRollbackInput(team, qaList, previousHeadSha) {
  return {
    ...repoBackedQaListInput(team, qaList),
    previousHeadSha,
  };
}

export function triggerQaListRepoSync(team, qaListOrRepo) {
  return qaListTopLevelState.triggerRepoSync(team, qaListOrRepo);
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
