import { requireBrokerSession } from "./auth-flow.js";
import { invoke } from "./runtime.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import { loadStoredGlossariesForTeam, saveStoredGlossariesForTeam } from "./glossary-cache.js";
import { normalizeGlossarySummary, sortGlossaries } from "./glossary-shared.js";
import { areResourcePageWritesDisabled } from "./resource-page-controller.js";
import { ensureResourceNotTombstoned } from "./resource-lifecycle-engine.js";
import { showNoticeBadge } from "./status-feedback.js";
import { state } from "./state.js";
import { removeGlossaryFromState } from "./glossary-top-level-state.js";
import { requireAppUpdate } from "./updater-flow.js";
import {
  inspectAndMigrateLocalRepoBindings,
  listLocalGlossaryMetadataRecords,
  listGlossaryMetadataRecords,
  lookupLocalMetadataTombstone,
  repairAutoRepairableRepoBindings,
  repairLocalRepoBinding,
  upsertGlossaryMetadataRecord,
} from "./team-metadata-flow.js";
import {
  findConfirmedMissingGlossaryRecords,
  mergeMetadataBackedGlossarySummaries,
} from "./glossary-discovery.js";
import {
  clearRestoredLocalHardDeleteTombstones,
  filterLocalHardDeletedResources,
  isLocalHardDeletedResource,
} from "./local-hard-delete-store.js";
import {
  filterKnownDeletedRepoResources,
  isDeletedRepoResource,
  repoTransportLifecycleFields,
} from "./repo-transport-eligibility.js";
import { isSoftDeletedResource } from "./resource-write-policy.js";

export function teamSupportsGlossaryRepos(team) {
  return Boolean(invoke)
    && Number.isFinite(team?.installationId)
    && typeof team?.githubOrg === "string"
    && team.githubOrg.trim();
}

function normalizeGlossaryBrokerError(error) {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error ?? "Unknown glossary broker error."));
}

