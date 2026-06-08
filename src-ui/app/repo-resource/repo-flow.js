import { requireBrokerSession } from "../auth-flow.js";
import { appendRepoNameSuffix, slugifyRepoName } from "../repo-names.js";
import { invoke } from "../runtime.js";
import { beginPageSync, completePageSync, failPageSync } from "../page-sync.js";
import { state } from "../state.js";
import { showNoticeBadge } from "../status-feedback.js";
import { areResourcePageWritesDisabled } from "../resource-page-controller.js";
import { ensureResourceNotTombstoned } from "../resource-lifecycle-engine.js";
import {
  clearRestoredLocalHardDeleteTombstones,
  filterLocalHardDeletedResources,
  isLocalHardDeletedResource,
} from "../local-hard-delete-store.js";
import { isSoftDeletedResource } from "../resource-write-policy.js";
import {
  filterKnownDeletedRepoResources,
  isDeletedRepoResource,
  repoResourcesMatch,
  repoTransportLifecycleFields,
} from "../repo-transport-eligibility.js";
import {
  inspectAndMigrateLocalRepoBindings,
  lookupLocalMetadataTombstone,
  repairAutoRepairableRepoBindings,
  repairLocalRepoBinding,
} from "../team-metadata-flow.js";

function normalizeBrokerError(error, fallback) {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error ?? fallback));
}

function createRemoteRepoMaps(remoteRepos, normalizeRemoteRepo) {
  const normalizedRemotes = (Array.isArray(remoteRepos) ? remoteRepos : [])
    .map(normalizeRemoteRepo)
    .filter(Boolean);
  return {
    normalizedRemotes,
    remoteByRepoId: new Map(
      normalizedRemotes
        .filter((repo) => Number.isFinite(repo.repoId))
        .map((repo) => [repo.repoId, repo]),
    ),
    remoteByNodeId: new Map(
      normalizedRemotes
        .filter((repo) => typeof repo.nodeId === "string" && repo.nodeId.trim())
        .map((repo) => [repo.nodeId, repo]),
    ),
    remoteByRepoName: new Map(normalizedRemotes.map((repo) => [repo.name, repo])),
    remoteByFullName: new Map(normalizedRemotes.map((repo) => [repo.fullName, repo])),
  };
}

