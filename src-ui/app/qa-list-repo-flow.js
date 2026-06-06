import { requireBrokerSession } from "./auth-flow.js";
import { appendRepoNameSuffix, slugifyRepoName } from "./repo-names.js";
import { invoke } from "./runtime.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import { normalizeQaList, sortQaLists } from "./qa-list-shared.js";
import { state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import {
  inspectAndMigrateLocalRepoBindings,
  listLocalQaListMetadataRecords,
  listQaListMetadataRecords,
  lookupLocalMetadataTombstone,
  repairAutoRepairableRepoBindings,
  repairLocalRepoBinding,
  upsertQaListMetadataRecord,
} from "./team-metadata-flow.js";
import {
  clearRestoredLocalHardDeleteTombstones,
  filterLocalHardDeletedResources,
  isLocalHardDeletedResource,
} from "./local-hard-delete-store.js";
import { isSoftDeletedResource } from "./resource-write-policy.js";
import { loadStoredQaListsForTeam, saveStoredQaListsForTeam } from "./qa-list-cache.js";
import { removeQaListFromState } from "./qa-list-top-level-state.js";
import { areResourcePageWritesDisabled } from "./resource-page-controller.js";
import { ensureResourceNotTombstoned } from "./resource-lifecycle-engine.js";
import {
  filterKnownDeletedRepoResources,
  isDeletedRepoResource,
  repoResourcesMatch,
  repoTransportLifecycleFields,
} from "./repo-transport-eligibility.js";

function ensureInvoke() {
  if (!invoke) {
    throw new Error("QA list GitHub sync is only available in the desktop app.");
  }
}

function normalizeQaListBrokerError(error) {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error ?? "Unknown QA list broker error."));
}

function createQaListRepairIssueMaps(repairIssues = []) {
  const byResourceId = new Map();
  const byRepoName = new Map();

  for (const issue of Array.isArray(repairIssues) ? repairIssues : []) {
    if (issue?.kind !== "qaList") {
      continue;
    }
    if (typeof issue.resourceId === "string" && issue.resourceId.trim()) {
      byResourceId.set(issue.resourceId, issue);
    }
    if (typeof issue.repoName === "string" && issue.repoName.trim()) {
      byRepoName.set(issue.repoName, issue);
    }
    if (typeof issue.expectedRepoName === "string" && issue.expectedRepoName.trim()) {
      byRepoName.set(issue.expectedRepoName, issue);
    }
  }

  return { byResourceId, byRepoName };
}

function matchingQaListRepairIssue(qaList, repairIssueMaps) {
  if (!qaList || !repairIssueMaps) {
    return null;
  }
  if (repairIssueMaps.byResourceId.has(qaList.id)) {
    return repairIssueMaps.byResourceId.get(qaList.id);
  }
  if (repairIssueMaps.byRepoName.has(qaList.repoName)) {
    return repairIssueMaps.byRepoName.get(qaList.repoName);
  }
  return null;
}

function supportsUnmatchedLocalQaList(qaList, repairIssueMaps) {
  const repairIssue = matchingQaListRepairIssue(qaList, repairIssueMaps);
  return repairIssue?.issueType === "strayLocalRepo";
}

async function repairQaListMetadataFromRemoteRename(team, metadataRecords, remoteRepos) {
  const remoteByRepoId = new Map(
    (Array.isArray(remoteRepos) ? remoteRepos : [])
      .filter((repo) => Number.isFinite(repo?.repoId))
      .map((repo) => [repo.repoId, repo]),
  );
  const remoteByNodeId = new Map(
    (Array.isArray(remoteRepos) ? remoteRepos : [])
      .filter((repo) => typeof repo?.nodeId === "string" && repo.nodeId.trim())
      .map((repo) => [repo.nodeId, repo]),
  );
  const repairWrites = [];

  for (const record of Array.isArray(metadataRecords) ? metadataRecords : []) {
    if (record?.recordState !== "live" || record?.remoteState !== "linked") {
      continue;
    }

    const remoteRepo =
      (Number.isFinite(record?.githubRepoId) ? remoteByRepoId.get(record.githubRepoId) : null)
      ?? ((typeof record?.githubNodeId === "string" && record.githubNodeId.trim()) ? remoteByNodeId.get(record.githubNodeId) : null)
      ?? null;
    if (!remoteRepo) {
      continue;
    }

    const repoNameChanged = typeof remoteRepo.name === "string" && remoteRepo.name.trim() && remoteRepo.name !== record.repoName;
    const fullNameChanged = typeof remoteRepo.fullName === "string" && remoteRepo.fullName.trim() && remoteRepo.fullName !== record.fullName;
    const branchChanged = typeof remoteRepo.defaultBranchName === "string" && remoteRepo.defaultBranchName.trim() && remoteRepo.defaultBranchName !== record.defaultBranch;
    if (!repoNameChanged && !fullNameChanged && !branchChanged) {
      continue;
    }

    const previousRepoNames = [
      ...(Array.isArray(record.previousRepoNames) ? record.previousRepoNames : []),
      ...(repoNameChanged ? [record.repoName] : []),
    ];
    repairWrites.push(
      upsertQaListMetadataRecord(team, {
        qaListId: record.id,
        title: record.title,
        repoName: remoteRepo.name ?? record.repoName,
        previousRepoNames,
        githubRepoId: remoteRepo.repoId ?? record.githubRepoId ?? null,
        githubNodeId: remoteRepo.nodeId ?? record.githubNodeId ?? null,
        fullName: remoteRepo.fullName ?? record.fullName ?? null,
        defaultBranch: remoteRepo.defaultBranchName ?? record.defaultBranch ?? "main",
        lifecycleState: record.lifecycleState,
        remoteState: record.remoteState,
        recordState: record.recordState,
        deletedAt: record.deletedAt ?? null,
        language: record.language ?? null,
        termCount: Number.isFinite(record.termCount) ? record.termCount : 0,
      }).catch(() => null),
    );
  }

  if (repairWrites.length > 0) {
    await Promise.all(repairWrites);
    return true;
  }

  return false;
}

