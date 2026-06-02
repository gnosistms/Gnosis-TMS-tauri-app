import { invoke, waitForNextPaint } from "./runtime.js";
import { requireBrokerSession } from "./auth-flow.js";
import {
  loadStoredChapterPendingMutations,
} from "./project-cache.js";
import { applyPendingMutations } from "./optimistic-collection.js";
import { loadRepoBackedGlossariesForTeam } from "./glossary-repo-flow.js";
import { state } from "./state.js";
import { reconcileProjectRepoSyncStates } from "./project-repo-sync-flow.js";
import { clearNoticeBadge, showNoticeBadge } from "./status-feedback.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";
import {
  findConfirmedMissingProjectRecords,
  mergeMetadataDiscoveryProjects,
} from "./project-discovery.js";
import {
  inspectAndMigrateLocalRepoBindings,
  listLocalProjectMetadataRecords,
  listProjectMetadataRecords,
  repairAutoRepairableRepoBindings,
} from "./team-metadata-flow.js";
import {
  clearRestoredLocalHardDeleteTombstones,
  filterLocalHardDeletedResources,
  isLocalHardDeletedResource,
} from "./local-hard-delete-store.js";
import { isSoftDeletedResource } from "./resource-write-policy.js";
import { filterKnownDeletedRepoResources, isDeletedRepoResource } from "./repo-transport-eligibility.js";
import {
  projectRepoScope,
  waitForRepoWriteQueueIdle,
} from "./repo-write-queue.js";
import { runTeamResourceMigrationSync } from "./team-resource-migration-flow.js";

const LOCAL_PROJECT_FILE_LISTING_REPO_WAIT_MS = 1200;

function countRecoverableProjectMetadataRecords(records) {
  return (Array.isArray(records) ? records : []).filter((record) =>
    record?.recordState === "live"
    && record?.remoteState === "linked"
    && record?.lifecycleState === "active"
  ).length;
}

function applyLocalProjectHardDeleteState(selectedTeam, snapshot) {
  const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
  const deletedItems = Array.isArray(snapshot?.deletedItems) ? snapshot.deletedItems : [];
  clearRestoredLocalHardDeleteTombstones(selectedTeam, "project", [...items, ...deletedItems], {
    isActive: (project) => !isSoftDeletedResource(project, "project"),
  });
  return {
    items,
    deletedItems: filterLocalHardDeletedResources(selectedTeam, "project", deletedItems, {
      isDeleted: (project) => isSoftDeletedResource(project, "project"),
    }),
  };
}

async function collectKnownDeletedProjectResources(selectedTeam, localProjectSnapshot, options = {}) {
  const visibleSnapshot = options.visibleProjectSnapshot ?? {};
  const known = [
    ...(Array.isArray(visibleSnapshot.items) ? visibleSnapshot.items : []),
    ...(Array.isArray(visibleSnapshot.deletedItems) ? visibleSnapshot.deletedItems : []),
    ...(Array.isArray(localProjectSnapshot?.items) ? localProjectSnapshot.items : []),
    ...(Array.isArray(localProjectSnapshot?.deletedItems) ? localProjectSnapshot.deletedItems : []),
  ];

  try {
    const stored = options.loadStoredProjectsForTeam?.(selectedTeam);
    known.push(...(Array.isArray(stored?.projects) ? stored.projects : []));
    known.push(...(Array.isArray(stored?.deletedProjects) ? stored.deletedProjects : []));
  } catch {}

  try {
    known.push(...await listLocalProjectMetadataRecords(selectedTeam));
  } catch {}

  return known.filter(isDeletedRepoResource);
}

async function filterKnownDeletedRemoteProjects(selectedTeam, remoteProjects, localProjectSnapshot, options = {}) {
  const knownDeleted = await collectKnownDeletedProjectResources(selectedTeam, localProjectSnapshot, options);
  return filterKnownDeletedRepoResources(remoteProjects, knownDeleted)
    .filter((project) => !isLocalHardDeletedResource(selectedTeam, "project", project));
}

function nextProjectDiscoveryRequestId() {
  const nextId = Number.isInteger(state.projectDiscoveryRequestId)
    ? state.projectDiscoveryRequestId + 1
    : 1;
  state.projectDiscoveryRequestId = nextId;
  return nextId;
}

function createProjectLoadResult({
  snapshot,
  repoSyncByProjectId,
  glossaries,
  pendingChapterMutations,
  discovery,
  previousResult,
} = {}) {
  const previous =
    previousResult && typeof previousResult === "object"
      ? previousResult
      : {
          items: [],
          deletedItems: [],
          repoSyncByProjectId: {},
          glossaries: [],
          pendingChapterMutations: [],
          discovery: { status: "ready", error: "", glossaryWarning: "", recoveryMessage: "" },
        };
  const normalizedSnapshot = {
    items: Array.isArray(snapshot?.items) ? snapshot.items : previous.items,
    deletedItems: Array.isArray(snapshot?.deletedItems) ? snapshot.deletedItems : previous.deletedItems,
  };
  return {
    items: normalizedSnapshot.items,
    deletedItems: normalizedSnapshot.deletedItems,
    repoSyncByProjectId:
      repoSyncByProjectId && typeof repoSyncByProjectId === "object"
        ? repoSyncByProjectId
        : previous.repoSyncByProjectId,
    glossaries: Array.isArray(glossaries) ? glossaries : previous.glossaries,
    pendingChapterMutations: Array.isArray(pendingChapterMutations)
      ? pendingChapterMutations
      : previous.pendingChapterMutations,
    discovery: discovery ?? previous.discovery,
  };
}