function findMatchingRemoteRecord(record, remoteByRepoName, remoteByFullName, remoteByRepoId, remoteByNodeId) {
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

function findMatchingLocalResource(record, localById, localByRepoName) {
  const byId = localById.get(record?.id);
  if (byId) {
    return byId;
  }

  const repoNames = [
    record?.repoName,
    ...(Array.isArray(record?.previousRepoNames) ? record.previousRepoNames : []),
  ];
  for (const repoName of repoNames) {
    const match = localByRepoName.get(repoName);
    if (match) {
      return match;
    }
  }

  return null;
}

function createRepairIssueMaps(kind, repairIssues = []) {
  const byResourceId = new Map();
  const byRepoName = new Map();

  for (const issue of Array.isArray(repairIssues) ? repairIssues : []) {
    if (issue?.kind !== kind) {
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

function matchingRepairIssue(resource, repairIssueMaps) {
  if (!resource || !repairIssueMaps) {
    return null;
  }
  if (repairIssueMaps.byResourceId.has(resource.id)) {
    return repairIssueMaps.byResourceId.get(resource.id);
  }
  if (repairIssueMaps.byRepoName.has(resource.repoName)) {
    return repairIssueMaps.byRepoName.get(resource.repoName);
  }
  return null;
}

function supportsUnmatchedLocalResource(resource, repairIssueMaps) {
  const repairIssue = matchingRepairIssue(resource, repairIssueMaps);
  return repairIssue?.issueType === "strayLocalRepo";
}

export function createRepoResourceReconciliationPrimitives(descriptor) {
  const {
    kind,
    resourceIdField,
    normalizeSummary,
    sortSummaries,
    normalizeRemoteRepo,
    languageFieldsForMerge,
  } = descriptor;

  function metadataBackedRepo(record) {
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

    return normalizeRemoteRepo({
      [resourceIdField]: record.id,
      repoId: record.githubRepoId,
      nodeId: record.githubNodeId,
      name: record.repoName,
      fullName: record.fullName,
      defaultBranchName: record.defaultBranch || "main",
    });
  }

  function remoteRepoToVisibleSummary(remoteRepo) {
    const normalizedRemote = normalizeRemoteRepo(remoteRepo);
    if (!normalizedRemote) {
      return null;
    }

    return normalizeSummary({
      [resourceIdField]: normalizedRemote.nodeId || normalizedRemote.fullName || normalizedRemote.name,
      repoName: normalizedRemote.name,
      title: normalizedRemote.name,
      lifecycleState: "active",
      remoteState: "linked",
      recordState: "live",
      fullName: normalizedRemote.fullName,
      htmlUrl: normalizedRemote.htmlUrl,
      defaultBranchName: normalizedRemote.defaultBranchName,
      defaultBranchHeadOid: normalizedRemote.defaultBranchHeadOid,
      repoId: normalizedRemote.repoId,
      nodeId: normalizedRemote.nodeId,
    });
  }

  function findMatchingRemote(record, remoteByRepoName, remoteByFullName, remoteByRepoId, remoteByNodeId) {
    return findMatchingRemoteRecord(
      record,
      remoteByRepoName,
      remoteByFullName,
      remoteByRepoId,
      remoteByNodeId,
    );
  }

  function findConfirmedMissingRecords(metadataRecords = [], remoteRepos = []) {
    const {
      remoteByRepoId,
      remoteByNodeId,
      remoteByRepoName,
      remoteByFullName,
    } = createRemoteRepoMaps(remoteRepos, normalizeRemoteRepo);

    return (Array.isArray(metadataRecords) ? metadataRecords : []).filter((record) =>
      record?.recordState === "live"
      && (record?.remoteState ?? "linked") === "linked"
      && !findMatchingRemote(
        record,
        remoteByRepoName,
        remoteByFullName,
        remoteByRepoId,
        remoteByNodeId,
      )
    );
  }

  function mergeMetadataBackedSummaries(localSummaries, metadataRecords, remoteRepos, options = {}) {
    const metadataLoaded = options.metadataLoaded === true;
    const remoteLoaded = options.remoteLoaded === true;
    const repairLoaded = options.repairLoaded === true;
    const repairIssueMaps = createRepairIssueMaps(kind, options.repairIssues);
    const normalizedLocals = (Array.isArray(localSummaries) ? localSummaries : [])
      .map(normalizeSummary)
      .filter(Boolean);
    const localById = new Map(normalizedLocals.map((resource) => [resource.id, resource]));
    const localByRepoName = new Map(normalizedLocals.map((resource) => [resource.repoName, resource]));
    const {
      normalizedRemotes,
      remoteByRepoId,
      remoteByNodeId,
      remoteByRepoName,
      remoteByFullName,
    } = createRemoteRepoMaps(remoteRepos, normalizeRemoteRepo);
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

      const localResource = findMatchingLocalResource(record, localById, localByRepoName);
      const remoteResource =
        findMatchingRemote(record, remoteByRepoName, remoteByFullName, remoteByRepoId, remoteByNodeId)
        ?? metadataBackedRepo(record);

      if (localResource) {
        matchedLocalIds.add(localResource.id);
        matchedLocalRepoNames.add(localResource.repoName);
      }

      const repairIssue = matchingRepairIssue({ id: record.id, repoName: record.repoName }, repairIssueMaps);
      const remoteState =
        remoteLoaded
        && (record.remoteState ?? "linked") === "linked"
        && !remoteResource
          ? "missing"
          : (record.remoteState ?? "linked");
      const resolutionState =
        remoteState === "missing"
          ? "missing"
          : repairIssue
            ? "repair"
            : "";

      const mergedResource = normalizeSummary({
        ...localResource,
        [resourceIdField]: record.id,
        id: record.id,
        repoName: record.repoName,
        title: record.title,
        ...languageFieldsForMerge(localResource, record),
        lifecycleState: record.lifecycleState,
        remoteState,
        recordState: record.recordState ?? "live",
        resolutionState,
        repairIssueType: repairIssue?.issueType ?? "",
        repairIssueMessage: repairIssue?.message ?? "",
        deletedAt: record.deletedAt ?? null,
        termCount: localResource?.termCount ?? record.termCount ?? 0,
        repoId: remoteResource?.repoId ?? record.githubRepoId ?? localResource?.repoId ?? null,
        nodeId: remoteResource?.nodeId ?? record.githubNodeId ?? localResource?.nodeId ?? null,
        fullName: remoteResource?.fullName ?? record.fullName ?? localResource?.fullName ?? "",
        htmlUrl: remoteResource?.htmlUrl ?? localResource?.htmlUrl ?? "",
        defaultBranchName:
          remoteResource?.defaultBranchName
          ?? record.defaultBranch
          ?? localResource?.defaultBranchName
          ?? "main",
        defaultBranchHeadOid:
          remoteResource?.defaultBranchHeadOid
          ?? localResource?.defaultBranchHeadOid
          ?? null,
      });

      if (mergedResource) {
        merged.push(mergedResource);
      }
    }

    for (const resource of normalizedLocals) {
      if (matchedLocalIds.has(resource.id) || matchedLocalRepoNames.has(resource.repoName)) {
        continue;
      }
      if (resource?.recordState === "tombstone") {
        continue;
      }
      const repairIssue = matchingRepairIssue(resource, repairIssueMaps);
      if (metadataLoaded && repairLoaded && !supportsUnmatchedLocalResource(resource, repairIssueMaps)) {
        continue;
      }
      merged.push(normalizeSummary({
        ...resource,
        resolutionState:
          repairIssue
            ? "repair"
            : metadataLoaded
              && resource.recordState !== "tombstone"
                ? "unregisteredLocal"
                : resource.resolutionState ?? "",
        repairIssueType: repairIssue?.issueType ?? "",
        repairIssueMessage: repairIssue?.message ?? "",
      }));
    }

    if (!metadataLoaded) {
      for (const remoteRepo of normalizedRemotes) {
        const visibleResource = remoteRepoToVisibleSummary(remoteRepo);
        if (!visibleResource) {
          continue;
        }
        if (
          matchedLocalIds.has(visibleResource.id)
          || matchedLocalRepoNames.has(visibleResource.repoName)
          || merged.some((resource) =>
            resource.id === visibleResource.id || resource.repoName === visibleResource.repoName)
        ) {
          continue;
        }
        merged.push(visibleResource);
      }
    }

    return sortSummaries(merged.filter(Boolean));
  }

  return {
    createRepairIssueMaps: (repairIssues) => createRepairIssueMaps(kind, repairIssues),
    findMatchingRemote,
    findConfirmedMissingRecords,
    mergeMetadataBackedSummaries,
    metadataBackedRepo,
  };
}

export function createRepoResourceRepoFlow(descriptor) {
  const {
    kind,
    collectionField,
    pageField,
    resourceIdField,
    repoListPayloadField,
    defaultRepoBaseName,
    createRepoTitlePrefix,
    normalizeSummary,
    sortSummaries,
    loadStoredForTeam,
    saveStoredForTeam,
    removeFromState,
    teamSupportsRepos,
    normalizeRemoteRepo,
    buildMetadataRecord,
    metadataFieldsFromResource,
    metadataFieldsFromRecord,
    languageFieldsForMerge,
    resourceHasRequiredMetadata,
    listMetadataRecords,
    listLocalMetadataRecords,
    upsertMetadataRecord,
    ensureRuntime = null,
    afterSyncSnapshots = null,
    formatMetadataWarning = null,
    commands,
    messages,
  } = descriptor;
  const primitives = createRepoResourceReconciliationPrimitives({
    kind,
    resourceIdField,
    normalizeSummary,
    sortSummaries,
    normalizeRemoteRepo,
    languageFieldsForMerge,
  });

  function runEnsureRuntime() {
    if (typeof ensureRuntime === "function") {
      ensureRuntime();
    }
  }

  function resourceId(resource) {
    return resource?.id ?? resource?.[resourceIdField] ?? null;
  }

  function repoDescriptor(resource) {
    if (!resource?.repoName || !resource?.fullName) {
      return null;
    }

    return {
      [resourceIdField]: resource.id ?? resource?.[resourceIdField] ?? null,
      repoName: resource.repoName,
      fullName: resource.fullName,
      repoId: Number.isFinite(resource.repoId) ? resource.repoId : null,
      defaultBranchName: resource.defaultBranchName || "main",
      defaultBranchHeadOid: resource.defaultBranchHeadOid || null,
      ...repoTransportLifecycleFields(resource),
    };
  }

  function repoSyncDescriptor(repo) {
    return {
      [resourceIdField]:
        typeof repo?.[resourceIdField] === "string" && repo[resourceIdField].trim()
          ? repo[resourceIdField].trim()
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

  function metadataRecordFromSummary(resource, remote = null) {
    return {
      [resourceIdField]: resource.id ?? resource?.[resourceIdField],
      title: resource.title,
      repoName: resource.repoName,
      previousRepoNames: resource.previousRepoNames ?? [],
      githubRepoId: remote?.repoId ?? resource.repoId ?? null,
      githubNodeId: remote?.nodeId ?? resource.nodeId ?? null,
      fullName: remote?.fullName ?? resource.fullName ?? null,
      defaultBranch: remote?.defaultBranchName ?? resource.defaultBranchName ?? "main",
      lifecycleState: resource.lifecycleState === "deleted" ? "deleted" : "active",
      remoteState: resource.remoteState ?? "linked",
      recordState: resource.recordState ?? "live",
      deletedAt: resource.deletedAt ?? null,
      ...metadataFieldsFromResource(resource),
      termCount: Number.isFinite(resource.termCount) ? resource.termCount : 0,
    };
  }

  async function repairMetadataFromRemoteRename(team, metadataRecords, remoteRepos) {
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
        upsertMetadataRecord(team, {
          [resourceIdField]: record.id,
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
          ...metadataFieldsFromRecord(record),
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

  async function finalizeMissingForTeam(team, metadataRecords, remoteRepos) {
    const missingRecords = primitives.findConfirmedMissingRecords(metadataRecords, remoteRepos);
    if (!Number.isFinite(team?.installationId) || missingRecords.length === 0) {
      return metadataRecords;
    }

    const deletedAt = new Date().toISOString();

    for (const record of missingRecords) {
      await upsertMetadataRecord(team, {
        [resourceIdField]: record.id,
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
        ...metadataFieldsFromRecord(record),
        termCount: Number.isFinite(record.termCount) ? record.termCount : 0,
      }, { requirePushSuccess: true });

      try {
        await purgeLocalRepo(team, record.id, record.repoName);
      } catch {}
    }

    return listMetadataRecords(team).catch(() => metadataRecords);
  }

  async function backfillMetadataRecords(team, localSummaries, remoteRepos, metadataRecords) {
    if (!Number.isFinite(team?.installationId) || state.offline?.isEnabled === true) {
      return metadataRecords;
    }
    const existingIds = new Set((Array.isArray(metadataRecords) ? metadataRecords : []).map((record) => record.id));
    const remoteByName = new Map(
      (Array.isArray(remoteRepos) ? remoteRepos : [])
        .map(normalizeRemoteRepo)
        .filter(Boolean)
        .map((repo) => [repo.name, repo]),
    );
    let wroteRecord = false;
    for (const resource of (Array.isArray(localSummaries) ? localSummaries : []).map(normalizeSummary).filter(Boolean)) {
      if (
        !resource.id
        || existingIds.has(resource.id)
        || !resource.repoName
        || !resourceHasRequiredMetadata(resource)
      ) {
        continue;
      }
      try {
        await upsertMetadataRecord(
          team,
          metadataRecordFromSummary(resource, remoteByName.get(resource.repoName) ?? null),
          { requirePushSuccess: true },
        );
        wroteRecord = true;
        existingIds.add(resource.id);
      } catch (error) {
        console.warn(`Could not backfill ${messages.resourceLabelLower} metadata: ${error?.message ?? String(error)}`);
      }
    }
    return wroteRecord ? await listMetadataRecords(team) : metadataRecords;
  }

  function metadataBackedSyncRepos(metadataRecords, remoteRepos, options = {}) {
    const remoteLoaded = options.remoteLoaded === true;
    const {
      remoteByRepoId,
      remoteByNodeId,
      remoteByRepoName,
      remoteByFullName,
    } = createRemoteRepoMaps(remoteRepos, normalizeRemoteRepo);
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
        primitives.findMatchingRemote(record, remoteByRepoName, remoteByFullName, remoteByRepoId, remoteByNodeId)
        ?? (
          remoteLoaded
            ? null
            : primitives.metadataBackedRepo(record)
        );
      if (!repo || seenRepoNames.has(repo.name)) {
        continue;
      }

      seenRepoNames.add(repo.name);
      syncRepos.push({
        ...repo,
        [resourceIdField]: record.id,
        lifecycleState: record.lifecycleState,
        recordState: record.recordState,
        remoteState: record.remoteState,
      });
    }

    return syncRepos;
  }

  function buildUntrackedRemoteBootstrapTargets(team, metadataRecords, remoteRepos) {
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
      .map(normalizeRemoteRepo)
      .filter((repo) =>
        repo
        && !trackedRepoNames.has(String(repo.name ?? "").trim().toLowerCase())
        && !trackedFullNames.has(String(repo.fullName ?? "").trim().toLowerCase())
        && !isLocalHardDeletedResource(team, kind, {
          repoName: repo.name,
          fullName: repo.fullName,
          repoId: repo.repoId,
          nodeId: repo.nodeId,
        })
      );
  }

  function applyLocalHardDeleteState(team, resources) {
    const items = Array.isArray(resources) ? resources : [];
    clearRestoredLocalHardDeleteTombstones(team, kind, items, {
      isActive: (resource) => !isSoftDeletedResource(resource, kind),
    });
    return filterLocalHardDeletedResources(team, kind, items, {
      isDeleted: (resource) => isSoftDeletedResource(resource, kind),
    });
  }

  async function collectKnownDeletedResources(team, localSummaries = []) {
    const stored = loadStoredForTeam(team);
    const known = [
      ...(Array.isArray(state[collectionField]) ? state[collectionField] : []),
      ...(Array.isArray(stored?.[collectionField]) ? stored[collectionField] : []),
      ...(Array.isArray(localSummaries) ? localSummaries : []),
    ];

    try {
      known.push(...await listLocalMetadataRecords(team));
    } catch {}

    return known.filter(isDeletedRepoResource);
  }

  async function filterKnownDeletedSyncTargets(team, syncTargets, localSummaries = []) {
    const knownDeleted = await collectKnownDeletedResources(team, localSummaries);
    return filterKnownDeletedRepoResources(syncTargets, knownDeleted)
      .filter((repo) => !isLocalHardDeletedResource(team, kind, repo));
  }

  function countRecoverableMetadataRecords(records) {
    return (Array.isArray(records) ? records : []).filter((record) =>
      record?.recordState === "live"
      && record?.remoteState === "linked"
      && record?.lifecycleState === "active"
    ).length;
  }

  function getSyncIssueMessage(syncSnapshots) {
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
          : `Could not sync ${messages.resourceLabelLower} repo ${failedSnapshot.repoName ?? ""}.`.trim(),
      snapshots,
    };
  }

  async function listRemoteReposForTeam(team) {
    if (!teamSupportsRepos(team)) {
      return [];
    }

    runEnsureRuntime();
    let repos;
    try {
      repos = await invoke(commands.listRemote, {
        installationId: team.installationId,
        sessionToken: requireBrokerSession(),
      });
    } catch (error) {
      throw normalizeBrokerError(error, messages.unknownBrokerError);
    }

    return (Array.isArray(repos) ? repos : [])
      .map(normalizeRemoteRepo)
      .filter(Boolean);
  }

  async function syncReposForTeam(team, remoteRepos) {
    const repos = (Array.isArray(remoteRepos) ? remoteRepos : [])
      .map(normalizeRemoteRepo)
      .filter(Boolean);
    if (!teamSupportsRepos(team) || repos.length === 0) {
      return [];
    }
    runEnsureRuntime();
    const snapshots = await invoke(commands.sync, {
      input: {
        installationId: team.installationId,
        [repoListPayloadField]: repos.map(repoSyncDescriptor),
      },
      sessionToken: requireBrokerSession(),
    });
    const normalizedSnapshots = Array.isArray(snapshots) ? snapshots : [];
    afterSyncSnapshots?.(normalizedSnapshots);
    return normalizedSnapshots;
  }

  async function listLocalForTeam(team) {
    if (!Number.isFinite(team?.installationId)) {
      return [];
    }
    runEnsureRuntime();
    const resources = await invoke(commands.listLocal, {
      input: { installationId: team.installationId },
    });

    return Array.isArray(resources) ? resources : [];
  }

  function metadataRecordIsTombstone(record) {
    return record?.recordState === "tombstone" || record?.remoteState === "deleted";
  }

  function matchesMetadataRecord(resource, record) {
    return repoResourcesMatch(resource, record);
  }

  async function purgeLocalRepo(team, id, repoName) {
    if (!Number.isFinite(team?.installationId) || !String(repoName ?? "").trim()) {
      return;
    }

    runEnsureRuntime();
    await invoke(commands.purgeLocal, {
      input: {
        installationId: team.installationId,
        [resourceIdField]: id,
        repoName,
      },
    });
  }

  function persistVisible(team) {
    saveStoredForTeam(team, state[collectionField]);
  }

  async function purgeTombstonedForTeam(team, localSummaries, metadataRecords) {
    const normalizedResources = (Array.isArray(localSummaries) ? localSummaries : [])
      .map(normalizeSummary)
      .filter(Boolean);
    const tombstoneRecords = (Array.isArray(metadataRecords) ? metadataRecords : []).filter(metadataRecordIsTombstone);
    if (!Number.isFinite(team?.installationId) || tombstoneRecords.length === 0) {
      return normalizedResources;
    }

    let changed = false;
    for (const record of tombstoneRecords) {
      if (typeof record?.repoName === "string" && record.repoName.trim()) {
        try {
          await purgeLocalRepo(team, record.id, record.repoName);
        } catch {}
      }

      for (const resource of normalizedResources) {
        if (!matchesMetadataRecord(resource, record)) {
          continue;
        }
        removeFromState(resource.id, resource.repoName);
        changed = true;
      }
    }
    if (changed) {
      persistVisible(team);
    }

    return listLocalForTeam(team);
  }

  async function runRepoPageSync(render, operation) {
    state[pageField].isRefreshing = true;
    beginPageSync();
    render?.();

    try {
      const result = await operation();
      state[pageField].isRefreshing = false;
      await completePageSync(render);
      render?.();
      return result;
    } catch (error) {
      state[pageField].isRefreshing = false;
      failPageSync();
      render?.();
      throw error;
    }
  }

  async function loadRepoBackedForTeam(team, options = {}) {
    const offlineMode = options.offlineMode === true;
    const suppressRecoveryWarning = options.suppressRecoveryWarning === true;
    const onRecoveryDetected =
      typeof options.onRecoveryDetected === "function"
        ? options.onRecoveryDetected
        : null;
    const emptyResult = {
      [collectionField]: [],
      remoteRepos: [],
      syncSnapshots: [],
      syncIssue: "",
      brokerWarning: "",
      recoveryMessage: "",
    };
    if (!Number.isFinite(team?.installationId) || (!teamSupportsRepos(team) && !invoke)) {
      return emptyResult;
    }

    let localSummaries = await listLocalForTeam(team);

    if (offlineMode || !teamSupportsRepos(team)) {
      return {
        [collectionField]: sortSummaries(
          applyLocalHardDeleteState(
            team,
            localSummaries.map(normalizeSummary).filter(Boolean),
          ),
        ),
        remoteRepos: [],
        syncSnapshots: [],
        syncIssue: "",
        brokerWarning: "",
        recoveryMessage: "",
      };
    }

    const remoteRepos = await listRemoteReposForTeam(team);
    let metadataRecords = [];
    let repairIssues = [];
    let metadataLoaded = false;
    let repairLoaded = false;
    let brokerWarning = "";
    try {
      metadataRecords = await listMetadataRecords(team);
      metadataLoaded = true;
      repairIssues = (await inspectAndMigrateLocalRepoBindings(team))?.issues ?? [];
      repairLoaded = true;
      if (repairIssues.length > 0) {
        await repairAutoRepairableRepoBindings(team, repairIssues);
        repairIssues = (await inspectAndMigrateLocalRepoBindings(team).catch(() => null))?.issues ?? repairIssues;
      }
      localSummaries = await purgeTombstonedForTeam(team, localSummaries, metadataRecords);
      metadataRecords = await backfillMetadataRecords(team, localSummaries, remoteRepos, metadataRecords);
    } catch (error) {
      const message = error?.message ?? String(error);
      brokerWarning =
        typeof formatMetadataWarning === "function"
          ? formatMetadataWarning(message)
          : message;
    }

    const recoverableMetadataCount = countRecoverableMetadataRecords(metadataRecords);
    const installationRecoveryDetected =
      metadataLoaded
      && recoverableMetadataCount > 0
      && localSummaries.length === 0;
    if (installationRecoveryDetected && !suppressRecoveryWarning) {
      onRecoveryDetected?.(`Local installation data was missing. Rebuilding ${messages.pluralLabelLower} from GitHub.`);
    }

    let syncTargets = [];
    if (metadataLoaded) {
      const metadataRepaired = await repairMetadataFromRemoteRename(team, metadataRecords, remoteRepos);
      if (metadataRepaired) {
        metadataRecords = await listMetadataRecords(team).catch(() => metadataRecords);
      }
      metadataRecords = await finalizeMissingForTeam(team, metadataRecords, remoteRepos);
      localSummaries = await purgeTombstonedForTeam(team, localSummaries, metadataRecords);
      const metadataSyncTargets = metadataBackedSyncRepos(metadataRecords, remoteRepos, { remoteLoaded: true });
      const untrackedRemoteSyncTargets = await filterKnownDeletedSyncTargets(
        team,
        buildUntrackedRemoteBootstrapTargets(team, metadataRecords, remoteRepos),
        localSummaries,
      );
      syncTargets = [...metadataSyncTargets, ...untrackedRemoteSyncTargets];
    } else {
      syncTargets = await filterKnownDeletedSyncTargets(team, remoteRepos, localSummaries);
    }

    const syncSnapshots = syncTargets.length > 0
      ? await syncReposForTeam(team, syncTargets)
      : [];
    localSummaries = await listLocalForTeam(team);
    const syncIssue = getSyncIssueMessage(syncSnapshots);
    if (metadataLoaded) {
      metadataRecords = await backfillMetadataRecords(team, localSummaries, remoteRepos, metadataRecords);
    }
    const mergedSummaries = primitives.mergeMetadataBackedSummaries(
      localSummaries,
      metadataLoaded ? metadataRecords : [],
      remoteRepos,
      { metadataLoaded, remoteLoaded: true, repairLoaded, repairIssues: metadataLoaded ? repairIssues : [] },
    );

    return {
      [collectionField]: applyLocalHardDeleteState(team, mergedSummaries),
      remoteRepos,
      syncSnapshots,
      syncIssue,
      brokerWarning,
      recoveryMessage:
        installationRecoveryDetected && !suppressRecoveryWarning
          ? `Local installation data was missing. Rebuilt ${messages.pluralLabelLower} from GitHub.`
          : "",
    };
  }

  async function createRemoteRepoWithName(team, repoName) {
    if (messages.createRequiresTeamSupport === true && !teamSupportsRepos(team)) {
      return null;
    }
    runEnsureRuntime();

    const normalizedRepoName = slugifyRepoName(repoName) || defaultRepoBaseName;
    let createdRepo;
    try {
      createdRepo = await invoke(commands.createRemote, {
        input: {
          installationId: team.installationId,
          orgLogin: team.githubOrg,
          repoName: normalizedRepoName,
        },
        sessionToken: requireBrokerSession(),
      });
    } catch (error) {
      throw normalizeBrokerError(error, messages.unknownBrokerError);
    }

    const remoteRepo = normalizeRemoteRepo(createdRepo);
    if (!remoteRepo) {
      throw new Error(messages.newRepoMetadataError);
    }
    return remoteRepo;
  }

  async function createRemoteRepo(team, title) {
    if (!teamSupportsRepos(team)) {
      return null;
    }

    const baseRepoName = slugifyRepoName(`${createRepoTitlePrefix}-${title}`) || defaultRepoBaseName;
    const usedRepoNames = new Set(
      (state[collectionField] ?? [])
        .map((resource) => String(resource.repoName ?? "").trim())
        .filter(Boolean),
    );

    for (let attempt = 1; attempt <= 100; attempt += 1) {
      const repoName = appendRepoNameSuffix(baseRepoName, attempt);
      if (usedRepoNames.has(repoName)) {
        continue;
      }

      try {
        return await createRemoteRepoWithName(team, repoName);
      } catch (error) {
        const message = String(error?.message ?? error ?? "").toLowerCase();
        if (!message.includes("name already exists on this account")) {
          throw error;
        }
      }
    }

    throw new Error(messages.noAvailableRepoName);
  }

  async function prepareLocalRepo(team, repo, id = null) {
    if (!commands.prepareLocal || !Number.isFinite(team?.installationId) || !repo?.name) {
      return;
    }
    runEnsureRuntime();
    await invoke(commands.prepareLocal, {
      input: {
        installationId: team.installationId,
        [resourceIdField]: id,
        repoName: repo.name,
        remoteUrl: repo.fullName ? `https://github.com/${repo.fullName}.git` : null,
        defaultBranchName: repo.defaultBranchName || "main",
      },
    });
  }

  async function deleteRemoteRepo(team, resource) {
    if (!teamSupportsRepos(team) || !resource?.repoName || !commands.rollbackRemote) {
      return;
    }
    runEnsureRuntime();
    await invoke(commands.rollbackRemote, {
      input: {
        installationId: team.installationId,
        orgLogin: team.githubOrg,
        repoName: resource.repoName,
      },
      sessionToken: requireBrokerSession(),
    });
  }

  async function permanentlyDeleteRemoteRepoForTeam(team, repoName) {
    runEnsureRuntime();
    try {
      await invoke(commands.rollbackRemote, {
        input: {
          installationId: team.installationId,
          orgLogin: team.githubOrg,
          repoName,
        },
        sessionToken: requireBrokerSession(),
      });
    } catch (error) {
      throw normalizeBrokerError(error, messages.unknownBrokerError);
    }
  }

  async function ensureNotTombstoned(render, team, resource, options = {}) {
    return ensureResourceNotTombstoned({
      installationId: team?.installationId,
      resource,
      resourceId: resource?.id ?? resource?.[resourceIdField] ?? "",
      render,
      showNotice: options.showNotice !== false,
      resourceLabel: messages.resourceLabel,
      lookupMetadataTombstone: (id) => lookupLocalMetadataTombstone(team, kind, id),
      listMetadataRecords: () => listMetadataRecords(team),
      isTombstoneRecord: metadataRecordIsTombstone,
      matchesMetadataRecord,
      purgeLocalRepo: () => purgeLocalRepo(team, resource.id ?? resource?.[resourceIdField] ?? null, resource.repoName),
      removeVisibleResource: () => removeFromState(resource.id ?? resource?.[resourceIdField] ?? null, resource.repoName),
      persistVisibleState: () => persistVisible(team),
    });
  }

  async function repairRepoBinding(render, team, id) {
    if (!Number.isFinite(team?.installationId) || typeof id !== "string" || !id.trim()) {
      return;
    }
    if (areResourcePageWritesDisabled(state[pageField])) {
      showNoticeBadge(messages.waitForRefresh, render);
      return;
    }

    try {
      await runRepoPageSync(render, async () => {
        await repairLocalRepoBinding(team, kind, id);
        const result = await loadRepoBackedForTeam(team, {
          offlineMode: state.offline?.isEnabled === true,
        });
        state[collectionField] = result[collectionField];
      });
      showNoticeBadge(messages.bindingRepaired, render, 2200);
      render();
    } catch (error) {
      showNoticeBadge(error?.message ?? String(error), render, 3200);
      render();
    }
  }

  async function rebuildLocalRepo(render, team, id) {
    if (!Number.isFinite(team?.installationId) || typeof id !== "string" || !id.trim()) {
      return;
    }
    if (areResourcePageWritesDisabled(state[pageField])) {
      showNoticeBadge(messages.waitForRefresh, render);
      return;
    }

    showNoticeBadge(messages.rebuildingLocal, render, 2200);
    try {
      await runRepoPageSync(render, async () => {
        const result = await loadRepoBackedForTeam(team, {
          offlineMode: state.offline?.isEnabled === true,
        });
        state[collectionField] = result[collectionField];
      });
    } catch (error) {
      showNoticeBadge(error?.message ?? String(error), render, 3200);
      render();
    }
  }

  async function syncSingleForTeam(team, resource) {
    const descriptorValue = repoDescriptor(resource);
    const repo = descriptorValue
      ? normalizeRemoteRepo({
          [resourceIdField]: descriptorValue[resourceIdField],
          name: descriptorValue.repoName,
          fullName: descriptorValue.fullName,
          htmlUrl: resource.htmlUrl,
          private: resource.private,
          description: resource.description,
          defaultBranchName: descriptorValue.defaultBranchName,
          defaultBranchHeadOid: descriptorValue.defaultBranchHeadOid,
          repoId: descriptorValue.repoId,
          nodeId: resource.nodeId,
          ...repoTransportLifecycleFields(descriptorValue),
        })
      : null;

    if (!repo) {
      return [];
    }

    return syncReposForTeam(team, [repo]);
  }

  return {
    ...primitives,
    normalizeRemoteRepo,
    repoDescriptor,
    getSyncIssueMessage,
    listRemoteReposForTeam,
    syncReposForTeam,
    syncSingleForTeam,
    listLocalForTeam,
    ensureNotTombstoned,
    loadRepoBackedForTeam,
    createRemoteRepoWithName,
    createRemoteRepo,
    prepareLocalRepo,
    deleteRemoteRepo,
    permanentlyDeleteRemoteRepoForTeam,
    repairRepoBinding,
    rebuildLocalRepo,
    buildMetadataRecord,
  };
}