async function finalizeMissingQaListsForTeam(team, metadataRecords, remoteRepos) {
  const missingRecords = findConfirmedMissingQaListRecords(metadataRecords, remoteRepos);
  if (!Number.isFinite(team?.installationId) || missingRecords.length === 0) {
    return metadataRecords;
  }

  const deletedAt = new Date().toISOString();

  for (const record of missingRecords) {
    await upsertQaListMetadataRecord(team, {
      qaListId: record.id,
      title: record.title,
      repoName: record.repoName,
      previousRepoNames: Array.isArray(record.previousRepoNames) ? record.previousRepoNames : [],
      githubRepoId: Number.isFinite(record.githubRepoId) ? record.githubRepoId : null,
      githubNodeId:
        typeof record.githubNodeId === "string" && record.githubNodeId.trim()
          ? record.githubNodeId.trim()
          : null,
      fullName:
        typeof record.fullName === "string" && record.fullName.trim()
          ? record.fullName.trim()
          : null,
      defaultBranch:
        typeof record.defaultBranch === "string" && record.defaultBranch.trim()
          ? record.defaultBranch.trim()
          : "main",
      lifecycleState: "deleted",
      remoteState: "deleted",
      recordState: "tombstone",
      deletedAt,
      language: record.language ?? null,
      termCount: Number.isFinite(record.termCount) ? record.termCount : 0,
    }, { requirePushSuccess: true });

    try {
      await purgeLocalQaListRepo(team, record.id, record.repoName);
    } catch {}
  }

  return listQaListMetadataRecords(team).catch(() => metadataRecords);
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

export function qaListRepoDescriptor(qaList) {
  if (!qaList?.repoName || !qaList?.fullName) {
    return null;
  }

  return {
    qaListId: qaList.id ?? qaList.qaListId ?? null,
    repoName: qaList.repoName,
    fullName: qaList.fullName,
    repoId: Number.isFinite(qaList.repoId) ? qaList.repoId : null,
    defaultBranchName: qaList.defaultBranchName || "main",
    defaultBranchHeadOid: qaList.defaultBranchHeadOid || null,
    ...repoTransportLifecycleFields(qaList),
  };
}

function qaListRepoSyncDescriptor(repo) {
  return {
    qaListId:
      typeof repo?.qaListId === "string" && repo.qaListId.trim()
        ? repo.qaListId.trim()
        : typeof repo?.id === "string" && repo.id.trim()
          ? repo.id.trim()
          : null,
    repoName: repo.name,
    fullName: repo.fullName,
    repoId: Number.isFinite(repo.repoId) ? repo.repoId : null,
    defaultBranchName: repo.defaultBranchName || "main",
    defaultBranchHeadOid: repo.defaultBranchHeadOid || null,
    ...repoTransportLifecycleFields(repo),
  };
}

function findMatchingRemoteQaList(
  record,
  remoteByRepoName,
  remoteByFullName,
  remoteByRepoId,
  remoteByNodeId,
) {
  if (Number.isFinite(record?.githubRepoId) && remoteByRepoId.has(record.githubRepoId)) {
    return remoteByRepoId.get(record.githubRepoId);
  }

  if (record?.githubNodeId && remoteByNodeId.has(record.githubNodeId)) {
    return remoteByNodeId.get(record.githubNodeId);
  }

  if (record?.fullName && remoteByFullName.has(record.fullName)) {
    return remoteByFullName.get(record.fullName);
  }

  const repoNames = [
    record?.repoName,
    ...(Array.isArray(record?.previousRepoNames) ? record.previousRepoNames : []),
  ];
  for (const repoName of repoNames) {
    if (!repoName) {
      continue;
    }
    const match = remoteByRepoName.get(repoName);
    if (match) {
      return match;
    }
  }

  return null;
}

function findConfirmedMissingQaListRecords(metadataRecords = [], remoteRepos = []) {
  const normalizedRemotes = (Array.isArray(remoteRepos) ? remoteRepos : [])
    .map(normalizeRemoteQaListRepo)
    .filter(Boolean);
  const remoteByRepoId = new Map(
    normalizedRemotes
      .filter((repo) => Number.isFinite(repo.repoId))
      .map((repo) => [repo.repoId, repo]),
  );
  const remoteByNodeId = new Map(
    normalizedRemotes
      .filter((repo) => typeof repo.nodeId === "string" && repo.nodeId.trim())
      .map((repo) => [repo.nodeId, repo]),
  );
  const remoteByRepoName = new Map(normalizedRemotes.map((repo) => [repo.name, repo]));
  const remoteByFullName = new Map(normalizedRemotes.map((repo) => [repo.fullName, repo]));

  return (Array.isArray(metadataRecords) ? metadataRecords : []).filter((record) =>
    record?.recordState === "live"
    && (record?.remoteState ?? "linked") === "linked"
    && !findMatchingRemoteQaList(
      record,
      remoteByRepoName,
      remoteByFullName,
      remoteByRepoId,
      remoteByNodeId,
    )
  );
}

function qaListMetadataRecordFromSummary(qaList, remote = null) {
  return {
    qaListId: qaList.id ?? qaList.qaListId,
    title: qaList.title,
    repoName: qaList.repoName,
    previousRepoNames: qaList.previousRepoNames ?? [],
    githubRepoId: remote?.repoId ?? qaList.repoId ?? null,
    githubNodeId: remote?.nodeId ?? qaList.nodeId ?? null,
    fullName: remote?.fullName ?? qaList.fullName ?? null,
    defaultBranch: remote?.defaultBranchName ?? qaList.defaultBranchName ?? "main",
    lifecycleState: qaList.lifecycleState === "deleted" ? "deleted" : "active",
    remoteState: qaList.remoteState ?? "linked",
    recordState: qaList.recordState ?? "live",
    deletedAt: qaList.deletedAt ?? null,
    language: qaList.language ?? null,
    termCount: Number.isFinite(qaList.termCount) ? qaList.termCount : 0,
  };
}

async function backfillQaListMetadataRecords(team, localQaLists, remoteRepos, metadataRecords) {
  if (!Number.isFinite(team?.installationId) || state.offline?.isEnabled === true) {
    return metadataRecords;
  }
  const existingIds = new Set((Array.isArray(metadataRecords) ? metadataRecords : []).map((record) => record.id));
  const remoteByName = new Map(
    (Array.isArray(remoteRepos) ? remoteRepos : [])
      .map(normalizeRemoteQaListRepo)
      .filter(Boolean)
      .map((repo) => [repo.name, repo]),
  );
  let wroteRecord = false;
  for (const qaList of (Array.isArray(localQaLists) ? localQaLists : []).map(normalizeQaList).filter(Boolean)) {
    if (!qaList.id || existingIds.has(qaList.id) || !qaList.repoName || !qaList.language) {
      continue;
    }
    try {
      await upsertQaListMetadataRecord(
        team,
        qaListMetadataRecordFromSummary(qaList, remoteByName.get(qaList.repoName) ?? null),
        { requirePushSuccess: true },
      );
      wroteRecord = true;
      existingIds.add(qaList.id);
    } catch (error) {
      console.warn(`Could not backfill QA list metadata: ${error?.message ?? String(error)}`);
    }
  }
  return wroteRecord ? await listQaListMetadataRecords(team) : metadataRecords;
}

export function getQaListSyncIssueMessage(syncSnapshots) {
  const snapshots = Array.isArray(syncSnapshots) ? syncSnapshots : [];
  const failedSnapshot = snapshots.find((snapshot) =>
    snapshot?.status === "syncError"
    || snapshot?.status === "dirtyLocal"
    || snapshot?.status === "updateRequired"
  );
  if (!failedSnapshot) {
    return { message: "", snapshots };
  }

  return {
    message:
      typeof failedSnapshot.message === "string" && failedSnapshot.message.trim()
        ? failedSnapshot.message.trim()
        : `Could not sync QA list repo ${failedSnapshot.repoName ?? ""}.`.trim(),
    snapshots,
  };
}

export async function listLocalQaListsForTeam(team) {
  if (!Number.isFinite(team?.installationId)) {
    return [];
  }
  ensureInvoke();
  return invoke("list_local_gtms_qa_lists", {
    input: {
      installationId: team.installationId,
    },
  });
}

export async function listRemoteQaListReposForTeam(team) {
  if (!teamSupportsQaListRepos(team)) {
    return [];
  }
  ensureInvoke();
  let repos;
  try {
    repos = await invoke("list_gnosis_qa_lists_for_installation", {
      installationId: team.installationId,
      sessionToken: requireBrokerSession(),
    });
  } catch (error) {
    throw normalizeQaListBrokerError(error);
  }

  return (Array.isArray(repos) ? repos : [])
    .map(normalizeRemoteQaListRepo)
    .filter(Boolean);
}

export async function syncQaListReposForTeam(team, remoteRepos) {
  const qaLists = (Array.isArray(remoteRepos) ? remoteRepos : [])
    .map(normalizeRemoteQaListRepo)
    .filter(Boolean);
  if (!teamSupportsQaListRepos(team) || qaLists.length === 0) {
    return [];
  }
  ensureInvoke();
  return invoke("sync_gtms_qa_list_repos", {
    input: {
      installationId: team.installationId,
      qaLists: qaLists.map(qaListRepoSyncDescriptor),
    },
    sessionToken: requireBrokerSession(),
  });
}

export async function syncSingleQaListForTeam(team, qaList) {
  const repo =
    qaList && typeof qaList === "object"
      ? normalizeRemoteQaListRepo({
          name: qaList.repoName ?? qaList.name,
          fullName: qaList.fullName,
          htmlUrl: qaList.htmlUrl,
          private: qaList.private,
          description: qaList.description,
          defaultBranchName: qaList.defaultBranchName,
          defaultBranchHeadOid: qaList.defaultBranchHeadOid,
          repoId: qaList.repoId,
          nodeId: qaList.nodeId,
        })
      : null;

  if (!repo) {
    return [];
  }

  return syncQaListReposForTeam(team, [{
    ...repo,
    qaListId:
      typeof qaList?.id === "string" && qaList.id.trim()
        ? qaList.id.trim()
        : typeof qaList?.qaListId === "string" && qaList.qaListId.trim()
          ? qaList.qaListId.trim()
          : null,
  }]);
}

export async function createRemoteQaListRepoWithName(team, repoName) {
  if (!teamSupportsQaListRepos(team)) {
    return null;
  }
  ensureInvoke();

  const normalizedRepoName = slugifyRepoName(repoName) || "qa-list";
  let createdRepo;
  try {
    createdRepo = await invoke("create_gnosis_qa_list_repo", {
      input: {
        installationId: team.installationId,
        orgLogin: team.githubOrg,
        repoName: normalizedRepoName,
      },
      sessionToken: requireBrokerSession(),
    });
  } catch (error) {
    throw normalizeQaListBrokerError(error);
  }

  const remoteRepo = normalizeRemoteQaListRepo(createdRepo);
  if (!remoteRepo) {
    throw new Error("Could not determine the new QA list repo metadata.");
  }
  return remoteRepo;
}

export async function createRemoteQaListRepo(team, title) {
  if (!teamSupportsQaListRepos(team)) {
    return null;
  }

  const baseRepoName = slugifyRepoName(`qa-list-${title}`) || "qa-list";
  const usedRepoNames = new Set(
    (state.qaLists ?? [])
      .map((qaList) => String(qaList.repoName ?? "").trim())
      .filter(Boolean),
  );

  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const repoName = appendRepoNameSuffix(baseRepoName, attempt);
    if (usedRepoNames.has(repoName)) {
      continue;
    }

    try {
      return await createRemoteQaListRepoWithName(team, repoName);
    } catch (error) {
      const message = String(error?.message ?? error ?? "").toLowerCase();
      if (!message.includes("name already exists on this account")) {
        throw error;
      }
    }
  }

  throw new Error("Could not determine an available QA list repo name.");
}