async function repairGlossaryMetadataFromRemoteRename(team, metadataRecords, remoteRepos) {
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
      upsertGlossaryMetadataRecord(team, {
        glossaryId: record.id,
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
        sourceLanguage: record.sourceLanguage ?? null,
        targetLanguage: record.targetLanguage ?? null,
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

async function finalizeMissingGlossariesForTeam(team, metadataRecords, remoteRepos) {
  const missingRecords = findConfirmedMissingGlossaryRecords(metadataRecords, remoteRepos);
  if (!Number.isFinite(team?.installationId) || missingRecords.length === 0) {
    return metadataRecords;
  }

  const deletedAt = new Date().toISOString();

  for (const record of missingRecords) {
    await upsertGlossaryMetadataRecord(team, {
      glossaryId: record.id,
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
      sourceLanguage: record.sourceLanguage ?? null,
      targetLanguage: record.targetLanguage ?? null,
      termCount: Number.isFinite(record.termCount) ? record.termCount : 0,
    }, { requirePushSuccess: true });

    try {
      await purgeLocalGlossaryRepo(team, record.id, record.repoName);
    } catch {}
  }

  return listGlossaryMetadataRecords(team).catch(() => metadataRecords);
}

export function normalizeRemoteGlossaryRepo(repo) {
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
    glossaryId:
      typeof repo.glossaryId === "string" && repo.glossaryId.trim()
        ? repo.glossaryId.trim()
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

function glossaryRepoSyncDescriptor(repo) {
  return {
    glossaryId:
      typeof repo?.glossaryId === "string" && repo.glossaryId.trim()
        ? repo.glossaryId.trim()
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

export function glossaryRepoDescriptor(glossary) {
  if (!glossary?.repoName || !glossary?.fullName) {
    return null;
  }

  return {
    glossaryId: glossary.id ?? glossary.glossaryId ?? null,
    repoName: glossary.repoName,
    fullName: glossary.fullName,
    repoId: Number.isFinite(glossary.repoId) ? glossary.repoId : null,
    defaultBranchName: glossary.defaultBranchName || "main",
    defaultBranchHeadOid: glossary.defaultBranchHeadOid || null,
    ...repoTransportLifecycleFields(glossary),
  };
}

function metadataBackedGlossaryRepo(record) {
  if (
    !record
    || record.recordState !== "live"
    || record.remoteState !== "linked"
    || isDeletedRepoResource(record)
    || typeof record.repoName !== "string"
    || !record.repoName.trim()
    || typeof record.fullName !== "string"
    || !record.fullName.trim()
  ) {
    return null;
  }

  return normalizeRemoteGlossaryRepo({
    glossaryId: record.id,
    repoId: record.githubRepoId,
    nodeId: record.githubNodeId,
    name: record.repoName,
    fullName: record.fullName,
    defaultBranchName: record.defaultBranch || "main",
  });
}

function findMatchingRemoteGlossary(record, remoteByRepoName, remoteByFullName) {
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

function glossaryMetadataRecordFromSummary(glossary, remote = null) {
  return {
    glossaryId: glossary.id ?? glossary.glossaryId,
    title: glossary.title,
    repoName: glossary.repoName,
    previousRepoNames: glossary.previousRepoNames ?? [],
    githubRepoId: remote?.repoId ?? glossary.repoId ?? null,
    githubNodeId: remote?.nodeId ?? glossary.nodeId ?? null,
    fullName: remote?.fullName ?? glossary.fullName ?? null,
    defaultBranch: remote?.defaultBranchName ?? glossary.defaultBranchName ?? "main",
    lifecycleState: glossary.lifecycleState === "deleted" ? "deleted" : "active",
    remoteState: glossary.remoteState ?? "linked",
    recordState: glossary.recordState ?? "live",
    deletedAt: glossary.deletedAt ?? null,
    sourceLanguage: glossary.sourceLanguage ?? null,
    targetLanguage: glossary.targetLanguage ?? null,
    termCount: Number.isFinite(glossary.termCount) ? glossary.termCount : 0,
  };
}

async function backfillGlossaryMetadataRecords(team, localSummaries, remoteRepos, metadataRecords) {
  if (!Number.isFinite(team?.installationId) || state.offline?.isEnabled === true) {
    return metadataRecords;
  }
  const existingIds = new Set((Array.isArray(metadataRecords) ? metadataRecords : []).map((record) => record.id));
  const remoteByName = new Map(
    (Array.isArray(remoteRepos) ? remoteRepos : [])
      .map(normalizeRemoteGlossaryRepo)
      .filter(Boolean)
      .map((repo) => [repo.name, repo]),
  );
  let wroteRecord = false;
  for (const glossary of (Array.isArray(localSummaries) ? localSummaries : []).map(normalizeGlossarySummary).filter(Boolean)) {
    if (
      !glossary.id
      || existingIds.has(glossary.id)
      || !glossary.repoName
      || !glossary.sourceLanguage
      || !glossary.targetLanguage
    ) {
      continue;
    }
    try {
      await upsertGlossaryMetadataRecord(
        team,
        glossaryMetadataRecordFromSummary(glossary, remoteByName.get(glossary.repoName) ?? null),
        { requirePushSuccess: true },
      );
      wroteRecord = true;
      existingIds.add(glossary.id);
    } catch (error) {
      console.warn(`Could not backfill glossary metadata: ${error?.message ?? String(error)}`);
    }
  }
  return wroteRecord ? await listGlossaryMetadataRecords(team) : metadataRecords;
}

function buildMetadataBackedGlossarySyncRepos(metadataRecords, remoteRepos, options = {}) {
  const remoteLoaded = options.remoteLoaded === true;
  const remoteByRepoName = new Map(
    (Array.isArray(remoteRepos) ? remoteRepos : [])
      .map(normalizeRemoteGlossaryRepo)
      .filter(Boolean)
      .map((repo) => [repo.name, repo]),
  );
  const remoteByFullName = new Map(
    (Array.isArray(remoteRepos) ? remoteRepos : [])
      .map(normalizeRemoteGlossaryRepo)
      .filter(Boolean)
      .map((repo) => [repo.fullName, repo]),
  );
  const syncRepos = [];
  const seenRepoNames = new Set();

  for (const record of Array.isArray(metadataRecords) ? metadataRecords : []) {
    if (record?.recordState !== "live" || record?.remoteState !== "linked") {
      continue;
    }
    if (isDeletedRepoResource(record)) {
      continue;
    }

    const repo =
      findMatchingRemoteGlossary(record, remoteByRepoName, remoteByFullName)
      ?? (
        remoteLoaded
          ? null
          : metadataBackedGlossaryRepo(record)
      );
    if (!repo || seenRepoNames.has(repo.name)) {
      continue;
    }

    seenRepoNames.add(repo.name);
    syncRepos.push({
      ...repo,
      glossaryId: record.id,
      lifecycleState: record.lifecycleState,
      recordState: record.recordState,
      remoteState: record.remoteState,
    });
  }

  return syncRepos;
}

function buildUntrackedRemoteGlossaryBootstrapTargets(team, metadataRecords, remoteRepos) {
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
    .map(normalizeRemoteGlossaryRepo)
    .filter((repo) =>
      repo
      && !trackedRepoNames.has(String(repo.name ?? "").trim().toLowerCase())
      && !trackedFullNames.has(String(repo.fullName ?? "").trim().toLowerCase())
      && !isLocalHardDeletedResource(team, "glossary", {
        repoName: repo.name,
        fullName: repo.fullName,
        repoId: repo.repoId,
        nodeId: repo.nodeId,
      })
    );
}

function applyLocalGlossaryHardDeleteState(team, glossaries) {
  const items = Array.isArray(glossaries) ? glossaries : [];
  clearRestoredLocalHardDeleteTombstones(team, "glossary", items, {
    isActive: (glossary) => !isSoftDeletedResource(glossary, "glossary"),
  });
  return filterLocalHardDeletedResources(team, "glossary", items, {
    isDeleted: (glossary) => isSoftDeletedResource(glossary, "glossary"),
  });
}

async function collectKnownDeletedGlossaryResources(team, localSummaries = []) {
  const stored = loadStoredGlossariesForTeam(team);
  const known = [
    ...(Array.isArray(state.glossaries) ? state.glossaries : []),
    ...(Array.isArray(stored?.glossaries) ? stored.glossaries : []),
    ...(Array.isArray(localSummaries) ? localSummaries : []),
  ];

  try {
    known.push(...await listLocalGlossaryMetadataRecords(team));
  } catch {}

  return known.filter(isDeletedRepoResource);
}

async function filterKnownDeletedGlossarySyncTargets(team, syncTargets, localSummaries = []) {
  const knownDeleted = await collectKnownDeletedGlossaryResources(team, localSummaries);
  return filterKnownDeletedRepoResources(syncTargets, knownDeleted)
    .filter((repo) => !isLocalHardDeletedResource(team, "glossary", repo));
}

function countRecoverableGlossaryMetadataRecords(records) {
  return (Array.isArray(records) ? records : []).filter((record) =>
    record?.recordState === "live"
    && record?.remoteState === "linked"
    && record?.lifecycleState === "active"
  ).length;
}

export function getGlossarySyncIssueMessage(syncSnapshots) {
  const snapshots = Array.isArray(syncSnapshots) ? syncSnapshots : [];
  const failedSnapshot = snapshots.find((snapshot) =>
    snapshot?.status === "syncError"
    || snapshot?.status === "dirtyLocal"
    || snapshot?.status === "updateRequired",
  );
  if (!failedSnapshot) {
    return { message: "", snapshots };
  }

  return {
    message:
      typeof failedSnapshot.message === "string" && failedSnapshot.message.trim()
        ? failedSnapshot.message.trim()
        : `Could not sync glossary repo ${failedSnapshot.repoName ?? ""}.`.trim(),
    snapshots,
  };
}

export async function listRemoteGlossaryReposForTeam(team) {
  if (!Number.isFinite(team?.installationId)) {
    return [];
  }

  let repos;
  try {
    repos = await invoke("list_gnosis_glossaries_for_installation", {
      installationId: team.installationId,
      sessionToken: requireBrokerSession(),
    });
  } catch (error) {
    throw normalizeGlossaryBrokerError(error);
  }

  return (Array.isArray(repos) ? repos : [])
    .map(normalizeRemoteGlossaryRepo)
    .filter(Boolean);
}

export async function syncGlossaryReposForTeam(team, remoteRepos) {
  const glossaries = (Array.isArray(remoteRepos) ? remoteRepos : [])
    .map(normalizeRemoteGlossaryRepo)
    .filter(Boolean);
  if (!Number.isFinite(team?.installationId) || glossaries.length === 0) {
    return [];
  }

  const snapshots = await invoke("sync_gtms_glossary_repos", {
    input: {
      installationId: team.installationId,
      glossaries: glossaries.map(glossaryRepoSyncDescriptor),
    },
    sessionToken: requireBrokerSession(),
  });

  const normalizedSnapshots = Array.isArray(snapshots) ? snapshots : [];
  openRequiredAppUpdatePromptFromGlossarySnapshots(normalizedSnapshots);
  return normalizedSnapshots;
}

function openRequiredAppUpdatePromptFromGlossarySnapshots(snapshots, render = null) {
  const requiredSnapshot = (Array.isArray(snapshots) ? snapshots : []).find(
    (snapshot) => snapshot?.status === "updateRequired",
  );
  if (!requiredSnapshot) {
    return false;
  }

  return requireAppUpdate(
    {
      requiredVersion: requiredSnapshot.requiredAppVersion ?? null,
      currentVersion: requiredSnapshot.currentAppVersion ?? null,
      message: requiredSnapshot.message ?? "",
    },
    render,
  );
}

export async function listLocalGlossarySummariesForTeam(team) {
  if (!Number.isFinite(team?.installationId)) {
    return [];
  }

  const glossaries = await invoke("list_local_gtms_glossaries", {
    input: { installationId: team.installationId },
  });

  return Array.isArray(glossaries) ? glossaries : [];
}

function getMissingRemoteGlossaryMessage(localSummaries, remoteRepos) {
  const localRepoNames = new Set(
    (Array.isArray(localSummaries) ? localSummaries : [])
      .map((summary) => normalizeGlossarySummary(summary))
      .filter(Boolean)
      .map((summary) => summary.repoName),
  );
  if (localRepoNames.size === 0) {
    return "";
  }

  const remoteRepoNames = new Set(
    (Array.isArray(remoteRepos) ? remoteRepos : [])
      .map(normalizeRemoteGlossaryRepo)
      .filter(Boolean)
      .map((repo) => repo.name),
  );
  const missingCount = [...localRepoNames].filter((repoName) => !remoteRepoNames.has(repoName)).length;
  if (missingCount === 0) {
    return "";
  }

  return `Showing ${missingCount} local ${
    missingCount === 1 ? "glossary" : "glossaries"
  } that remote discovery did not recognize yet.`;
}

function glossaryMetadataRecordIsTombstone(record) {
  return record?.recordState === "tombstone" || record?.remoteState === "deleted";
}

function glossaryMatchesMetadataRecord(glossary, record) {
  const glossaryId =
    typeof glossary?.id === "string" && glossary.id.trim()
      ? glossary.id.trim()
      : typeof glossary?.glossaryId === "string" && glossary.glossaryId.trim()
        ? glossary.glossaryId.trim()
        : "";
  const repoName =
    typeof glossary?.repoName === "string" && glossary.repoName.trim()
      ? glossary.repoName.trim()
      : "";
  const fullName =
    typeof glossary?.fullName === "string" && glossary.fullName.trim()
      ? glossary.fullName.trim()
      : "";
  const recordRepoNames = [
    typeof record?.repoName === "string" ? record.repoName.trim() : "",
    ...(
      Array.isArray(record?.previousRepoNames)
        ? record.previousRepoNames.map((value) => String(value ?? "").trim())
        : []
    ),
  ].filter(Boolean);

  if (glossaryId && typeof record?.id === "string" && record.id.trim()) {
    return glossaryId === record.id.trim();
  }

  if (fullName && typeof record?.fullName === "string" && record.fullName.trim()) {
    return fullName === record.fullName.trim();
  }

  return repoName && recordRepoNames.includes(repoName);
}

async function purgeLocalGlossaryRepo(team, glossaryId, repoName) {
  if (!Number.isFinite(team?.installationId) || !String(repoName ?? "").trim()) {
    return;
  }

  await invoke("purge_local_gtms_glossary_repo", {
    input: {
      installationId: team.installationId,
      glossaryId,
      repoName,
    },
  });
}

function persistVisibleGlossaries(team) {
  saveStoredGlossariesForTeam(team, state.glossaries);
}

async function runGlossaryRepoPageSync(render, operation) {
  state.glossariesPage.isRefreshing = true;
  beginPageSync();
  render?.();

  try {
    const result = await operation();
    state.glossariesPage.isRefreshing = false;
    await completePageSync(render);
    render?.();
    return result;
  } catch (error) {
    state.glossariesPage.isRefreshing = false;
    failPageSync();
    render?.();
    throw error;
  }
}

export async function ensureGlossaryNotTombstoned(render, team, glossary, options = {}) {
  return ensureResourceNotTombstoned({
    installationId: team?.installationId,
    resource: glossary,
    resourceId: glossary?.id ?? glossary?.glossaryId ?? "",
    render,
    showNotice: options.showNotice !== false,
    resourceLabel: "glossary",
    lookupMetadataTombstone: (resourceId) => lookupLocalMetadataTombstone(team, "glossary", resourceId),
    listMetadataRecords: () => listGlossaryMetadataRecords(team),
    isTombstoneRecord: glossaryMetadataRecordIsTombstone,
    matchesMetadataRecord: glossaryMatchesMetadataRecord,
    purgeLocalRepo: () => purgeLocalGlossaryRepo(team, glossary.id ?? glossary.glossaryId ?? null, glossary.repoName),
    removeVisibleResource: () => removeGlossaryFromState(glossary.id ?? glossary.glossaryId ?? null, glossary.repoName),
    persistVisibleState: () => persistVisibleGlossaries(team),
  });
}

async function purgeTombstonedGlossariesForTeam(team, localSummaries, metadataRecords) {
  const localGlossaries = (Array.isArray(localSummaries) ? localSummaries : [])
    .map(normalizeGlossarySummary)
    .filter(Boolean);
  const tombstoneRecords = (Array.isArray(metadataRecords) ? metadataRecords : []).filter(glossaryMetadataRecordIsTombstone);
  if (!Number.isFinite(team?.installationId) || tombstoneRecords.length === 0) {
    return localGlossaries;
  }

  let changed = false;
  for (const record of tombstoneRecords) {
    if (typeof record?.repoName === "string" && record.repoName.trim()) {
      try {
        await purgeLocalGlossaryRepo(team, record.id, record.repoName);
      } catch {}
    }

    for (const glossary of localGlossaries) {
      if (!glossaryMatchesMetadataRecord(glossary, record)) {
        continue;
      }
      removeGlossaryFromState(glossary.id, glossary.repoName);
      changed = true;
    }
  }
  if (changed) {
    persistVisibleGlossaries(team);
  }

  return listLocalGlossarySummariesForTeam(team);
}

export async function loadRepoBackedGlossariesForTeam(team, options = {}) {
  const offlineMode = options.offlineMode === true;
  const suppressRecoveryWarning = options.suppressRecoveryWarning === true;
  const onRecoveryDetected =
    typeof options.onRecoveryDetected === "function"
      ? options.onRecoveryDetected
      : null;
  let localSummaries = await listLocalGlossarySummariesForTeam(team);

  if (offlineMode || !Number.isFinite(team?.installationId)) {
    return {
      glossaries: sortGlossaries(
        applyLocalGlossaryHardDeleteState(
          team,
          localSummaries.map(normalizeGlossarySummary).filter(Boolean),
        ),
      ),
      remoteRepos: [],
      syncSnapshots: [],
      syncIssue: "",
      brokerWarning: "",
    };
  }

  let metadataRecords = [];
  let repairIssues = [];
  let metadataLoaded = false;
  let repairLoaded = false;
  try {
    metadataRecords = await listGlossaryMetadataRecords(team);
    metadataLoaded = true;
    repairIssues = (await inspectAndMigrateLocalRepoBindings(team))?.issues ?? [];
    repairLoaded = true;
    if (repairIssues.length > 0) {
      await repairAutoRepairableRepoBindings(team, repairIssues);
      repairIssues = (await inspectAndMigrateLocalRepoBindings(team).catch(() => null))?.issues ?? repairIssues;
    }
    localSummaries = await purgeTombstonedGlossariesForTeam(team, localSummaries, metadataRecords);
  } catch {}
  const recoverableMetadataCount = countRecoverableGlossaryMetadataRecords(metadataRecords);
  const installationRecoveryDetected =
    metadataLoaded
    && recoverableMetadataCount > 0
    && localSummaries.length === 0;
  if (installationRecoveryDetected && !suppressRecoveryWarning) {
    onRecoveryDetected?.("Local installation data was missing. Rebuilding glossary repos from GitHub.");
  }

  let remoteRepos;
  let remoteLoaded = false;
  remoteRepos = await listRemoteGlossaryReposForTeam(team);
  remoteLoaded = true;
  if (metadataLoaded) {
    metadataRecords = await backfillGlossaryMetadataRecords(team, localSummaries, remoteRepos, metadataRecords);
    const metadataRepaired = await repairGlossaryMetadataFromRemoteRename(team, metadataRecords, remoteRepos);
    if (metadataRepaired) {
      metadataRecords = await listGlossaryMetadataRecords(team).catch(() => metadataRecords);
    }
    metadataRecords = await finalizeMissingGlossariesForTeam(team, metadataRecords, remoteRepos);
    localSummaries = await purgeTombstonedGlossariesForTeam(team, localSummaries, metadataRecords);
  }
  let syncTargets = [];
  if (metadataLoaded) {
    const metadataSyncTargets = buildMetadataBackedGlossarySyncRepos(metadataRecords, remoteRepos, { remoteLoaded });
    const untrackedRemoteSyncTargets = await filterKnownDeletedGlossarySyncTargets(
      team,
      buildUntrackedRemoteGlossaryBootstrapTargets(team, metadataRecords, remoteRepos),
      localSummaries,
    );
    syncTargets = [...metadataSyncTargets, ...untrackedRemoteSyncTargets];
  } else {
    syncTargets = await filterKnownDeletedGlossarySyncTargets(team, remoteRepos, localSummaries);
  }
  const syncSnapshots = syncTargets.length > 0
    ? await syncGlossaryReposForTeam(team, syncTargets)
    : [];
  const refreshedLocalSummaries = await listLocalGlossarySummariesForTeam(team);
  const syncIssue = getGlossarySyncIssueMessage(syncSnapshots);
  if (metadataLoaded) {
    metadataRecords = await backfillGlossaryMetadataRecords(team, refreshedLocalSummaries, remoteRepos, metadataRecords);
  }

  const mergedGlossaries = metadataLoaded
    ? mergeMetadataBackedGlossarySummaries(
        refreshedLocalSummaries,
        metadataRecords,
        remoteRepos,
        { metadataLoaded, remoteLoaded, repairLoaded, repairIssues },
      )
    : mergeMetadataBackedGlossarySummaries(
        refreshedLocalSummaries,
        [],
        remoteRepos,
        { metadataLoaded: false, remoteLoaded, repairLoaded, repairIssues: [] },
      );

  return {
    glossaries: applyLocalGlossaryHardDeleteState(team, mergedGlossaries),
    remoteRepos: syncTargets,
    syncSnapshots,
    syncIssue,
    brokerWarning: "",
    recoveryMessage:
      installationRecoveryDetected && !suppressRecoveryWarning
        ? "Local installation data was missing. Rebuilt glossary repos from GitHub."
        : "",
  };
}

export async function createRemoteGlossaryRepoWithName(team, repoName) {
  let createdRepo;
  try {
    createdRepo = await invoke("create_gnosis_glossary_repo", {
      input: {
        installationId: team.installationId,
        orgLogin: team.githubOrg,
        repoName,
      },
      sessionToken: requireBrokerSession(),
    });
  } catch (error) {
    throw normalizeGlossaryBrokerError(error);
  }

  const remoteRepo = normalizeRemoteGlossaryRepo(createdRepo);
  if (!remoteRepo) {
    throw new Error("Could not determine the new glossary repo metadata.");
  }
  return remoteRepo;
}

export async function permanentlyDeleteRemoteGlossaryRepoForTeam(team, repoName) {
  try {
    await invoke("rollback_created_gnosis_glossary_repo", {
      input: {
        installationId: team.installationId,
        orgLogin: team.githubOrg,
        repoName,
      },
      sessionToken: requireBrokerSession(),
    });
  } catch (error) {
    throw normalizeGlossaryBrokerError(error);
  }
}

export async function repairGlossaryRepoBinding(render, team, glossaryId) {
  if (!Number.isFinite(team?.installationId) || typeof glossaryId !== "string" || !glossaryId.trim()) {
    return;
  }
  if (areResourcePageWritesDisabled(state.glossariesPage)) {
    showNoticeBadge("Wait for the current glossary refresh or write to finish.", render);
    return;
  }

  try {
    await runGlossaryRepoPageSync(render, async () => {
      await repairLocalRepoBinding(team, "glossary", glossaryId);
      const result = await loadRepoBackedGlossariesForTeam(team, {
        offlineMode: state.offline?.isEnabled === true,
      });
      state.glossaries = result.glossaries;
    });
    showNoticeBadge("The glossary repo binding was repaired.", render, 2200);
    render();
  } catch (error) {
    showNoticeBadge(error?.message ?? String(error), render, 3200);
    render();
  }
}

export async function rebuildGlossaryLocalRepo(render, team, glossaryId) {
  if (!Number.isFinite(team?.installationId) || typeof glossaryId !== "string" || !glossaryId.trim()) {
    return;
  }
  if (areResourcePageWritesDisabled(state.glossariesPage)) {
    showNoticeBadge("Wait for the current glossary refresh or write to finish.", render);
    return;
  }

  showNoticeBadge("Rebuilding the local glossary repo from metadata and GitHub...", render, 2200);
  try {
    await runGlossaryRepoPageSync(render, async () => {
      const result = await loadRepoBackedGlossariesForTeam(team, {
        offlineMode: state.offline?.isEnabled === true,
      });
      state.glossaries = result.glossaries;
    });
  } catch (error) {
    showNoticeBadge(error?.message ?? String(error), render, 3200);
    render();
  }
}

export async function syncSingleGlossaryForTeam(team, glossary) {
  const descriptor = glossaryRepoDescriptor(glossary);
  const repo = descriptor
    ? normalizeRemoteGlossaryRepo({
        glossaryId: descriptor.glossaryId,
        name: descriptor.repoName,
        fullName: descriptor.fullName,
        htmlUrl: glossary.htmlUrl,
        private: glossary.private,
        description: glossary.description,
        defaultBranchName: descriptor.defaultBranchName,
        defaultBranchHeadOid: descriptor.defaultBranchHeadOid,
        repoId: descriptor.repoId,
        nodeId: glossary.nodeId,
        ...repoTransportLifecycleFields(descriptor),
      })
    : null;

  if (!repo) {
    return [];
  }

  return syncGlossaryReposForTeam(team, [repo]);
}
