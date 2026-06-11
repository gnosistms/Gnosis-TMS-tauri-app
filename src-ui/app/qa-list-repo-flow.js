import { invoke } from "./runtime.js";
import { canManageQaListResources } from "./permissions.js";
import { normalizeQaList, sortQaLists } from "./qa-list-shared.js";
import { state } from "./state.js";
import { loadStoredQaListsForTeam, saveStoredQaListsForTeam } from "./qa-list-cache.js";
import { removeQaListFromState } from "./qa-list-top-level-state.js";
import {
  listLocalQaListMetadataRecords,
  listQaListMetadataRecords,
  upsertQaListMetadataRecord,
} from "./team-metadata-flow.js";
import { createRepoResourceRepoFlow } from "./repo-resource/repo-flow.js";
import { listRemoteQaListsForInstallation } from "./installation-resources-query.js";

function ensureInvoke() {
  if (!invoke) {
    throw new Error("QA list GitHub sync is only available in the desktop app.");
  }
}

function qaListLanguageFields(value) {
  return {
    language: value?.language ?? null,
  };
}

export function teamSupportsQaListRepos(team) {
  return Boolean(invoke)
    && Number.isFinite(team?.installationId)
    && typeof team?.githubOrg === "string"
    && team.githubOrg.trim();
}

export function normalizeRemoteQaListRepo(repo) {
  if (!repo || typeof repo !== "object") {
    return null;
  }

  const name =
    typeof repo.name === "string" && repo.name.trim()
      ? repo.name.trim()
      : null;
  const fullName =
    typeof repo.fullName === "string" && repo.fullName.trim()
      ? repo.fullName.trim()
      : null;
  if (!name || !fullName) {
    return null;
  }

  return {
    qaListId:
      typeof repo.qaListId === "string" && repo.qaListId.trim()
        ? repo.qaListId.trim()
        : typeof repo.id === "string" && repo.id.trim()
          ? repo.id.trim()
          : null,
    repoId: Number.isFinite(repo.repoId) ? repo.repoId : null,
    nodeId:
      typeof repo.nodeId === "string" && repo.nodeId.trim()
        ? repo.nodeId.trim()
        : null,
    name,
    fullName,
    htmlUrl:
      typeof repo.htmlUrl === "string" && repo.htmlUrl.trim()
        ? repo.htmlUrl.trim()
        : "",
    private: repo.private !== false,
    description:
      typeof repo.description === "string" && repo.description.trim()
        ? repo.description.trim()
        : "",
    defaultBranchName:
      typeof repo.defaultBranchName === "string" && repo.defaultBranchName.trim()
        ? repo.defaultBranchName.trim()
        : "main",
    defaultBranchHeadOid:
      typeof repo.defaultBranchHeadOid === "string" && repo.defaultBranchHeadOid.trim()
        ? repo.defaultBranchHeadOid.trim()
        : null,
    lifecycleState:
      typeof repo.lifecycleState === "string" && repo.lifecycleState.trim()
        ? repo.lifecycleState.trim()
        : "",
    recordState:
      typeof repo.recordState === "string" && repo.recordState.trim()
        ? repo.recordState.trim()
        : "",
    remoteState:
      typeof repo.remoteState === "string" && repo.remoteState.trim()
        ? repo.remoteState.trim()
        : "",
  };
}