export async function prepareLocalQaListRepo(team, repo, qaListId = null) {
  if (!Number.isFinite(team?.installationId) || !repo?.name) {
    return;
  }
  ensureInvoke();
  await invoke("prepare_local_gtms_qa_list_repo", {
    input: {
      installationId: team.installationId,
      qaListId,
      repoName: repo.name,
      remoteUrl: repo.fullName ? `https://github.com/${repo.fullName}.git` : null,
      defaultBranchName: repo.defaultBranchName || "main",
    },
  });
}

export async function deleteRemoteQaListRepo(team, qaList) {
  if (!teamSupportsQaListRepos(team) || !qaList?.repoName) {
    return;
  }
  ensureInvoke();
  await invoke("rollback_created_gnosis_qa_list_repo", {
    input: {
      installationId: team.installationId,
      orgLogin: team.githubOrg,
      repoName: qaList.repoName,
    },
    sessionToken: requireBrokerSession(),
  });
}

function mergeQaListRepoMetadata(localQaLists, remoteRepos) {
  const remoteByName = new Map(
    (Array.isArray(remoteRepos) ? remoteRepos : [])
      .map(normalizeRemoteQaListRepo)
      .filter(Boolean)
      .map((repo) => [repo.name, repo]),
  );

  return sortQaLists(
    (Array.isArray(localQaLists) ? localQaLists : [])
      .map((qaList) => {
        const remote = remoteByName.get(qaList.repoName);
        return normalizeQaList({
          ...qaList,
          repoId: remote?.repoId ?? qaList.repoId ?? null,
          nodeId: remote?.nodeId ?? qaList.nodeId ?? null,
          fullName: remote?.fullName ?? qaList.fullName ?? null,
          htmlUrl: remote?.htmlUrl ?? qaList.htmlUrl ?? "",
          defaultBranchName: remote?.defaultBranchName ?? qaList.defaultBranchName ?? "main",
          defaultBranchHeadOid: remote?.defaultBranchHeadOid ?? qaList.defaultBranchHeadOid ?? null,
        });
      })
      .filter(Boolean),
  );
}