function emitProjectLoadProgress(options, type, payload = {}, snapshot = createProjectLoadResult()) {
  if (typeof options?.onProjectLoadProgress !== "function") {
    return;
  }
  options.onProjectLoadProgress({
    type,
    snapshot,
    ...payload,
  });
}

function publishProjectLoadSnapshot({
  render,
  selectedTeam,
  snapshot,
  options = {},
  discovery = null,
  glossaries,
  pendingChapterMutations,
  repoSyncByProjectId,
  previousResult,
  progressType = "",
  progressPayload = {},
  persist = false,
} = {}) {
  const normalizedSnapshot = {
    items: Array.isArray(snapshot?.items) ? snapshot.items : [],
    deletedItems: Array.isArray(snapshot?.deletedItems) ? snapshot.deletedItems : [],
  };
  const nextResult = createProjectLoadResult({
    snapshot: normalizedSnapshot,
    discovery,
    glossaries,
    pendingChapterMutations,
    repoSyncByProjectId,
    previousResult,
  });
  if (typeof options.publishProjectLoadSnapshot === "function") {
    options.publishProjectLoadSnapshot({
      render,
      selectedTeam,
      snapshot: normalizedSnapshot,
      discovery,
      glossaries,
      pendingChapterMutations,
      repoSyncByProjectId,
      persist,
      progressType,
      progressPayload,
    });
  }
  if (progressType) {
    emitProjectLoadProgress(options, progressType, progressPayload, nextResult);
  }
  return nextResult;
}

function publishProjectDiscoveryState({
  render,
  options = {},
  discovery = null,
  previousResult,
  progressType = "",
  progressPayload = {},
} = {}) {
  const nextResult = createProjectLoadResult({
    discovery,
    previousResult,
  });
  if (typeof options.publishProjectDiscoveryState === "function") {
    options.publishProjectDiscoveryState({
      render,
      discovery,
      progressType,
      progressPayload,
    });
  }
  if (progressType) {
    emitProjectLoadProgress(options, progressType, progressPayload, nextResult);
  }
  return nextResult;
}

function repoSyncSnapshotMap(snapshots = []) {
  return Object.fromEntries(
    (Array.isArray(snapshots) ? snapshots : [])
      .filter((snapshot) => snapshot?.projectId)
      .map((snapshot) => [snapshot.projectId, snapshot]),
  );
}

function projectPageSyncControllerForOptions(options = {}) {
  const controller = options.pageSyncController;
  return {
    begin:
      typeof controller?.begin === "function"
        ? () => controller.begin()
        : () => {},
    complete:
      typeof controller?.complete === "function"
        ? (render) => controller.complete(render)
        : async () => {},
    fail:
      typeof controller?.fail === "function"
        ? () => controller.fail()
        : () => {},
  };
}

function beginProjectLoadPageSync({
  render,
  options = {},
  progressType = "remoteSyncStarted",
  progressSnapshot,
} = {}) {
  projectPageSyncControllerForOptions(options).begin();
  render?.();
  if (progressType) {
    emitProjectLoadProgress(options, progressType, {}, progressSnapshot);
  }
}

async function completeProjectLoadPageSync({
  render,
  options = {},
  progressType = "",
  progressSnapshot,
  clearNotice = true,
} = {}) {
  await projectPageSyncControllerForOptions(options).complete(render);
  if (clearNotice) {
    clearNoticeBadge();
  }
  render?.();
  if (progressType) {
    emitProjectLoadProgress(options, progressType, {}, progressSnapshot);
  }
}

function failProjectLoadPageSync({
  render,
  progressType = "",
  options = {},
  progressSnapshot,
  clearNotice = false,
  renderAfterFail = false,
} = {}) {
  projectPageSyncControllerForOptions(options).fail();
  if (clearNotice) {
    clearNoticeBadge();
  }
  if (renderAfterFail) {
    render?.();
  }
  if (progressType) {
    emitProjectLoadProgress(options, progressType, {}, progressSnapshot);
  }
}

function isProjectDiscoveryCurrent(teamId, requestId, syncVersionAtStart) {
  return (
    state.screen === "projects"
    && state.selectedTeamId === teamId
    && state.projectDiscoveryRequestId === requestId
    && state.projectSyncVersion === syncVersionAtStart
  );
}

async function abortProjectDiscoveryIfStale(
  render,
  teamId,
  requestId,
  syncVersionAtStart,
  beganProjectsPageSync = false,
  options = {},
) {
  if (isProjectDiscoveryCurrent(teamId, requestId, syncVersionAtStart)) {
    return false;
  }

  if (beganProjectsPageSync) {
    await completeProjectLoadPageSync({ render, options, clearNotice: false });
  } else {
    render?.();
  }
  return true;
}

