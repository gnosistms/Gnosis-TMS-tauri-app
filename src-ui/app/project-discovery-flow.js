import { invoke, waitForNextPaint } from "./runtime.js";
import { requireBrokerSession } from "./auth-flow.js";
import {
  beginProjectsPageSync,
  completeProjectsPageSync,
  failProjectsPageSync,
} from "./page-sync.js";
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
  listProjectMetadataRecords,
  repairAutoRepairableRepoBindings,
} from "./team-metadata-flow.js";
import {
  applyProjectSnapshotToState,
} from "./project-top-level-state.js";

function countRecoverableProjectMetadataRecords(records) {
  return (Array.isArray(records) ? records : []).filter((record) =>
    record?.recordState === "live"
    && record?.remoteState === "linked"
    && record?.lifecycleState === "active"
  ).length;
}

function nextProjectDiscoveryRequestId() {
  const nextId = Number.isInteger(state.projectDiscoveryRequestId)
    ? state.projectDiscoveryRequestId + 1
    : 1;
  state.projectDiscoveryRequestId = nextId;
  return nextId;
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
) {
  if (isProjectDiscoveryCurrent(teamId, requestId, syncVersionAtStart)) {
    return false;
  }

  if (beganProjectsPageSync) {
    await completeProjectsPageSync(render);
  }
  render?.();
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

    if (typeof listing.projectId === "string" && listing.projectId.trim()) {
      listingByProjectId.set(listing.projectId, normalizedChapters);
    }
    if (typeof listing.repoName === "string" && listing.repoName.trim()) {
      listingByRepoName.set(listing.repoName, normalizedChapters);
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
      delete state.projectRepoSyncByProjectId[project.id];
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

async function loadAvailableGlossariesForTeam(selectedTeam, teamIdAtStart = selectedTeam?.id) {
  if (!Number.isFinite(selectedTeam?.installationId)) {
    if (state.selectedTeamId === teamIdAtStart) {
      state.glossaries = [];
    }
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

  if (state.selectedTeamId === teamIdAtStart) {
    state.glossaries = glossaries;
  }

  return {
    glossaries,
    syncIssue: syncIssueMessage,
    brokerWarning,
  };
}

export async function refreshProjectFilesFromDisk(render, selectedTeam, projects, options = {}) {
  const baseSnapshot = {
    items: state.projects,
    deletedItems: state.deletedProjects,
  };
  const targetProjects = Array.isArray(projects) ? projects : [];
  if (!Number.isFinite(selectedTeam?.installationId) || targetProjects.length === 0) {
    return baseSnapshot;
  }

  const listings = await loadLocalProjectFileListings(selectedTeam, targetProjects);
  const mergedSnapshot = mergeProjectsWithLocalFiles(baseSnapshot, listings, targetProjects, {
    normalizeListedChapter: options.normalizeListedChapter,
  });
  const nextSnapshot = applyPendingMutations(
    mergedSnapshot,
    state.pendingChapterMutations,
    options.applyChapterPendingMutation,
  );
  const preservedSnapshot =
    typeof options.preserveProjectLifecyclePatches === "function"
      ? options.preserveProjectLifecyclePatches(nextSnapshot)
      : nextSnapshot;
  applyProjectSnapshotToState(preservedSnapshot, {
    reconcileExpandedDeletedFiles: options.reconcileExpandedDeletedFiles,
  });
  options.persistProjectsForTeam(selectedTeam);
  render();
  return preservedSnapshot;
}

export async function loadTeamProjects(render, teamId = state.selectedTeamId, options = {}) {
  const selectedTeam = state.teams.find((team) => team.id === teamId);
  const syncVersionAtStart = state.projectSyncVersion;
  const requestId = nextProjectDiscoveryRequestId();
  state.projectRepoSyncByProjectId = {};

  if (!selectedTeam?.installationId) {
    state.pendingChapterMutations = [];
    state.projectRepoSyncByProjectId = {};
    applyProjectSnapshotToState({ items: [], deletedItems: [] }, {
      reconcileExpandedDeletedFiles: options.reconcileExpandedDeletedFiles,
    });
    options.setProjectDiscoveryState("ready", "", "");
    render();
    return;
  }

  const cachedProjects = options.loadStoredProjectsForTeam(selectedTeam);
  state.pendingChapterMutations = loadStoredChapterPendingMutations(selectedTeam);
  const optimisticSnapshot = applyPendingMutations(
    {
      items: cachedProjects.projects,
      deletedItems: cachedProjects.deletedProjects,
    },
    state.pendingChapterMutations,
    options.applyChapterPendingMutation,
  );
  const glossaryLoadPromise = loadAvailableGlossariesForTeam(selectedTeam, teamId);

  if (state.offline.isEnabled) {
    const glossaryResult = await glossaryLoadPromise;
    if (await abortProjectDiscoveryIfStale(render, selectedTeam?.id ?? teamId, requestId, syncVersionAtStart)) {
      return;
    }
    state.projectRepoSyncByProjectId = {};
    const preservedSnapshot =
      typeof options.preserveProjectLifecyclePatches === "function"
        ? options.preserveProjectLifecyclePatches(optimisticSnapshot)
        : optimisticSnapshot;
    applyProjectSnapshotToState(preservedSnapshot, {
      reconcileExpandedDeletedFiles: options.reconcileExpandedDeletedFiles,
    });
    options.setProjectDiscoveryState(
      "ready",
      "",
      glossaryResult?.syncIssue || glossaryResult?.brokerWarning || "",
    );
    render();
    return;
  }

  if (cachedProjects.exists) {
    const preservedSnapshot =
      typeof options.preserveProjectLifecyclePatches === "function"
        ? options.preserveProjectLifecyclePatches(optimisticSnapshot)
        : optimisticSnapshot;
    applyProjectSnapshotToState(preservedSnapshot, {
      reconcileExpandedDeletedFiles: options.reconcileExpandedDeletedFiles,
    });
    options.setProjectDiscoveryState("ready", "", "", "");
  } else {
    applyProjectSnapshotToState({ items: [], deletedItems: [] }, {
      reconcileExpandedDeletedFiles: options.reconcileExpandedDeletedFiles,
    });
    options.setProjectDiscoveryState("loading", "", "", "");
  }
  if (await abortProjectDiscoveryIfStale(render, selectedTeam.id, requestId, syncVersionAtStart)) {
    return;
  }
  options.setProjectUiDebug(render, "Refreshing projects...");
  showNoticeBadge("Loading projects from GitHub...", render, null);
  beginProjectsPageSync();
  render();

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
      )
    ) {
      return;
    }
    const remoteProjects = projectsResult.status === "fulfilled"
      ? (Array.isArray(projectsResult.value) ? projectsResult.value : [])
      : [];
    const remoteLoaded = projectsResult.status === "fulfilled";
    let projectMetadataRecords =
      metadataResult.status === "fulfilled"
        ? metadataResult.value
        : [];
    const metadataLoaded = metadataResult.status === "fulfilled";
    const repairLoaded = repairResult.status === "fulfilled";
    let repairIssues =
      repairResult.status === "fulfilled"
        ? repairResult.value?.issues ?? []
        : [];
    if (repairIssues.length > 0) {
      await repairAutoRepairableRepoBindings(selectedTeam, repairIssues);
      const refreshedRepairResult = await inspectAndMigrateLocalRepoBindings(selectedTeam).catch(() => null);
      repairIssues = refreshedRepairResult?.issues ?? repairIssues;
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
    const recoverableMetadataCount = countRecoverableProjectMetadataRecords(projectMetadataRecords);
    if (
      projectsResult.status !== "fulfilled"
      && projectMetadataRecords.length === 0
      && !cachedProjects.exists
      && optimisticSnapshot.items.length === 0
      && optimisticSnapshot.deletedItems.length === 0
    ) {
      throw projectsResult.reason;
    }
    const discoveredLocalProjects = [
      ...optimisticSnapshot.items,
      ...optimisticSnapshot.deletedItems,
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
      )
    ) {
      return;
    }
    if (syncVersionAtStart !== state.projectSyncVersion) {
      await completeProjectsPageSync(render);
      clearNoticeBadge();
      render();
      return;
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
        : [...optimisticSnapshot.items, ...optimisticSnapshot.deletedItems];
    showNoticeBadge("Refreshing local project data...", render, null);
    const mappedProjects = nextVisibleProjects.map((project) => ({
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
      )
    ) {
      return;
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
      state.pendingChapterMutations,
      options.applyChapterPendingMutation,
    );
    const preservedSnapshot =
      typeof options.preserveProjectLifecyclePatches === "function"
        ? options.preserveProjectLifecyclePatches(nextSnapshot)
        : nextSnapshot;
    applyProjectSnapshotToState(preservedSnapshot, {
      reconcileExpandedDeletedFiles: options.reconcileExpandedDeletedFiles,
    });
    options.persistProjectsForTeam(selectedTeam);
    const glossaryWarning =
      glossaryDiscoveryResult.status === "fulfilled"
        ? glossaryDiscoveryResult.value?.syncIssue || glossaryDiscoveryResult.value?.brokerWarning || ""
        : glossaryDiscoveryResult.reason?.message ?? String(glossaryDiscoveryResult.reason ?? "");
    options.setProjectDiscoveryState("ready", "", glossaryWarning, recoveryMessage);
    render();
    await waitForNextPaint();
    if (
      await abortProjectDiscoveryIfStale(
        render,
        selectedTeam.id,
        requestId,
        syncVersionAtStart,
        true,
      )
    ) {
      return;
    }
    showNoticeBadge("Rebuilding local project repo state...", render, null);
    await reconcileProjectRepoSyncStates(render, selectedTeam, mappedProjects, {
      shouldAbort: () => !isProjectDiscoveryCurrent(selectedTeam.id, requestId, syncVersionAtStart),
    });
    if (
      await abortProjectDiscoveryIfStale(
        render,
        selectedTeam.id,
        requestId,
        syncVersionAtStart,
        true,
      )
    ) {
      return;
    }
    await refreshProjectFilesFromDisk(
      render,
      selectedTeam,
      mappedProjects,
      options,
    );
    if (
      await abortProjectDiscoveryIfStale(
        render,
        selectedTeam.id,
        requestId,
        syncVersionAtStart,
        true,
      )
    ) {
      return;
    }
    options.clearProjectUiDebug(render);
    await completeProjectsPageSync(render);
    clearNoticeBadge();
    render();
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
      )
    ) {
      return;
    }

    if (
      await handleSyncFailure(classifySyncError(error), {
        render,
        teamId: selectedTeam?.id ?? null,
        currentResource: true,
      })
    ) {
      failProjectsPageSync();
      return;
    }

    if (syncVersionAtStart !== state.projectSyncVersion) {
      failProjectsPageSync();
      render();
      return;
    }

    if (!cachedProjects.exists) {
      applyProjectSnapshotToState({ items: [], deletedItems: [] }, {
        reconcileExpandedDeletedFiles: options.reconcileExpandedDeletedFiles,
      });
      options.setProjectDiscoveryState("error", error?.message ?? String(error), "");
    } else {
      options.setProjectDiscoveryState("ready", "", "");
    }
    options.clearProjectUiDebug(render);
    failProjectsPageSync();
    clearNoticeBadge();
    render();
  }
}

export async function loadRepoBackedProjectsForTeam(selectedTeam, options = {}) {
  const teamId = selectedTeam?.id ?? state.selectedTeamId;
  await loadTeamProjects(options.render, teamId, options);
  if (state.selectedTeamId !== teamId) {
    throw new Error("Stale project refresh ignored.");
  }
  return {
    items: state.projects,
    deletedItems: state.deletedProjects,
    repoSyncByProjectId: state.projectRepoSyncByProjectId,
    glossaries: state.glossaries,
    pendingChapterMutations: state.pendingChapterMutations,
    discovery: state.projectDiscovery,
  };
}