function mergeMetadataBackedQaLists(localQaLists, metadataRecords, remoteRepos, options = {}) {
  const metadataLoaded = options.metadataLoaded === true;
  const repairLoaded = options.repairLoaded === true;
  const repairIssueMaps = createQaListRepairIssueMaps(options.repairIssues);
  const normalizedLocals = (Array.isArray(localQaLists) ? localQaLists : [])
    .map(normalizeQaList)
    .filter(Boolean);
  const normalizedRemotes = (Array.isArray(remoteRepos) ? remoteRepos : [])
    .map(normalizeRemoteQaListRepo)
    .filter(Boolean);
  const remoteByRepoId = new Map(
    normalizedRemotes
      .filter((repo) => Number.isFinite(repo.repoId))
      .map((repo) => [repo.repoId, repo]),
  );
  const remoteByNodeId = new Map(
    normalizedRemotes
      .filter((repo) => typeof repo.nodeId === "string" && repo.nodeId.trim())
      .map((repo) => [repo.nodeId, repo]),
  );
  const remoteByName = new Map(normalizedRemotes.map((repo) => [repo.name, repo]));
  const remoteByFullName = new Map(normalizedRemotes.map((repo) => [repo.fullName, repo]));
  const localById = new Map(normalizedLocals.map((qaList) => [qaList.id, qaList]));
  const localByRepoName = new Map(normalizedLocals.map((qaList) => [qaList.repoName, qaList]));
  const matchedLocalIds = new Set();
  const matchedLocalRepoNames = new Set();
  const merged = [];

  for (const record of Array.isArray(metadataRecords) ? metadataRecords : []) {
    if (record?.recordState !== "live" && record?.recordState !== "tombstone") {
      continue;
    }
    if (record?.recordState === "tombstone") {
      if (typeof record?.id === "string" && record.id.trim()) {
        matchedLocalIds.add(record.id);
      }
      if (typeof record?.repoName === "string" && record.repoName.trim()) {
        matchedLocalRepoNames.add(record.repoName);
      }
      continue;
    }
    const localQaList = localById.get(record.id) ?? localByRepoName.get(record.repoName) ?? null;
    const remoteQaList = findMatchingRemoteQaList(
      record,
      remoteByName,
      remoteByFullName,
      remoteByRepoId,
      remoteByNodeId,
    );
    if (localQaList) {
      matchedLocalIds.add(localQaList.id);
      matchedLocalRepoNames.add(localQaList.repoName);
    }
    const repairIssue = matchingQaListRepairIssue({ id: record.id, repoName: record.repoName }, repairIssueMaps);
    merged.push(normalizeQaList({
      ...localQaList,
      id: record.id,
      qaListId: record.id,
      title: record.title,
      repoName: record.repoName,
      lifecycleState: record.lifecycleState,
      remoteState: record.remoteState,
      recordState: record.recordState,
      resolutionState: repairIssue ? "repair" : "",
      repairIssueType: repairIssue?.issueType ?? "",
      repairIssueMessage: repairIssue?.message ?? "",
      deletedAt: record.deletedAt,
      language: localQaList?.language ?? record.language,
      termCount: localQaList?.termCount ?? record.termCount ?? 0,
      repoId: remoteQaList?.repoId ?? record.githubRepoId ?? localQaList?.repoId ?? null,
      nodeId: remoteQaList?.nodeId ?? record.githubNodeId ?? localQaList?.nodeId ?? null,
      fullName: remoteQaList?.fullName ?? record.fullName ?? localQaList?.fullName ?? null,
      htmlUrl: remoteQaList?.htmlUrl ?? localQaList?.htmlUrl ?? "",
      defaultBranchName:
        remoteQaList?.defaultBranchName
        ?? record.defaultBranch
        ?? localQaList?.defaultBranchName
        ?? "main",
      defaultBranchHeadOid:
        remoteQaList?.defaultBranchHeadOid
        ?? localQaList?.defaultBranchHeadOid
        ?? null,
    }));
  }

  for (const qaList of normalizedLocals) {
    if (matchedLocalIds.has(qaList.id) || matchedLocalRepoNames.has(qaList.repoName)) {
      continue;
    }
    if (qaList?.recordState === "tombstone") {
      continue;
    }
    const repairIssue = matchingQaListRepairIssue(qaList, repairIssueMaps);
    if (metadataLoaded && repairLoaded && !supportsUnmatchedLocalQaList(qaList, repairIssueMaps)) {
      continue;
    }
    merged.push(normalizeQaList({
      ...qaList,
      resolutionState:
        repairIssue
          ? "repair"
          : metadataLoaded
            && qaList.recordState !== "tombstone"
              ? "unregisteredLocal"
              : qaList.resolutionState ?? "",
      repairIssueType: repairIssue?.issueType ?? "",
      repairIssueMessage: repairIssue?.message ?? "",
    }));
  }

  return sortQaLists(merged.filter(Boolean));
}