async function repairProjectMetadataFromRemoteRename(selectedTeam, metadataRecords, remoteProjects, options = {}) {
  const remoteByRepoId = new Map(
    (Array.isArray(remoteProjects) ? remoteProjects : [])
      .filter((project) => Number.isFinite(project?.repoId))
      .map((project) => [project.repoId, project]),
  );
  const remoteByNodeId = new Map(
    (Array.isArray(remoteProjects) ? remoteProjects : [])
      .filter((project) => typeof project?.nodeId === "string" && project.nodeId.trim())
      .map((project) => [project.nodeId, project]),
  );
  const repairWrites = [];

  for (const record of Array.isArray(metadataRecords) ? metadataRecords : []) {
    if (record?.recordState !== "live" || record?.remoteState !== "linked") {
      continue;
    }

    const remoteProject =
      (Number.isFinite(record?.githubRepoId) ? remoteByRepoId.get(record.githubRepoId) : null)
      ?? ((typeof record?.githubNodeId === "string" && record.githubNodeId.trim()) ? remoteByNodeId.get(record.githubNodeId) : null)
      ?? null;
    if (!remoteProject) {
      continue;
    }

    const repoNameChanged = typeof remoteProject.name === "string" && remoteProject.name.trim() && remoteProject.name !== record.repoName;
    const fullNameChanged = typeof remoteProject.fullName === "string" && remoteProject.fullName.trim() && remoteProject.fullName !== record.fullName;
    const branchChanged = typeof remoteProject.defaultBranchName === "string" && remoteProject.defaultBranchName.trim() && remoteProject.defaultBranchName !== record.defaultBranch;
    if (!repoNameChanged && !fullNameChanged && !branchChanged) {
      continue;
    }

    const previousRepoNames = [
      ...(Array.isArray(record.previousRepoNames) ? record.previousRepoNames : []),
      ...(repoNameChanged ? [record.repoName] : []),
    ];
    repairWrites.push(
      options.upsertProjectMetadataRecord?.(selectedTeam, {
        projectId: record.id,
        title: record.title,
        repoName: remoteProject.name ?? record.repoName,
        previousRepoNames,
        githubRepoId: remoteProject.repoId ?? record.githubRepoId ?? null,
        githubNodeId: remoteProject.nodeId ?? record.githubNodeId ?? null,
        fullName: remoteProject.fullName ?? record.fullName ?? null,
        defaultBranch: remoteProject.defaultBranchName ?? record.defaultBranch ?? "main",
        lifecycleState: record.lifecycleState,
        remoteState: record.remoteState,
        recordState: record.recordState,
        deletedAt: record.deletedAt ?? null,
        chapterCount: Number.isFinite(record.chapterCount) ? record.chapterCount : 0,
      }).catch(() => null),
    );
  }

  if (repairWrites.length > 0) {
    await Promise.all(repairWrites);
    return true;
  }

  return false;
}

async function finalizeMissingProjectsForTeam(selectedTeam, metadataRecords, remoteProjects, options = {}) {
  const missingRecords = findConfirmedMissingProjectRecords(metadataRecords, remoteProjects);
  if (!Number.isFinite(selectedTeam?.installationId) || missingRecords.length === 0) {
    return metadataRecords;
  }

  const deletedAt = new Date().toISOString();

  for (const record of missingRecords) {
    await options.upsertProjectMetadataRecord?.(selectedTeam, {
      projectId: record.id,
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
      lifecycleState: "softDeleted",
      remoteState: "deleted",
      recordState: "tombstone",
      deletedAt,
      chapterCount: Number.isFinite(record.chapterCount) ? record.chapterCount : 0,
    }, { requirePushSuccess: true });

    try {
      await options.purgeLocalProjectRepo?.(selectedTeam, record.repoName, record.id);
    } catch {}
  }

  const reloadMetadataRecords =
    typeof options.listProjectMetadataRecords === "function"
      ? options.listProjectMetadataRecords
      : listProjectMetadataRecords;
  return reloadMetadataRecords(selectedTeam).catch(() => metadataRecords);
}

function mergeProjectsWithLocalFiles(snapshot, listings = [], targets = [], options = {}) {
  const normalizeListedChapter =
    typeof options?.normalizeListedChapter === "function"
      ? options.normalizeListedChapter
      : (chapter) => chapter;
  const selectedTeam = options?.selectedTeam ?? null;
  const listingByProjectId = new Map();
  const listingByRepoName = new Map();
  const targetProjectIds = new Set();
  const targetRepoNames = new Set();

  for (const target of Array.isArray(targets) ? targets : []) {
    if (typeof target?.id === "string" && target.id.trim()) {
      targetProjectIds.add(target.id);
    }
    if (typeof target?.name === "string" && target.name.trim()) {
      targetRepoNames.add(target.name);
    }
  }

  for (const listing of Array.isArray(listings) ? listings : []) {
    if (!listing || typeof listing !== "object") {
      continue;
    }

    const normalizedChapters = Array.isArray(listing.chapters)
      ? listing.chapters.map(normalizeListedChapter).filter(Boolean)
      : [];
    clearRestoredLocalHardDeleteTombstones(selectedTeam, "chapter", normalizedChapters, {
      isActive: (chapter) => chapter?.status !== "deleted",
    });
    const visibleChapters = filterLocalHardDeletedResources(selectedTeam, "chapter", normalizedChapters, {
      isDeleted: (chapter) => chapter?.status === "deleted",
    });

    if (typeof listing.projectId === "string" && listing.projectId.trim()) {
      listingByProjectId.set(listing.projectId, visibleChapters);
    }
    if (typeof listing.repoName === "string" && listing.repoName.trim()) {
      listingByRepoName.set(listing.repoName, visibleChapters);
    }
  }

  const applyToProject = (project) => {
    const isTargeted = targetProjectIds.has(project.id) || targetRepoNames.has(project.name);
    if (!isTargeted) {
      return project;
    }
    if (project?.recordState === "tombstone" || project?.remoteState === "deleted") {
      return {
        ...project,
        chapters: [],
      };
    }

    const chapters =
      listingByProjectId.get(project.id)
      ?? listingByRepoName.get(project.name)
      ?? [];
    return {
      ...project,
      chapters,
    };
  };

  return {
    items: snapshot.items.map(applyToProject),
    deletedItems: snapshot.deletedItems.map(applyToProject),
  };
}

