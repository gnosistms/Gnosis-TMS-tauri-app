import { requireBrokerSession } from "./auth-flow.js";
import { appendRepoNameSuffix, slugifyRepoName } from "./repo-names.js";
import { invoke } from "./runtime.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import { normalizeQaList, sortQaLists } from "./qa-list-shared.js";
import { state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import {
  listLocalQaListMetadataRecords,
  listQaListMetadataRecords,
  lookupLocalMetadataTombstone,
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

function findMatchingRemoteQaList(record, remoteByRepoName, remoteByFullName) {
  return (
    remoteByRepoName.get(record?.repoName)
    ?? remoteByFullName.get(record?.fullName)
    ?? null
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

function mergeMetadataBackedQaLists(localQaLists, metadataRecords, remoteRepos) {
  const normalizedLocals = (Array.isArray(localQaLists) ? localQaLists : [])
    .map(normalizeQaList)
    .filter(Boolean);
  const remoteByName = new Map(
    (Array.isArray(remoteRepos) ? remoteRepos : [])
      .map(normalizeRemoteQaListRepo)
      .filter(Boolean)
      .map((repo) => [repo.name, repo]),
  );
  const remoteByFullName = new Map(
    (Array.isArray(remoteRepos) ? remoteRepos : [])
      .map(normalizeRemoteQaListRepo)
      .filter(Boolean)
      .map((repo) => [repo.fullName, repo]),
  );
  const localById = new Map(normalizedLocals.map((qaList) => [qaList.id, qaList]));
  const localByRepoName = new Map(normalizedLocals.map((qaList) => [qaList.repoName, qaList]));
  const matchedLocalIds = new Set();
  const merged = [];

  for (const record of Array.isArray(metadataRecords) ? metadataRecords : []) {
    if (record?.recordState !== "live") {
      continue;
    }
    const localQaList = localById.get(record.id) ?? localByRepoName.get(record.repoName) ?? null;
    const remoteQaList = findMatchingRemoteQaList(record, remoteByName, remoteByFullName);
    if (localQaList) {
      matchedLocalIds.add(localQaList.id);
    }
    merged.push(normalizeQaList({
      ...localQaList,
      id: record.id,
      qaListId: record.id,
      title: record.title,
      repoName: record.repoName,
      lifecycleState: record.lifecycleState,
      remoteState: record.remoteState,
      recordState: record.recordState,
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
    if (!matchedLocalIds.has(qaList.id)) {
      merged.push(qaList);
    }
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
  const remoteByName = new Map(
    (Array.isArray(remoteRepos) ? remoteRepos : [])
      .map(normalizeRemoteQaListRepo)
      .filter(Boolean)
      .map((repo) => [repo.name, repo]),
  );
  const remoteByFullName = new Map(
    (Array.isArray(remoteRepos) ? remoteRepos : [])
      .map(normalizeRemoteQaListRepo)
      .filter(Boolean)
      .map((repo) => [repo.fullName, repo]),
  );
  return (Array.isArray(metadataRecords) ? metadataRecords : [])
    .filter((record) =>
      record?.recordState === "live"
      && record?.remoteState !== "deleted"
      && record?.remoteState !== "missing"
      && !isDeletedRepoResource(record)
    )
    .map((record) => {
      const remote = findMatchingRemoteQaList(record, remoteByName, remoteByFullName);
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
  let metadataLoaded = false;
  let brokerWarning = "";
  try {
    metadataRecords = await listQaListMetadataRecords(team);
    metadataLoaded = true;
    metadataRecords = await backfillQaListMetadataRecords(team, localQaLists, remoteRepos, metadataRecords);
  } catch (error) {
    brokerWarning = error?.message ?? String(error);
  }
  let syncTargets = [];
  if (metadataLoaded) {
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
    ? mergeMetadataBackedQaLists(localQaLists, metadataRecords, remoteRepos)
    : mergeQaListRepoMetadata(localQaLists, remoteRepos);

  return {
    qaLists: applyLocalQaListHardDeleteState(team, mergedQaLists),
    remoteRepos,
    syncSnapshots,
    syncIssue,
    brokerWarning,
    recoveryMessage: "",
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