function applyLocalQaListHardDeleteState(team, qaLists) {
  const items = Array.isArray(qaLists) ? qaLists : [];
  clearRestoredLocalHardDeleteTombstones(team, "qaList", items, {
    isActive: (qaList) => !isSoftDeletedResource(qaList, "qaList"),
  });
  return filterLocalHardDeletedResources(team, "qaList", items, {
    isDeleted: (qaList) => isSoftDeletedResource(qaList, "qaList"),
  });
}

function countRecoverableQaListMetadataRecords(records) {
  return (Array.isArray(records) ? records : []).filter((record) =>
    record?.recordState === "live"
    && record?.remoteState === "linked"
    && record?.lifecycleState === "active"
  ).length;
}

function qaListMetadataRecordIsTombstone(record) {
  return record?.recordState === "tombstone" || record?.remoteState === "deleted";
}

function qaListMatchesMetadataRecord(qaList, record) {
  return repoResourcesMatch(qaList, record);
}

function persistVisibleQaLists(team) {
  saveStoredQaListsForTeam(team, state.qaLists);
}

async function purgeLocalQaListRepo(team, qaListId, repoName) {
  if (!Number.isFinite(team?.installationId) || !String(repoName ?? "").trim()) {
    return;
  }

  await invoke("purge_local_gtms_qa_list_repo", {
    input: {
      installationId: team.installationId,
      qaListId,
      repoName,
    },
  });
}