const qaListRepoFlow = createRepoResourceRepoFlow({
  kind: "qaList",
  collectionField: "qaLists",
  pageField: "qaListsPage",
  resourceIdField: "qaListId",
  repoListPayloadField: "qaLists",
  defaultRepoBaseName: "qa-list",
  createRepoTitlePrefix: "qa-list",
  normalizeSummary: normalizeQaList,
  sortSummaries: sortQaLists,
  loadStoredForTeam: loadStoredQaListsForTeam,
  saveStoredForTeam: saveStoredQaListsForTeam,
  removeFromState: removeQaListFromState,
  teamSupportsRepos: teamSupportsQaListRepos,
  metadataFieldsFromResource: qaListLanguageFields,
  metadataFieldsFromRecord: qaListLanguageFields,
  languageFieldsForMerge: (localQaList, record) => ({
    language: localQaList?.language ?? record.language,
  }),
  resourceHasRequiredMetadata: (qaList) => Boolean(qaList.language),
  listMetadataRecords: listQaListMetadataRecords,
  listLocalMetadataRecords: listLocalQaListMetadataRecords,
  upsertMetadataRecord: upsertQaListMetadataRecord,
  canManageResources: canManageQaListResources,
  ensureRuntime: ensureInvoke,
  listRemoteRepos: (team) => listRemoteQaListsForInstallation(team.installationId),
  commands: {
    sync: "sync_gtms_qa_list_repos",
    listLocal: "list_local_gtms_qa_lists",
    createRemote: "create_gnosis_qa_list_repo",
    prepareLocal: "prepare_local_gtms_qa_list_repo",
    rollbackRemote: "rollback_created_gnosis_qa_list_repo",
    purgeLocal: "purge_local_gtms_qa_list_repo",
  },
  messages: {
    resourceLabel: "QA list",
    resourceLabelLower: "QA list",
    pluralLabelLower: "QA list repos",
    waitForRefresh: "Wait for the current QA list refresh or write to finish.",
    bindingRepaired: "The QA list repo binding was repaired.",
    rebuildingLocal: "Rebuilding the local QA list repo from metadata and GitHub...",
    unknownBrokerError: "Unknown QA list broker error.",
    newRepoMetadataError: "Could not determine the new QA list repo metadata.",
    noAvailableRepoName: "Could not determine an available QA list repo name.",
    createRequiresTeamSupport: true,
  },
  normalizeRemoteRepo: normalizeRemoteQaListRepo,
  buildMetadataRecord(qaList, overrides = {}) {
    return {
      qaListId: qaList.id ?? qaList.qaListId,
      title: qaList.title,
      repoName: qaList.repoName,
      previousRepoNames: qaList.previousRepoNames ?? [],
      githubRepoId: qaList.repoId ?? null,
      githubNodeId: qaList.nodeId ?? null,
      fullName: qaList.fullName ?? null,
      defaultBranch: qaList.defaultBranchName ?? "main",
      lifecycleState: qaList.lifecycleState === "deleted" ? "deleted" : "active",
      remoteState: qaList.remoteState ?? "linked",
      recordState: qaList.recordState ?? "live",
      deletedAt: qaList.deletedAt ?? null,
      language: qaList.language ?? null,
      termCount: Number.isFinite(qaList.termCount) ? qaList.termCount : 0,
      ...overrides,
    };
  },
});

export function qaListRepoDescriptor(qaList) {
  return qaListRepoFlow.repoDescriptor(qaList);
}

export function getQaListSyncIssueMessage(syncSnapshots) {
  return qaListRepoFlow.getSyncIssueMessage(syncSnapshots);
}

export function listLocalQaListsForTeam(team) {
  return qaListRepoFlow.listLocalForTeam(team);
}

export function listRemoteQaListReposForTeam(team) {
  return qaListRepoFlow.listRemoteReposForTeam(team);
}

export function syncQaListReposForTeam(team, remoteRepos) {
  return qaListRepoFlow.syncReposForTeam(team, remoteRepos);
}

export function syncSingleQaListForTeam(team, qaList) {
  return qaListRepoFlow.syncSingleForTeam(team, qaList);
}

export function createRemoteQaListRepoWithName(team, repoName) {
  return qaListRepoFlow.createRemoteRepoWithName(team, repoName);
}

export function createRemoteQaListRepo(team, title) {
  return qaListRepoFlow.createRemoteRepo(team, title);
}

export function prepareLocalQaListRepo(team, repo, qaListId = null) {
  return qaListRepoFlow.prepareLocalRepo(team, repo, qaListId);
}

export function deleteRemoteQaListRepo(team, qaList) {
  return qaListRepoFlow.deleteRemoteRepo(team, qaList);
}

export function loadRepoBackedQaListsForTeam(team, options = {}) {
  return qaListRepoFlow.loadRepoBackedForTeam(team, options);
}

export function ensureQaListNotTombstoned(render, team, qaList) {
  return qaListRepoFlow.ensureNotTombstoned(render, team, qaList);
}

export function repairQaListRepoBinding(render, team, qaListId) {
  return qaListRepoFlow.repairRepoBinding(render, team, qaListId);
}

export function rebuildQaListLocalRepo(render, team, qaListId) {
  return qaListRepoFlow.rebuildLocalRepo(render, team, qaListId);
}