async function repairAutoRepairableRepoIssuesAndRescan(selectedTeam, repairIssues) {
  if (!Array.isArray(repairIssues) || repairIssues.length === 0) {
    return repairIssues;
  }

  await repairAutoRepairableRepoBindings(selectedTeam, repairIssues);
  const refreshedRepairResult = await inspectAndMigrateLocalRepoBindings(selectedTeam).catch(() => null);
  return refreshedRepairResult?.issues ?? repairIssues;
}

async function refreshRepoRepairIssuesAfterSync(selectedTeam, repairIssues) {
  const refreshedRepairResult = await inspectAndMigrateLocalRepoBindings(selectedTeam).catch(() => null);
  if (!refreshedRepairResult) {
    return {
      repairLoaded: false,
      repairIssues,
    };
  }

  return {
    repairLoaded: true,
    repairIssues: await repairAutoRepairableRepoIssuesAndRescan(
      selectedTeam,
      refreshedRepairResult.issues ?? [],
    ),
  };
}

async function purgeTombstonedProjectsForTeam(selectedTeam, projects, metadataRecords, options = {}) {
  const visibleProjects = Array.isArray(projects) ? projects : [];
  const tombstoneRecords = (Array.isArray(metadataRecords) ? metadataRecords : []).filter(options.projectMetadataRecordIsTombstone);
  if (!selectedTeam?.installationId || tombstoneRecords.length === 0) {
    return;
  }

  const purgedProjectIds = new Set();
  for (const record of tombstoneRecords) {
    if (typeof record?.id === "string" && record.id.trim() && purgedProjectIds.has(record.id.trim())) {
      continue;
    }

    if (typeof record?.repoName === "string" && record.repoName.trim()) {
      try {
        await options.purgeLocalProjectRepo(selectedTeam, record.repoName, record.id ?? null);
      } catch {}
    }

    for (const project of visibleProjects) {
      if (!project || purgedProjectIds.has(project.id)) {
        continue;
      }
      if (!options.projectMatchesMetadataRecord(project, record)) {
        continue;
      }

      options.removeVisibleProject(project.id);
      options.clearSelectedProjectState(project);
      options.dropProjectMutationsForProject(selectedTeam, project.id);
      options.removeProjectRepoSyncState?.(project.id);
      purgedProjectIds.add(project.id);
    }

    if (typeof record?.id === "string" && record.id.trim()) {
      purgedProjectIds.add(record.id.trim());
    }
  }

  if (purgedProjectIds.size > 0) {
    options.persistProjectsForTeam(selectedTeam);
  }
}

async function loadLocalProjectFileListings(selectedTeam, projects) {
  if (!Number.isFinite(selectedTeam?.installationId) || !Array.isArray(projects) || projects.length === 0) {
    return [];
  }

  const repoWriteWait = Promise.all(
    projects.map((project) =>
      waitForRepoWriteQueueIdle(projectRepoScope({ team: selectedTeam, project })),
    ),
  );
  await Promise.race([
    repoWriteWait,
    new Promise((resolve) => {
      globalThis.setTimeout(resolve, LOCAL_PROJECT_FILE_LISTING_REPO_WAIT_MS);
    }),
  ]);

  const listings = await invoke("list_local_gtms_project_files", {
    input: {
      installationId: selectedTeam.installationId,
      projects: projects.map((project) => ({
        projectId: project.id,
        repoName: project.name,
      })),
    },
  });

  return Array.isArray(listings) ? listings : [];
}

export async function loadLocalProjectSnapshotForTeam(selectedTeam, options = {}) {
  const listLocalMetadata =
    typeof options.listLocalProjectMetadataRecords === "function"
      ? options.listLocalProjectMetadataRecords
      : listLocalProjectMetadataRecords;
  const loadPendingMutations =
    typeof options.loadStoredChapterPendingMutations === "function"
      ? options.loadStoredChapterPendingMutations
      : loadStoredChapterPendingMutations;
  const metadataRecords = await listLocalMetadata(selectedTeam);
  const pendingChapterMutations = loadPendingMutations(selectedTeam);
  const localProjects = mergeMetadataDiscoveryProjects({
    metadataRecords,
    remoteProjects: [],
    localProjects: [],
    metadataLoaded: true,
    remoteLoaded: false,
    repairLoaded: false,
    repairIssues: [],
  });
  const baseSnapshot = {
    items: localProjects.filter((project) => project.lifecycleState !== "deleted"),
    deletedItems: localProjects.filter((project) => project.lifecycleState === "deleted"),
  };
  const localFileListings = await loadLocalProjectFileListings(
    selectedTeam,
    localProjects.filter((project) =>
      project?.lifecycleState !== "deleted"
      && project?.recordState !== "tombstone"
    ),
  );
  const localSnapshot = mergeProjectsWithLocalFiles(
    baseSnapshot,
    localFileListings,
    localProjects,
    { ...options, selectedTeam },
  );

  const filteredSnapshot = applyLocalProjectHardDeleteState(selectedTeam, {
    ...localSnapshot,
  });
  return {
    ...applyPendingMutations(
      filteredSnapshot,
      pendingChapterMutations,
      options.applyChapterPendingMutation,
    ),
    pendingChapterMutations,
  };
}