async function purgeTombstonedQaListsForTeam(team, localQaLists, metadataRecords) {
  const normalizedQaLists = (Array.isArray(localQaLists) ? localQaLists : [])
    .map(normalizeQaList)
    .filter(Boolean);
  const tombstoneRecords = (Array.isArray(metadataRecords) ? metadataRecords : []).filter(qaListMetadataRecordIsTombstone);
  if (!Number.isFinite(team?.installationId) || tombstoneRecords.length === 0) {
    return normalizedQaLists;
  }

  let changed = false;
  for (const record of tombstoneRecords) {
    if (typeof record?.repoName === "string" && record.repoName.trim()) {
      try {
        await purgeLocalQaListRepo(team, record.id, record.repoName);
      } catch {}
    }

    for (const qaList of normalizedQaLists) {
      if (!qaListMatchesMetadataRecord(qaList, record)) {
        continue;
      }
      removeQaListFromState(qaList.id, qaList.repoName);
      changed = true;
    }
  }
  if (changed) {
    persistVisibleQaLists(team);
  }

  return listLocalQaListsForTeam(team);
}

async function runQaListRepoPageSync(render, operation) {
  state.qaListsPage.isRefreshing = true;
  beginPageSync();
  render?.();

  try {
    const result = await operation();
    state.qaListsPage.isRefreshing = false;
    await completePageSync(render);
    render?.();
    return result;
  } catch (error) {
    state.qaListsPage.isRefreshing = false;
    failPageSync();
    render?.();
    throw error;
  }
}

function filterDeletedQaListSyncTargets(team, localQaLists, remoteRepos) {
  const deletedRepoNames = new Set(
    (Array.isArray(localQaLists) ? localQaLists : [])
      .map(normalizeQaList)
      .filter((qaList) => qaList?.lifecycleState === "deleted")
      .map((qaList) => qaList.repoName)
      .filter(Boolean),
  );
  return (Array.isArray(remoteRepos) ? remoteRepos : []).filter((repo) =>
    !deletedRepoNames.has(repo?.name)
    && !isLocalHardDeletedResource(team, "qaList", {
      repoName: repo?.name,
      fullName: repo?.fullName,
      repoId: repo?.repoId,
      nodeId: repo?.nodeId,
    })
  );
}

function buildMetadataQaListSyncTargets(team, metadataRecords, remoteRepos) {
  const normalizedRemotes = (Array.isArray(remoteRepos) ? remoteRepos : [])
    .map(normalizeRemoteQaListRepo)
    .filter(Boolean);
  const remoteByRepoId = new Map(
    normalizedRemotes
      .filter((repo) => Number.isFinite(repo.repoId))
      .map((repo) => [repo.repoId, repo]),
  );
  const remoteByNodeId = new Map(
    normalizedRemotes
      .filter((repo) => typeof repo.nodeId === "string" && repo.nodeId.trim())
      .map((repo) => [repo.nodeId, repo]),
  );
  const remoteByName = new Map(normalizedRemotes.map((repo) => [repo.name, repo]));
  const remoteByFullName = new Map(normalizedRemotes.map((repo) => [repo.fullName, repo]));
  return (Array.isArray(metadataRecords) ? metadataRecords : [])
    .filter((record) =>
      record?.recordState === "live"
      && record?.remoteState !== "deleted"
      && record?.remoteState !== "missing"
      && !isDeletedRepoResource(record)
    )
    .map((record) => {
      const remote = findMatchingRemoteQaList(
        record,
        remoteByName,
        remoteByFullName,
        remoteByRepoId,
        remoteByNodeId,
      );
      const fullName = remote?.fullName ?? record.fullName;
      if (!record.repoName || !fullName) {
        return null;
      }
      return {
        qaListId: record.id,
        name: record.repoName,
        fullName,
        repoId: remote?.repoId ?? record.githubRepoId ?? null,
        defaultBranchName: remote?.defaultBranchName ?? record.defaultBranch ?? "main",
        defaultBranchHeadOid: remote?.defaultBranchHeadOid ?? null,
        lifecycleState: record.lifecycleState,
        recordState: record.recordState,
        remoteState: record.remoteState,
      };
    })
    .filter(Boolean);
}

function buildUntrackedRemoteQaListBootstrapTargets(team, metadataRecords, remoteRepos) {
  const trackedRepoNames = new Set();
  const trackedFullNames = new Set();
  for (const record of Array.isArray(metadataRecords) ? metadataRecords : []) {
    if (typeof record?.repoName === "string" && record.repoName.trim()) {
      trackedRepoNames.add(record.repoName.trim().toLowerCase());
    }
    if (typeof record?.fullName === "string" && record.fullName.trim()) {
      trackedFullNames.add(record.fullName.trim().toLowerCase());
    }
    for (const previousRepoName of Array.isArray(record?.previousRepoNames) ? record.previousRepoNames : []) {
      if (typeof previousRepoName === "string" && previousRepoName.trim()) {
        trackedRepoNames.add(previousRepoName.trim().toLowerCase());
      }
    }
  }

  return (Array.isArray(remoteRepos) ? remoteRepos : [])
    .map(normalizeRemoteQaListRepo)
    .filter((repo) =>
      repo
      && !trackedRepoNames.has(String(repo.name ?? "").trim().toLowerCase())
      && !trackedFullNames.has(String(repo.fullName ?? "").trim().toLowerCase())
      && !isLocalHardDeletedResource(team, "qaList", {
        repoName: repo.name,
        fullName: repo.fullName,
        repoId: repo.repoId,
        nodeId: repo.nodeId,
      })
    );
}

async function collectKnownDeletedQaListResources(team, localQaLists = []) {
  const stored = loadStoredQaListsForTeam(team);
  const known = [
    ...(Array.isArray(state.qaLists) ? state.qaLists : []),
    ...(Array.isArray(stored?.qaLists) ? stored.qaLists : []),
    ...(Array.isArray(localQaLists) ? localQaLists : []),
  ];

  try {
    known.push(...await listLocalQaListMetadataRecords(team));
  } catch {}

  return known.filter(isDeletedRepoResource);
}

async function filterKnownDeletedQaListSyncTargets(team, syncTargets, localQaLists = []) {
  const knownDeleted = await collectKnownDeletedQaListResources(team, localQaLists);
  return filterKnownDeletedRepoResources(syncTargets, knownDeleted)
    .filter((repo) => !isLocalHardDeletedResource(team, "qaList", repo));
}

export async function loadRepoBackedQaListsForTeam(team, options = {}) {
  const offlineMode = options.offlineMode === true;
  const suppressRecoveryWarning = options.suppressRecoveryWarning === true;
  const onRecoveryDetected =
    typeof options.onRecoveryDetected === "function"
      ? options.onRecoveryDetected
      : null;
  const emptyResult = {
    qaLists: [],
    remoteRepos: [],
    syncSnapshots: [],
    syncIssue: "",
    brokerWarning: "",
    recoveryMessage: "",
  };
  if (!Number.isFinite(team?.installationId) || (!teamSupportsQaListRepos(team) && !invoke)) {
    return emptyResult;
  }

  let localQaLists = await listLocalQaListsForTeam(team);

  if (offlineMode || !teamSupportsQaListRepos(team)) {
    return {
      qaLists: sortQaLists(
        applyLocalQaListHardDeleteState(team, localQaLists.map(normalizeQaList).filter(Boolean)),
      ),
      remoteRepos: [],
      syncSnapshots: [],
      syncIssue: "",
      brokerWarning: "",
      recoveryMessage: "",
    };
  }

  const remoteRepos = await listRemoteQaListReposForTeam(team);
  let metadataRecords = [];
  let repairIssues = [];
  let metadataLoaded = false;
  let repairLoaded = false;
  let brokerWarning = "";
  try {
    metadataRecords = await listQaListMetadataRecords(team);
    metadataLoaded = true;
    repairIssues = (await inspectAndMigrateLocalRepoBindings(team))?.issues ?? [];
    repairLoaded = true;
    if (repairIssues.length > 0) {
      await repairAutoRepairableRepoBindings(team, repairIssues);
      repairIssues = (await inspectAndMigrateLocalRepoBindings(team).catch(() => null))?.issues ?? repairIssues;
    }
    localQaLists = await purgeTombstonedQaListsForTeam(team, localQaLists, metadataRecords);
    metadataRecords = await backfillQaListMetadataRecords(team, localQaLists, remoteRepos, metadataRecords);
  } catch (error) {
    brokerWarning = error?.message ?? String(error);
  }
  const recoverableMetadataCount = countRecoverableQaListMetadataRecords(metadataRecords);
  const installationRecoveryDetected =
    metadataLoaded
    && recoverableMetadataCount > 0
    && localQaLists.length === 0;
  if (installationRecoveryDetected && !suppressRecoveryWarning) {
    onRecoveryDetected?.("Local installation data was missing. Rebuilding QA list repos from GitHub.");
  }
  let syncTargets = [];
  if (metadataLoaded) {
    const metadataRepaired = await repairQaListMetadataFromRemoteRename(team, metadataRecords, remoteRepos);
    if (metadataRepaired) {
      metadataRecords = await listQaListMetadataRecords(team).catch(() => metadataRecords);
    }
    metadataRecords = await finalizeMissingQaListsForTeam(team, metadataRecords, remoteRepos);
    localQaLists = await purgeTombstonedQaListsForTeam(team, localQaLists, metadataRecords);
    const metadataSyncTargets = buildMetadataQaListSyncTargets(team, metadataRecords, remoteRepos);
    const untrackedRemoteSyncTargets = await filterKnownDeletedQaListSyncTargets(
      team,
      buildUntrackedRemoteQaListBootstrapTargets(team, metadataRecords, remoteRepos),
      localQaLists,
    );
    syncTargets = [...metadataSyncTargets, ...untrackedRemoteSyncTargets];
  } else {
    syncTargets = await filterKnownDeletedQaListSyncTargets(
      team,
      filterDeletedQaListSyncTargets(team, localQaLists, remoteRepos),
      localQaLists,
    );
  }
  const syncSnapshots = syncTargets.length > 0
    ? await syncQaListReposForTeam(team, syncTargets)
    : [];
  localQaLists = await listLocalQaListsForTeam(team);
  const syncIssue = getQaListSyncIssueMessage(syncSnapshots);
  if (metadataLoaded) {
    metadataRecords = await backfillQaListMetadataRecords(team, localQaLists, remoteRepos, metadataRecords);
  }
  const mergedQaLists = metadataLoaded
    ? mergeMetadataBackedQaLists(
        localQaLists,
        metadataRecords,
        remoteRepos,
        { metadataLoaded, repairLoaded, repairIssues },
      )
    : mergeQaListRepoMetadata(localQaLists, remoteRepos);

  return {
    qaLists: applyLocalQaListHardDeleteState(team, mergedQaLists),
    remoteRepos,
    syncSnapshots,
    syncIssue,
    brokerWarning,
    recoveryMessage:
      installationRecoveryDetected && !suppressRecoveryWarning
        ? "Local installation data was missing. Rebuilt QA list repos from GitHub."
        : "",
  };
}