async function loadAvailableGlossariesForTeam(selectedTeam) {
  if (!Number.isFinite(selectedTeam?.installationId)) {
    return {
      glossaries: [],
      syncIssue: "",
      brokerWarning: "",
    };
  }

  const { glossaries, syncIssue = "", brokerWarning = "" } = await loadRepoBackedGlossariesForTeam(selectedTeam, {
    offlineMode: state.offline?.isEnabled === true,
  });
  const syncIssueMessage =
    typeof syncIssue?.message === "string"
      ? syncIssue.message
      : typeof syncIssue === "string"
        ? syncIssue
        : "";

  return {
    glossaries,
    syncIssue: syncIssueMessage,
    brokerWarning,
  };
}

export async function refreshProjectFilesFromDisk(render, selectedTeam, projects, options = {}) {
  const targetProjects = Array.isArray(projects) ? projects : [];
  const baseSnapshot =
    options.baseSnapshot
    && Array.isArray(options.baseSnapshot.items)
    && Array.isArray(options.baseSnapshot.deletedItems)
      ? options.baseSnapshot
      : {
          items: targetProjects.filter((project) => project?.lifecycleState !== "deleted"),
          deletedItems: targetProjects.filter((project) => project?.lifecycleState === "deleted"),
        };
  if (!Number.isFinite(selectedTeam?.installationId) || targetProjects.length === 0) {
    return baseSnapshot;
  }

  const listings = await loadLocalProjectFileListings(selectedTeam, targetProjects);
  const mergedSnapshot = mergeProjectsWithLocalFiles(baseSnapshot, listings, targetProjects, {
    normalizeListedChapter: options.normalizeListedChapter,
    selectedTeam,
  });
  const pendingChapterMutations = Array.isArray(options.pendingChapterMutations)
    ? options.pendingChapterMutations
    : state.pendingChapterMutations;
  const nextSnapshot = applyPendingMutations(
    mergedSnapshot,
    pendingChapterMutations,
    options.applyChapterPendingMutation,
  );
  const preservedSnapshot =
    typeof options.preserveProjectLifecyclePatches === "function"
      ? options.preserveProjectLifecyclePatches(nextSnapshot)
      : nextSnapshot;
  publishProjectLoadSnapshot({
    render,
    selectedTeam,
    snapshot: preservedSnapshot,
    options,
    pendingChapterMutations,
    repoSyncByProjectId:
      options.repoSyncByProjectId && typeof options.repoSyncByProjectId === "object"
        ? options.repoSyncByProjectId
        : {},
    persist: true,
  });
  return preservedSnapshot;
}