export async function ensureQaListNotTombstoned(render, team, qaList) {
  return ensureResourceNotTombstoned({
    installationId: team?.installationId,
    resource: qaList,
    resourceId: qaList?.id ?? qaList?.qaListId ?? "",
    render,
    resourceLabel: "QA list",
    lookupMetadataTombstone: (resourceId) => lookupLocalMetadataTombstone(team, "qaList", resourceId),
    listMetadataRecords: () => listQaListMetadataRecords(team),
    isTombstoneRecord: qaListMetadataRecordIsTombstone,
    matchesMetadataRecord: qaListMatchesMetadataRecord,
    purgeLocalRepo: () => purgeLocalQaListRepo(team, qaList.id ?? qaList.qaListId ?? null, qaList.repoName),
    removeVisibleResource: () => removeQaListFromState(qaList.id ?? qaList.qaListId ?? null, qaList.repoName),
    persistVisibleState: () => persistVisibleQaLists(team),
  });
}

export async function repairQaListRepoBinding(render, team, qaListId) {
  if (!Number.isFinite(team?.installationId) || typeof qaListId !== "string" || !qaListId.trim()) {
    return;
  }
  if (areResourcePageWritesDisabled(state.qaListsPage)) {
    showNoticeBadge("Wait for the current QA list refresh or write to finish.", render);
    return;
  }

  try {
    await runQaListRepoPageSync(render, async () => {
      await repairLocalRepoBinding(team, "qaList", qaListId);
      const result = await loadRepoBackedQaListsForTeam(team, {
        offlineMode: state.offline?.isEnabled === true,
      });
      state.qaLists = result.qaLists;
    });
    showNoticeBadge("The QA list repo binding was repaired.", render, 2200);
    render();
  } catch (error) {
    showNoticeBadge(error?.message ?? String(error), render, 3200);
    render();
  }
}

export async function rebuildQaListLocalRepo(render, team, qaListId) {
  if (!Number.isFinite(team?.installationId) || typeof qaListId !== "string" || !qaListId.trim()) {
    return;
  }
  if (areResourcePageWritesDisabled(state.qaListsPage)) {
    showNoticeBadge("Wait for the current QA list refresh or write to finish.", render);
    return;
  }

  showNoticeBadge("Rebuilding the local QA list repo from metadata and GitHub...", render, 2200);
  try {
    await runQaListRepoPageSync(render, async () => {
      const result = await loadRepoBackedQaListsForTeam(team, {
        offlineMode: state.offline?.isEnabled === true,
      });
      state.qaLists = result.qaLists;
    });
  } catch (error) {
    showNoticeBadge(error?.message ?? String(error), render, 3200);
    render();
  }
}