export async function loadProjectSnapshotForTeam(render, teamId = state.selectedTeamId, options = {}) {
  const selectedTeam = state.teams.find((team) => team.id === teamId);
  const syncVersionAtStart = state.projectSyncVersion;
  const requestId = nextProjectDiscoveryRequestId();
  let pendingChapterMutations = [];
  let repoSyncByProjectId = {};
  let currentLoadResult = createProjectLoadResult();
  emitProjectLoadProgress(options, "started", {}, currentLoadResult);

  if (!selectedTeam?.installationId) {
    currentLoadResult = publishProjectLoadSnapshot({
      render,
      selectedTeam,
      snapshot: { items: [], deletedItems: [] },
      options,
      discovery: { status: "ready" },
      glossaries: [],
      pendingChapterMutations: [],
      repoSyncByProjectId: {},
      progressType: "empty",
    });
    return currentLoadResult;
  }

  pendingChapterMutations = loadStoredChapterPendingMutations(selectedTeam);
  const glossaryLoadPromise = loadAvailableGlossariesForTeam(selectedTeam);

  if (state.offline.isEnabled) {
    const cachedProjects = options.loadStoredProjectsForTeam(selectedTeam);
    const optimisticSnapshot = applyPendingMutations(
      {
        items: cachedProjects.projects,
        deletedItems: cachedProjects.deletedProjects,
      },
      pendingChapterMutations,
      options.applyChapterPendingMutation,
    );
    const glossaryResult = await glossaryLoadPromise;
    if (await abortProjectDiscoveryIfStale(render, selectedTeam?.id ?? teamId, requestId, syncVersionAtStart)) {
      return currentLoadResult;
    }
    const preservedSnapshot =
      typeof options.preserveProjectLifecyclePatches === "function"
        ? options.preserveProjectLifecyclePatches(optimisticSnapshot)
        : optimisticSnapshot;
    currentLoadResult = publishProjectLoadSnapshot({
      render,
      selectedTeam,
      snapshot: applyLocalProjectHardDeleteState(selectedTeam, preservedSnapshot),
      options,
      previousResult: currentLoadResult,
      glossaries: glossaryResult?.glossaries ?? [],
      pendingChapterMutations,
      repoSyncByProjectId: {},
      discovery: {
        status: "ready",
        glossaryWarning: glossaryResult?.syncIssue || glossaryResult?.brokerWarning || "",
      },
      progressType: "offlineSnapshot",
    });
    return currentLoadResult;
  }

  let renderedLocalProjects = false;
  let localProjectSnapshot = { items: [], deletedItems: [] };
  try {
    const localSnapshot = await loadLocalProjectSnapshotForTeam(selectedTeam, {
      ...options,
      loadStoredChapterPendingMutations,
    });
    if (await abortProjectDiscoveryIfStale(render, selectedTeam.id, requestId, syncVersionAtStart)) {
      return currentLoadResult;
    }
    pendingChapterMutations = localSnapshot.pendingChapterMutations;
    const preservedSnapshot =
      typeof options.preserveProjectLifecyclePatches === "function"
        ? options.preserveProjectLifecyclePatches(localSnapshot)
        : localSnapshot;
    localProjectSnapshot = {
      items: Array.isArray(preservedSnapshot.items) ? preservedSnapshot.items : [],
      deletedItems: Array.isArray(preservedSnapshot.deletedItems) ? preservedSnapshot.deletedItems : [],
    };
    const hasLocalProjects =
      localProjectSnapshot.items.length > 0 || localProjectSnapshot.deletedItems.length > 0;
    currentLoadResult = publishProjectLoadSnapshot({
      render,
      selectedTeam,
      snapshot: localProjectSnapshot,
      options,
      previousResult: currentLoadResult,
      pendingChapterMutations,
      repoSyncByProjectId,
      discovery: { status: hasLocalProjects ? "ready" : "loading" },
      progressType: "localSnapshot",
    });
    renderedLocalProjects = hasLocalProjects;
  } catch {
    pendingChapterMutations = loadStoredChapterPendingMutations(selectedTeam);
    currentLoadResult = publishProjectLoadSnapshot({
      render,
      selectedTeam,
      snapshot: { items: [], deletedItems: [] },
      options,
      previousResult: currentLoadResult,
      pendingChapterMutations,
      repoSyncByProjectId,
      discovery: { status: "loading" },
      progressType: "localSnapshotError",
    });
  }
  if (await abortProjectDiscoveryIfStale(render, selectedTeam.id, requestId, syncVersionAtStart)) {
    return currentLoadResult;
  }
  clearNoticeBadge();
  options.setProjectUiDebug(render, "Loading projects from GitHub...");
  beginProjectLoadPageSync({ render, options, progressSnapshot: currentLoadResult });

  try {
    const [projectsResult, metadataResult, repairResult, glossaryDiscoveryResult] = await Promise.allSettled([
      invoke("list_gnosis_projects_for_installation", {
        installationId: selectedTeam.installationId,
        sessionToken: requireBrokerSession(),
      }),
      listProjectMetadataRecords(selectedTeam),
      inspectAndMigrateLocalRepoBindings(selectedTeam),
      glossaryLoadPromise,
    ]);
    if (
      await abortProjectDiscoveryIfStale(
        render,
        selectedTeam.id,
        requestId,
        syncVersionAtStart,
        true,
        options,
      )
    ) {
      return currentLoadResult;
    }
    let remoteProjects = projectsResult.status === "fulfilled"
      ? (Array.isArray(projectsResult.value) ? projectsResult.value : [])
      : [];
    const remoteLoaded = projectsResult.status === "fulfilled";
    let projectMetadataRecords =
      metadataResult.status === "fulfilled"
        ? metadataResult.value
        : [];
    const metadataLoaded = metadataResult.status === "fulfilled";
    let repairLoaded = repairResult.status === "fulfilled";
    let repairIssues =
      repairResult.status === "fulfilled"
        ? repairResult.value?.issues ?? []
        : [];
    if (repairIssues.length > 0) {
      repairIssues = await repairAutoRepairableRepoIssuesAndRescan(selectedTeam, repairIssues);
    }
    if (remoteLoaded && metadataLoaded) {
      const metadataRepaired = await repairProjectMetadataFromRemoteRename(
        selectedTeam,
        projectMetadataRecords,
        remoteProjects,
        options,
      );
      if (metadataRepaired) {
        projectMetadataRecords = await listProjectMetadataRecords(selectedTeam).catch(() => projectMetadataRecords);
      }
      projectMetadataRecords = await finalizeMissingProjectsForTeam(
        selectedTeam,
        projectMetadataRecords,
        remoteProjects,
        options,
      );
    }
    if (remoteLoaded && (!metadataLoaded || projectMetadataRecords.length === 0)) {
      remoteProjects = await filterKnownDeletedRemoteProjects(
        selectedTeam,
        remoteProjects,
        localProjectSnapshot,
        {
          ...options,
          visibleProjectSnapshot: currentLoadResult,
        },
      );
    }
    const recoverableMetadataCount = countRecoverableProjectMetadataRecords(projectMetadataRecords);
    if (
      projectsResult.status !== "fulfilled"
      && projectMetadataRecords.length === 0
      && localProjectSnapshot.items.length === 0
      && localProjectSnapshot.deletedItems.length === 0
    ) {
      throw projectsResult.reason;
    }
    const discoveredLocalProjects = [
      ...localProjectSnapshot.items,
      ...localProjectSnapshot.deletedItems,
    ].filter(Boolean);
    await purgeTombstonedProjectsForTeam(
      selectedTeam,
      discoveredLocalProjects,
      projectMetadataRecords,
      options,
    );
    if (
      await abortProjectDiscoveryIfStale(
        render,
        selectedTeam.id,
        requestId,
        syncVersionAtStart,
        true,
        options,
      )
    ) {
      return currentLoadResult;
    }
    if (syncVersionAtStart !== state.projectSyncVersion) {
      await completeProjectLoadPageSync({ render, options, progressSnapshot: currentLoadResult });
      return currentLoadResult;
    }
    const mergedProjects = mergeMetadataDiscoveryProjects({
      metadataRecords: projectMetadataRecords,
      remoteProjects,
      localProjects: discoveredLocalProjects,
      metadataLoaded,
      remoteLoaded,
      repairLoaded,
      repairIssues,
    });
    const nextVisibleProjects =
      mergedProjects.length > 0 || metadataLoaded || remoteLoaded
        ? mergedProjects
        : [...localProjectSnapshot.items, ...localProjectSnapshot.deletedItems];
    options.setProjectUiDebug(render, "Refreshing local project data...");
    let mappedProjects = nextVisibleProjects.map((project) => ({
      ...project,
      chapters: Array.isArray(project.chapters) ? project.chapters : [],
      remoteState: project.remoteState ?? "linked",
    }));
    const preSyncListings = await loadLocalProjectFileListings(
      selectedTeam,
      mappedProjects.filter((project) =>
        project?.lifecycleState !== "deleted"
        && project?.recordState !== "tombstone"
      ),
    );
    if (
      await abortProjectDiscoveryIfStale(
        render,
        selectedTeam.id,
        requestId,
        syncVersionAtStart,
        true,
        options,
      )
    ) {
      return currentLoadResult;
    }
    const installationRecoveryDetected =
      metadataLoaded
      && recoverableMetadataCount > 0
      && preSyncListings.length === 0;
    const recoveryMessage =
      installationRecoveryDetected && options.suppressRecoveryWarning !== true
        ? "Local installation data was missing. Rebuilding project repos from GitHub."
        : "";
    const nextSnapshot = applyPendingMutations(
      {
        items: mappedProjects.filter((project) => project.lifecycleState !== "deleted"),
        deletedItems: mappedProjects.filter((project) => project.lifecycleState === "deleted"),
      },
      pendingChapterMutations,
      options.applyChapterPendingMutation,
    );
    const preservedSnapshot =
      typeof options.preserveProjectLifecyclePatches === "function"
        ? options.preserveProjectLifecyclePatches(nextSnapshot)
        : nextSnapshot;
    const visibleSnapshot = applyLocalProjectHardDeleteState(selectedTeam, preservedSnapshot);
    mappedProjects = [...visibleSnapshot.items, ...visibleSnapshot.deletedItems];
    const glossaryWarning =
      glossaryDiscoveryResult.status === "fulfilled"
        ? glossaryDiscoveryResult.value?.syncIssue || glossaryDiscoveryResult.value?.brokerWarning || ""
        : glossaryDiscoveryResult.reason?.message ?? String(glossaryDiscoveryResult.reason ?? "");
    currentLoadResult = publishProjectLoadSnapshot({
      render,
      selectedTeam,
      snapshot: visibleSnapshot,
      options,
      previousResult: currentLoadResult,
      glossaries:
        glossaryDiscoveryResult.status === "fulfilled"
          ? glossaryDiscoveryResult.value?.glossaries ?? []
          : undefined,
      pendingChapterMutations,
      repoSyncByProjectId,
      discovery: {
        status: "ready",
        glossaryWarning,
        recoveryMessage,
      },
      progressType: "remoteSnapshot",
      persist: true,
    });
    await waitForNextPaint();
    if (
      await abortProjectDiscoveryIfStale(
        render,
        selectedTeam.id,
        requestId,
        syncVersionAtStart,
        true,
        options,
      )
    ) {
      return currentLoadResult;
    }
    await runTeamResourceMigrationSync(render, selectedTeam, { projects: mappedProjects });
    if (
      await abortProjectDiscoveryIfStale(
        render,
        selectedTeam.id,
        requestId,
        syncVersionAtStart,
        true,
        options,
      )
    ) {
      return currentLoadResult;
    }
    await reconcileProjectRepoSyncStates(render, selectedTeam, mappedProjects, {
      shouldAbort: () => !isProjectDiscoveryCurrent(selectedTeam.id, requestId, syncVersionAtStart),
      applySnapshots: (snapshots) => {
        repoSyncByProjectId = repoSyncSnapshotMap(snapshots);
        currentLoadResult = publishProjectLoadSnapshot({
          render,
          selectedTeam,
          snapshot: {
            items: mappedProjects.filter((project) => project.lifecycleState !== "deleted"),
            deletedItems: mappedProjects.filter((project) => project.lifecycleState === "deleted"),
          },
          options,
          previousResult: currentLoadResult,
          pendingChapterMutations,
          repoSyncByProjectId,
          progressType: "repoSyncSnapshot",
        });
      },
      mergeSnapshots: (snapshots) => {
        repoSyncByProjectId = {
          ...repoSyncByProjectId,
          ...repoSyncSnapshotMap(snapshots),
        };
        currentLoadResult = publishProjectLoadSnapshot({
          render,
          selectedTeam,
          snapshot: {
            items: mappedProjects.filter((project) => project.lifecycleState !== "deleted"),
            deletedItems: mappedProjects.filter((project) => project.lifecycleState === "deleted"),
          },
          options,
          previousResult: currentLoadResult,
          pendingChapterMutations,
          repoSyncByProjectId,
          progressType: "repoSyncProgress",
        });
      },
    });
    if (
      await abortProjectDiscoveryIfStale(
        render,
        selectedTeam.id,
        requestId,
        syncVersionAtStart,
        true,
        options,
      )
    ) {
      return currentLoadResult;
    }
    const refreshedRepairScan = await refreshRepoRepairIssuesAfterSync(selectedTeam, repairIssues);
    if (refreshedRepairScan.repairLoaded) {
      repairLoaded = true;
      repairIssues = refreshedRepairScan.repairIssues;
      const repairedMergedProjects = mergeMetadataDiscoveryProjects({
        metadataRecords: projectMetadataRecords,
        remoteProjects,
        localProjects: discoveredLocalProjects,
        metadataLoaded,
        remoteLoaded,
        repairLoaded,
        repairIssues,
      });
      const repairedVisibleProjects =
        repairedMergedProjects.length > 0 || metadataLoaded || remoteLoaded
          ? repairedMergedProjects
          : [...localProjectSnapshot.items, ...localProjectSnapshot.deletedItems];
      mappedProjects = repairedVisibleProjects.map((project) => ({
        ...project,
        chapters: Array.isArray(project.chapters) ? project.chapters : [],
        remoteState: project.remoteState ?? "linked",
      }));
      const repairedSnapshot = applyPendingMutations(
        {
          items: mappedProjects.filter((project) => project.lifecycleState !== "deleted"),
          deletedItems: mappedProjects.filter((project) => project.lifecycleState === "deleted"),
        },
        pendingChapterMutations,
        options.applyChapterPendingMutation,
      );
      const preservedRepairedSnapshot =
        typeof options.preserveProjectLifecyclePatches === "function"
          ? options.preserveProjectLifecyclePatches(repairedSnapshot)
          : repairedSnapshot;
      const visibleRepairedSnapshot = applyLocalProjectHardDeleteState(selectedTeam, preservedRepairedSnapshot);
      mappedProjects = [...visibleRepairedSnapshot.items, ...visibleRepairedSnapshot.deletedItems];
      currentLoadResult = publishProjectLoadSnapshot({
        render,
        selectedTeam,
        snapshot: visibleRepairedSnapshot,
        options,
        previousResult: currentLoadResult,
        pendingChapterMutations,
        repoSyncByProjectId,
        progressType: "repairSnapshot",
        persist: true,
      });
    }
    if (
      await abortProjectDiscoveryIfStale(
        render,
        selectedTeam.id,
        requestId,
        syncVersionAtStart,
        true,
        options,
      )
    ) {
      return currentLoadResult;
    }
    const refreshedProjectFilesSnapshot = await refreshProjectFilesFromDisk(
      render,
      selectedTeam,
      mappedProjects,
      {
        ...options,
        baseSnapshot: currentLoadResult,
        pendingChapterMutations,
        repoSyncByProjectId,
      },
    );
    currentLoadResult = createProjectLoadResult({
      snapshot: refreshedProjectFilesSnapshot,
      pendingChapterMutations,
      repoSyncByProjectId,
      previousResult: currentLoadResult,
    });
    if (
      await abortProjectDiscoveryIfStale(
        render,
        selectedTeam.id,
        requestId,
        syncVersionAtStart,
        true,
        options,
      )
    ) {
      return currentLoadResult;
    }
    options.clearProjectUiDebug(render);
    await completeProjectLoadPageSync({
      render,
      options,
      progressType: "repoSyncComplete",
      progressSnapshot: currentLoadResult,
    });
    if (glossaryDiscoveryResult.status === "rejected" && glossaryWarning) {
      showNoticeBadge(glossaryWarning, render, 3200);
    }
  } catch (error) {
    if (
      !isProjectDiscoveryCurrent(selectedTeam?.id ?? teamId, requestId, syncVersionAtStart)
      && await abortProjectDiscoveryIfStale(
        render,
        selectedTeam?.id ?? teamId,
        requestId,
        syncVersionAtStart,
        true,
        options,
      )
    ) {
      return currentLoadResult;
    }

    if (
      await handleSyncFailure(classifySyncError(error), {
        render,
        teamId: selectedTeam?.id ?? null,
        currentResource: true,
      })
    ) {
      failProjectLoadPageSync({ options, progressSnapshot: currentLoadResult });
      return currentLoadResult;
    }

    if (syncVersionAtStart !== state.projectSyncVersion) {
      failProjectLoadPageSync({
        render,
        options,
        renderAfterFail: true,
        progressSnapshot: currentLoadResult,
      });
      return currentLoadResult;
    }

    options.clearProjectUiDebug(render);
    failProjectLoadPageSync({ options, clearNotice: true, progressSnapshot: currentLoadResult });
    if (!renderedLocalProjects) {
      currentLoadResult = publishProjectLoadSnapshot({
        render,
        selectedTeam,
        snapshot: { items: [], deletedItems: [] },
        options,
        previousResult: currentLoadResult,
        discovery: {
          status: "error",
          error: error?.message ?? String(error),
        },
        progressType: "error",
        progressPayload: { error },
      });
    } else {
      currentLoadResult = publishProjectDiscoveryState({
        render,
        options,
        discovery: { status: "ready" },
        previousResult: currentLoadResult,
        progressType: "error",
        progressPayload: { error },
      });
    }
  }
  return currentLoadResult;
}
