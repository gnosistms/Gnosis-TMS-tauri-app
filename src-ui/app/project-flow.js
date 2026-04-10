import { invoke, waitForNextPaint } from "./runtime.js";
import { requireBrokerSession } from "./auth-flow.js";
import {
  beginProjectsPageSync,
  completeProjectsPageSync,
  failProjectsPageSync,
} from "./page-sync.js";
import {
  loadStoredChapterPendingMutations,
  loadStoredProjectPendingMutations,
  saveStoredChapterPendingMutations,
  loadStoredProjectsForTeam,
  saveStoredProjectPendingMutations,
  saveStoredProjectsForTeam,
} from "./project-cache.js";
import {
  applyPendingMutations,
  removeItem,
  removePendingMutation,
  replaceItem,
  upsertPendingMutation,
} from "./optimistic-collection.js";
import { loadRepoBackedGlossariesForTeam } from "./glossary-repo-flow.js";
import {
  resetChapterGlossaryConflict,
  resetChapterPermanentDeletion,
  resetChapterRename,
  resetProjectCreation,
  resetProjectPermanentDeletion,
  resetProjectRename,
  state,
} from "./state.js";
import { reconcileProjectRepoSyncStates } from "./project-repo-sync-flow.js";
import { clearScopedSyncBadge, showNoticeBadge, showScopedSyncBadge } from "./status-feedback.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";
import { createUniqueRepoWithNumericSuffix } from "./repo-creation.js";
import { appendRepoNameSuffix, slugifyRepoName } from "./repo-names.js";
import { mergeMetadataDiscoveryProjects } from "./project-discovery.js";
import {
  deleteProjectMetadataRecord,
  inspectAndMigrateLocalRepoBindings,
  listProjectMetadataRecords,
  lookupLocalMetadataTombstone,
  repairAutoRepairableRepoBindings,
  repairLocalRepoBinding,
  upsertProjectMetadataRecord,
} from "./team-metadata-flow.js";
import {
  processQueuedResourceMutations,
} from "./resource-top-level-mutations.js";
import {
  applyOptimisticPermanentDelete,
  commitMetadataFirstTopLevelMutation,
  ensureResourceNotTombstoned,
  guardPermanentDeleteConfirmation,
  guardTopLevelResourceAction,
  rollbackOptimisticPermanentDelete,
  runPermanentDeleteLocalFirst,
  showPermanentDeleteFollowupNotice,
} from "./resource-lifecycle-engine.js";
import {
  openTopLevelRenameModal,
  submitSimpleTopLevelMutation,
  submitTopLevelRename,
} from "./resource-top-level-controller.js";
import {
  applyProjectPendingMutation,
  applyProjectSnapshotToState,
  projectSnapshotFromState,
  rollbackVisibleProjectMutation,
  sortProjectSnapshot,
} from "./project-top-level-state.js";
import {
  canCreateRepoResources,
  canPermanentlyDeleteProjectFiles,
} from "./resource-capabilities.js";
import {
  beginEntityModalSubmit,
  cancelEntityModal,
  entityConfirmationMatches,
  openEntityFormModal,
  openEntityConfirmationModal,
  openEntityRenameModal,
  reopenEntityConfirmationModalWithError,
  updateEntityModalConfirmation,
  updateEntityFormField,
  updateEntityModalName,
} from "./resource-entity-modal.js";
import {
  autoResumePendingResources,
  resumePendingResourceSetup,
} from "./resource-pending-create.js";
import {
  finalizeLocalFirstCreate,
  guardResourceCreateStart,
  runLocalFirstCreate,
} from "./resource-create-flow.js";

function setProjectUiDebug(render, text) {
  showScopedSyncBadge("projects", text, render);
}

function clearProjectUiDebug(render) {
  clearScopedSyncBadge("projects", render);
}

function setProjectDiscoveryError(render, error) {
  state.projectDiscovery = {
    status: "error",
    error,
    glossaryWarning: state.projectDiscovery?.glossaryWarning ?? "",
    recoveryMessage: state.projectDiscovery?.recoveryMessage ?? "",
  };
  render?.();
}

function setProjectDiscoveryState(
  status,
  error = "",
  glossaryWarning = state.projectDiscovery?.glossaryWarning ?? "",
  recoveryMessage = state.projectDiscovery?.recoveryMessage ?? "",
) {
  state.projectDiscovery = {
    status,
    error,
    glossaryWarning,
    recoveryMessage,
  };
}

function selectedProjectsTeam() {
  return state.teams.find((team) => team.id === state.selectedTeamId) ?? null;
}

function countRecoverableProjectMetadataRecords(records) {
  return (Array.isArray(records) ? records : []).filter((record) =>
    record?.recordState === "live"
    && record?.remoteState === "linked"
    && record?.lifecycleState !== "purged"
  ).length;
}

async function repairProjectMetadataFromRemoteRename(selectedTeam, metadataRecords, remoteProjects) {
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
      upsertProjectMetadataRecord(selectedTeam, {
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

function ensureChapterMutationAllowed(
  render,
  { selectedTeam = selectedProjectsTeam(), actionLabel = "modify files", requireDelete = false } = {},
) {
  if (state.offline?.isEnabled === true) {
    setProjectDiscoveryError(render, `You cannot ${actionLabel} while offline.`);
    return false;
  }

  if (!Number.isFinite(selectedTeam?.installationId)) {
    setProjectDiscoveryError(render, "Could not determine the selected team.");
    return false;
  }

  if (requireDelete ? selectedTeam.canDelete !== true : selectedTeam.canManageProjects !== true) {
    setProjectDiscoveryError(
      render,
      `You do not have permission to ${actionLabel} in this team.`,
    );
    return false;
  }

  return true;
}

function persistProjectsForTeam(selectedTeam) {
  saveStoredProjectsForTeam(selectedTeam, {
    projects: state.projects,
    deletedProjects: state.deletedProjects,
  });
}

function projectLifecycleBlockedMessage(selectedTeam, actionLabel) {
  return selectedTeam?.canManageProjects === true
    ? ""
    : `You do not have permission to ${actionLabel} in this team.`;
}

function setProjectRepoSyncSnapshot(projectId, snapshot) {
  if (typeof projectId !== "string" || !projectId.trim()) {
    return;
  }

  state.projectRepoSyncByProjectId = {
    ...state.projectRepoSyncByProjectId,
    [projectId]: {
      projectId,
      ...(snapshot && typeof snapshot === "object" ? snapshot : {}),
    },
  };
}

function markProjectCreationInFlight(projectId) {
  if (typeof projectId !== "string" || !projectId.trim()) {
    return;
  }

  state.projectCreationInFlightIds = new Set([
    ...state.projectCreationInFlightIds,
    projectId,
  ]);
}

function clearProjectCreationInFlight(projectId) {
  if (typeof projectId !== "string" || !projectId.trim()) {
    return;
  }

  const nextIds = new Set(state.projectCreationInFlightIds);
  nextIds.delete(projectId);
  state.projectCreationInFlightIds = nextIds;
}

function persistChapterPendingMutationsForTeam(selectedTeam) {
  saveStoredChapterPendingMutations(selectedTeam, state.pendingChapterMutations);
}

function buildPendingProjectRecord(selectedTeam, projectTitle, repoName) {
  const orgLogin =
    typeof selectedTeam?.githubOrg === "string" && selectedTeam.githubOrg.trim()
      ? selectedTeam.githubOrg.trim()
      : "";
  const fullName = orgLogin ? `${orgLogin}/${repoName}` : repoName;

  return {
    id: crypto.randomUUID(),
    repoId: null,
    name: repoName,
    title: projectTitle,
    status: "active",
    fullName,
    htmlUrl: fullName ? `https://github.com/${fullName}` : null,
    private: true,
    description: null,
    defaultBranchName: null,
    defaultBranchHeadOid: null,
    chapters: [],
    isPendingCreate: true,
    pendingCreateStartedAt: new Date().toISOString(),
    pendingCreateStatusText: "Creating...",
    remoteState: "pendingCreate",
    recordState: "live",
    resolutionState: "pendingCreate",
  };
}

function pendingProjectMetadataRecord(project) {
  return {
    projectId: project.id,
    title: project.title,
    repoName: project.name,
    lifecycleState: project.status === "deleted" ? "softDeleted" : "active",
    remoteState: "pendingCreate",
    recordState: "live",
    defaultBranch: "main",
    chapterCount: Array.isArray(project.chapters) ? project.chapters.length : 0,
  };
}

async function rollbackPendingProjectMetadataOnLocalFailure(selectedTeam, projectId, error) {
  try {
    await deleteProjectMetadataRecord(selectedTeam, projectId);
  } catch (rollbackError) {
    throw new Error(
      `${error?.message ?? String(error)} The pending project metadata intent was committed locally first, and the automatic metadata rollback also failed: ${
        rollbackError?.message ?? String(rollbackError)
      }`,
    );
  }
}

function linkedProjectMetadataRecord(project, remoteProject) {
  return {
    ...pendingProjectMetadataRecord(project),
    repoName: remoteProject.name,
    previousRepoNames: remoteProject.name !== project.name ? [project.name] : [],
    githubRepoId: remoteProject.repoId ?? null,
    githubNodeId: remoteProject.nodeId ?? null,
    fullName: remoteProject.fullName ?? null,
    defaultBranch: remoteProject.defaultBranchName || "main",
    remoteState: "linked",
  };
}

function findMatchingRemoteProjectForPendingCreate(project, remoteProjects) {
  if (!project || !Array.isArray(remoteProjects)) {
    return null;
  }

  if (Number.isFinite(project.repoId)) {
    const byRepoId = remoteProjects.find((remoteProject) => remoteProject?.repoId === project.repoId);
    if (byRepoId) {
      return byRepoId;
    }
  }

  if (typeof project.nodeId === "string" && project.nodeId.trim()) {
    const byNodeId = remoteProjects.find((remoteProject) =>
      typeof remoteProject?.nodeId === "string" && remoteProject.nodeId.trim() === project.nodeId.trim(),
    );
    if (byNodeId) {
      return byNodeId;
    }
  }

  if (typeof project.fullName === "string" && project.fullName.trim()) {
    const byFullName = remoteProjects.find((remoteProject) =>
      typeof remoteProject?.fullName === "string" && remoteProject.fullName.trim() === project.fullName.trim(),
    );
    if (byFullName) {
      return byFullName;
    }
  }

  if (typeof project.name === "string" && project.name.trim()) {
    return remoteProjects.find((remoteProject) =>
      typeof remoteProject?.name === "string" && remoteProject.name.trim() === project.name.trim(),
    ) ?? null;
  }

  return null;
}

async function finalizePendingProjectSetup(render, selectedTeam, project, remoteProject) {
  const currentProject = currentProjectSnapshot(project);
  const projectId = currentProject?.id ?? project?.id ?? null;
  const linkedProject = {
    ...currentProject,
    ...remoteProject,
    chapters: Array.isArray(currentProject?.chapters) ? currentProject.chapters : [],
    isPendingCreate: false,
    pendingCreateStartedAt: undefined,
    pendingCreateStatusText: undefined,
    remoteState: "linked",
    resolutionState: "",
  };

  if (typeof projectId === "string" && projectId.trim()) {
    setProjectRepoSyncSnapshot(projectId, {
      status: "syncing",
      message: "Finishing project setup...",
    });
  }

  await upsertProjectMetadataRecord(
    selectedTeam,
    linkedProjectMetadataRecord(currentProject, remoteProject),
  );
  replaceVisibleProject(projectId, linkedProject);
  persistProjectsForTeam(selectedTeam);
  render();

  await reconcileProjectRepoSyncStates(render, selectedTeam, [{
    ...linkedProject,
    allowPendingCreateSync: true,
  }]);
  await refreshProjectFilesFromDisk(render, selectedTeam, [linkedProject]);

  const latestProject = currentProjectSnapshot(linkedProject);
  replaceVisibleProject(projectId, {
    ...latestProject,
    ...remoteProject,
    chapters: Array.isArray(latestProject?.chapters) ? latestProject.chapters : [],
    isPendingCreate: false,
    pendingCreateStartedAt: undefined,
    pendingCreateStatusText: undefined,
    remoteState: "linked",
    resolutionState: "",
  });
  persistProjectsForTeam(selectedTeam);
  render();
}

function reserveLocalProjectRepoName(baseRepoName) {
  const usedRepoNames = new Set(
    [...(state.projects ?? []), ...(state.deletedProjects ?? [])]
      .map((project) => String(project?.name ?? "").trim())
      .filter(Boolean),
  );

  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const candidateRepoName = appendRepoNameSuffix(baseRepoName, attempt);
    if (!usedRepoNames.has(candidateRepoName)) {
      return {
        repoName: candidateRepoName,
        collisionResolved: attempt > 1,
      };
    }
  }

  throw new Error("Could not determine an available local project repo name.");
}

function currentProjectSnapshot(project) {
  const projectId = project?.id ?? null;
  const repoName = project?.name ?? null;
  return (
    state.projects.find((item) => item?.id === projectId)
    ?? state.deletedProjects.find((item) => item?.id === projectId)
    ?? state.projects.find((item) => item?.name === repoName)
    ?? state.deletedProjects.find((item) => item?.name === repoName)
    ?? project
  );
}

function markProjectAsLocalOnly(selectedTeam, project, render) {
  const localOnlyProject = {
    ...currentProjectSnapshot(project),
    isPendingCreate: false,
    pendingCreateStartedAt: undefined,
    pendingCreateStatusText: undefined,
    remoteState: "linked",
    resolutionState: "unregisteredLocal",
  };
  replaceVisibleProject(localOnlyProject.id, localOnlyProject);
  persistProjectsForTeam(selectedTeam);
  render();
  return localOnlyProject;
}

function replaceVisibleProject(currentProjectId, nextProject) {
  const nextSnapshot = {
    items: [
      ...state.projects.filter(
        (item) => item.id !== currentProjectId && item.id !== nextProject.id,
      ),
      nextProject,
    ],
    deletedItems: state.deletedProjects.filter(
      (item) => item.id !== currentProjectId && item.id !== nextProject.id,
    ),
  };
  applyProjectSnapshotToState(nextSnapshot, { reconcileExpandedDeletedFiles });
}

function removeVisibleProject(projectId) {
  applyProjectSnapshotToState({
    items: state.projects.filter((item) => item.id !== projectId),
    deletedItems: state.deletedProjects.filter((item) => item.id !== projectId),
  }, { reconcileExpandedDeletedFiles });
}

function normalizeListedChapter(chapter) {
  if (!chapter || typeof chapter !== "object") {
    return null;
  }

  const id =
    typeof chapter.id === "string" && chapter.id.trim()
      ? chapter.id.trim()
      : null;
  const name =
    typeof chapter.name === "string" && chapter.name.trim()
      ? chapter.name.trim()
      : null;
  if (!id || !name) {
    return null;
  }

  return {
    ...chapter,
    id,
    name,
    status: chapter.status === "deleted" ? "deleted" : "active",
    languages: Array.isArray(chapter.languages) ? chapter.languages : [],
    sourceWordCounts:
      chapter.sourceWordCounts && typeof chapter.sourceWordCounts === "object"
        ? chapter.sourceWordCounts
        : {},
    selectedSourceLanguageCode:
      typeof chapter.selectedSourceLanguageCode === "string" && chapter.selectedSourceLanguageCode.trim()
        ? chapter.selectedSourceLanguageCode
        : null,
    selectedTargetLanguageCode:
      typeof chapter.selectedTargetLanguageCode === "string" && chapter.selectedTargetLanguageCode.trim()
        ? chapter.selectedTargetLanguageCode
        : null,
    linkedGlossary1: normalizeChapterGlossaryLink(chapter.linkedGlossary1),
    linkedGlossary2: normalizeChapterGlossaryLink(chapter.linkedGlossary2),
  };
}

function normalizeChapterGlossaryLink(link) {
  if (!link || typeof link !== "object") {
    return null;
  }

  const glossaryId =
    typeof link.glossaryId === "string" && link.glossaryId.trim()
      ? link.glossaryId.trim()
      : null;
  const repoName =
    typeof link.repoName === "string" && link.repoName.trim()
      ? link.repoName.trim()
      : null;

  if (!glossaryId || !repoName) {
    return null;
  }

  return {
    glossaryId,
    repoName,
  };
}

function mergeProjectsWithLocalFiles(snapshot, listings = [], targets = []) {
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

function projectMetadataRecordFromVisibleProject(project, overrides = {}) {
  return {
    projectId: project.id,
    title: overrides.title ?? project.title,
    repoName: overrides.repoName ?? project.name,
    githubRepoId:
      Number.isFinite(overrides.githubRepoId)
        ? overrides.githubRepoId
        : Number.isFinite(project.repoId)
          ? project.repoId
          : null,
    githubNodeId:
      typeof overrides.githubNodeId === "string" && overrides.githubNodeId.trim()
        ? overrides.githubNodeId.trim()
        : typeof project.nodeId === "string" && project.nodeId.trim()
        ? project.nodeId.trim()
        : null,
    fullName:
      typeof overrides.fullName === "string" && overrides.fullName.trim()
        ? overrides.fullName.trim()
        : typeof project.fullName === "string" && project.fullName.trim()
        ? project.fullName.trim()
        : null,
    defaultBranch:
      typeof overrides.defaultBranch === "string" && overrides.defaultBranch.trim()
        ? overrides.defaultBranch.trim()
        : typeof project.defaultBranchName === "string" && project.defaultBranchName.trim()
        ? project.defaultBranchName.trim()
        : "main",
    lifecycleState:
      overrides.lifecycleState
      ?? (project.status === "deleted" ? "softDeleted" : "active"),
    remoteState:
      overrides.remoteState
      ?? (project.remoteState === "pendingCreate"
        ? "pendingCreate"
        : project.remoteState ?? "linked"),
    recordState: overrides.recordState ?? project.recordState ?? "live",
    deletedAt:
      typeof overrides.deletedAt === "string" && overrides.deletedAt.trim()
        ? overrides.deletedAt.trim()
        : typeof project.deletedAt === "string" && project.deletedAt.trim()
        ? project.deletedAt.trim()
        : null,
    chapterCount:
      Number.isFinite(overrides.chapterCount)
        ? overrides.chapterCount
        : Array.isArray(project.chapters)
          ? project.chapters.length
          : 0,
  };
}

function projectMetadataRecordIsTombstone(record) {
  return record?.recordState === "tombstone" || record?.remoteState === "deleted";
}

function projectMatchesMetadataRecord(project, record) {
  const projectId =
    typeof project?.id === "string" && project.id.trim()
      ? project.id.trim()
      : "";
  const repoName =
    typeof project?.name === "string" && project.name.trim()
      ? project.name.trim()
      : "";
  const fullName =
    typeof project?.fullName === "string" && project.fullName.trim()
      ? project.fullName.trim()
      : "";
  const recordRepoNames = [
    typeof record?.repoName === "string" ? record.repoName.trim() : "",
    ...(
      Array.isArray(record?.previousRepoNames)
        ? record.previousRepoNames.map((value) => String(value ?? "").trim())
        : []
    ),
  ].filter(Boolean);

  return (
    (projectId && projectId === record?.id)
    || (fullName && fullName === record?.fullName)
    || (repoName && recordRepoNames.includes(repoName))
  );
}

function dropProjectMutationsForProject(selectedTeam, projectId) {
  state.pendingProjectMutations = (Array.isArray(state.pendingProjectMutations) ? state.pendingProjectMutations : [])
    .filter((mutation) => mutation?.projectId !== projectId);
  saveStoredProjectPendingMutations(selectedTeam, state.pendingProjectMutations);
  state.pendingChapterMutations = (Array.isArray(state.pendingChapterMutations) ? state.pendingChapterMutations : [])
    .filter((mutation) => mutation?.projectId !== projectId);
  persistChapterPendingMutationsForTeam(selectedTeam);
}

function clearSelectedProjectState(project) {
  if (state.selectedProjectId === project?.id) {
    state.selectedProjectId = null;
  }
  if (
    state.selectedChapterId
    && Array.isArray(project?.chapters)
    && project.chapters.some((chapter) => chapter?.id === state.selectedChapterId)
  ) {
    state.selectedChapterId = null;
  }
}

async function purgeLocalProjectRepo(selectedTeam, projectName, projectId = null) {
  if (!Number.isFinite(selectedTeam?.installationId) || !String(projectName ?? "").trim()) {
    return;
  }

  await invoke("purge_local_gtms_project_repo", {
    input: {
      installationId: selectedTeam.installationId,
      projectId,
      repoName: projectName,
    },
  });
}

export async function ensureProjectNotTombstoned(render, selectedTeam, project, options = {}) {
  return ensureResourceNotTombstoned({
    installationId: selectedTeam?.installationId,
    resource: project,
    resourceId: project?.id ?? "",
    render,
    showNotice: options.showNotice !== false,
    resourceLabel: "project",
    lookupMetadataTombstone: (resourceId) => lookupLocalMetadataTombstone(selectedTeam, "project", resourceId),
    listMetadataRecords: () => listProjectMetadataRecords(selectedTeam),
    isTombstoneRecord: projectMetadataRecordIsTombstone,
    matchesMetadataRecord: projectMatchesMetadataRecord,
    purgeLocalRepo: () => purgeLocalProjectRepo(selectedTeam, project.name, project.id),
    removeVisibleResource: () => {
      removeVisibleProject(project.id);
      clearSelectedProjectState(project);
      dropProjectMutationsForProject(selectedTeam, project.id);
      delete state.projectRepoSyncByProjectId[project.id];
    },
    persistVisibleState: () => persistProjectsForTeam(selectedTeam),
  });
}

async function purgeTombstonedProjectsForTeam(selectedTeam, projects, metadataRecords) {
  const visibleProjects = Array.isArray(projects) ? projects : [];
  const tombstoneRecords = (Array.isArray(metadataRecords) ? metadataRecords : []).filter(projectMetadataRecordIsTombstone);
  if (!selectedTeam?.installationId || visibleProjects.length === 0 || tombstoneRecords.length === 0) {
    return;
  }

  const purgedProjectIds = new Set();
  for (const project of visibleProjects) {
    if (!project || purgedProjectIds.has(project.id)) {
      continue;
    }
    if (!tombstoneRecords.some((record) => projectMatchesMetadataRecord(project, record))) {
      continue;
    }

    await purgeLocalProjectRepo(selectedTeam, project.name, project.id);
    removeVisibleProject(project.id);
    clearSelectedProjectState(project);
    dropProjectMutationsForProject(selectedTeam, project.id);
    delete state.projectRepoSyncByProjectId[project.id];
    purgedProjectIds.add(project.id);
  }

  if (purgedProjectIds.size > 0) {
    persistProjectsForTeam(selectedTeam);
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

async function rollbackCreatedRemoteProject(selectedTeam, projectId, remoteProject) {
  await invoke("permanently_delete_gnosis_project_repo", {
    input: {
      installationId: selectedTeam.installationId,
      orgLogin: selectedTeam.githubOrg,
      repoName: remoteProject.name,
    },
    sessionToken: requireBrokerSession(),
  });
  await deleteProjectMetadataRecord(selectedTeam, projectId);
}

function syncProjectInBackground(render, selectedTeam, project, preferredBaseRepoName) {
  void (async () => {
    const projectId = project?.id ?? null;
    let pendingProject = currentProjectSnapshot(project);
    let remoteProject = null;

    try {
      await upsertProjectMetadataRecord(selectedTeam, pendingProjectMetadataRecord(pendingProject));
    } catch (error) {
      markProjectAsLocalOnly(selectedTeam, pendingProject, render);
      clearProjectCreationInFlight(projectId);
      showNoticeBadge(
        `The project stays local-only because its team metadata record could not be created: ${
          error?.message ?? String(error)
        }`,
        render,
      );
      return;
    }

    try {
      const createResult = await createUniqueRepoWithNumericSuffix(
        preferredBaseRepoName,
        (candidateRepoName) =>
          invoke("create_gnosis_project_repo", {
            input: {
              installationId: selectedTeam.installationId,
              orgLogin: selectedTeam.githubOrg,
              repoName: candidateRepoName,
              projectTitle: pendingProject.title,
              projectId,
            },
            sessionToken: requireBrokerSession(),
          }),
      );

      remoteProject = {
        ...currentProjectSnapshot(pendingProject),
        ...createResult.result,
        chapters: Array.isArray(currentProjectSnapshot(pendingProject)?.chapters)
          ? currentProjectSnapshot(pendingProject).chapters
          : [],
        isPendingCreate: true,
        pendingCreateStartedAt: pendingProject.pendingCreateStartedAt,
        pendingCreateStatusText: "Syncing local repo...",
        remoteState: "pendingCreate",
        recordState: "live",
        resolutionState: "pendingCreate",
      };
      replaceVisibleProject(projectId, remoteProject);
      persistProjectsForTeam(selectedTeam);
      setProjectRepoSyncSnapshot(projectId, {
        status: "syncing",
        message: "Syncing local repo...",
      });
      render();

      try {
        await upsertProjectMetadataRecord(
          selectedTeam,
          linkedProjectMetadataRecord(currentProjectSnapshot(remoteProject), createResult.result),
        );
      } catch (error) {
        try {
          await rollbackCreatedRemoteProject(selectedTeam, projectId, createResult.result);
        } catch (rollbackError) {
          markProjectAsLocalOnly(selectedTeam, currentProjectSnapshot(remoteProject), render);
          clearProjectCreationInFlight(projectId);
          showNoticeBadge(
            `The project repo was created, but team metadata could not be finalized or rolled back automatically: ${
              rollbackError?.message ?? String(rollbackError)
            }`,
            render,
          );
          return;
        }

        markProjectAsLocalOnly(selectedTeam, currentProjectSnapshot(remoteProject), render);
        clearProjectCreationInFlight(projectId);
        showNoticeBadge(
          `The project stays local-only because its team metadata record could not be finalized: ${
            error?.message ?? String(error)
          }`,
          render,
        );
        return;
      }

      remoteProject = {
        ...currentProjectSnapshot(remoteProject),
        ...createResult.result,
        chapters: Array.isArray(currentProjectSnapshot(remoteProject)?.chapters)
          ? currentProjectSnapshot(remoteProject).chapters
          : [],
        isPendingCreate: false,
        pendingCreateStartedAt: undefined,
        pendingCreateStatusText: undefined,
        remoteState: "linked",
        resolutionState: "",
      };
      replaceVisibleProject(projectId, remoteProject);
      persistProjectsForTeam(selectedTeam);
      render();

      await reconcileProjectRepoSyncStates(render, selectedTeam, [{
        ...remoteProject,
        allowPendingCreateSync: true,
      }]);
      await refreshProjectFilesFromDisk(render, selectedTeam, [remoteProject]);

      const latestProject = currentProjectSnapshot(remoteProject);
      replaceVisibleProject(projectId, {
        ...latestProject,
        ...createResult.result,
        chapters: Array.isArray(latestProject?.chapters) ? latestProject.chapters : [],
        isPendingCreate: false,
        pendingCreateStartedAt: undefined,
        pendingCreateStatusText: undefined,
        remoteState: "linked",
        resolutionState: "",
      });
      persistProjectsForTeam(selectedTeam);
      if (createResult.collisionResolved === true) {
        showNoticeBadge(
          `Saved ${pendingProject.title} to repo ${createResult.attemptedRepoName} because that repo name was already taken.`,
          render,
        );
      }
    } catch (error) {
      if (remoteProject) {
        markProjectAsLocalOnly(selectedTeam, currentProjectSnapshot(remoteProject), render);
      } else {
        markProjectAsLocalOnly(selectedTeam, currentProjectSnapshot(pendingProject), render);
      }
      showNoticeBadge(
        `The project could not sync to GitHub automatically: ${error?.message ?? String(error)}`,
        render,
      );
      render();
    } finally {
      clearProjectCreationInFlight(projectId);
      render();
    }
  })();
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

export async function refreshProjectFilesFromDisk(render, selectedTeam, projects) {
  const baseSnapshot = {
    items: state.projects,
    deletedItems: state.deletedProjects,
  };
  const targetProjects = Array.isArray(projects) ? projects : [];
  if (!Number.isFinite(selectedTeam?.installationId) || targetProjects.length === 0) {
    return baseSnapshot;
  }

  const listings = await loadLocalProjectFileListings(selectedTeam, targetProjects);
  const mergedSnapshot = mergeProjectsWithLocalFiles(baseSnapshot, listings, targetProjects);
  const nextProjectSnapshot = applyPendingMutations(
    mergedSnapshot,
    state.pendingProjectMutations,
    applyProjectPendingMutation,
  );
  const nextSnapshot = applyPendingMutations(
    nextProjectSnapshot,
    state.pendingChapterMutations,
    applyChapterPendingMutation,
  );
  applyProjectSnapshotToState(nextSnapshot, { reconcileExpandedDeletedFiles });
  persistProjectsForTeam(selectedTeam);
  render();
  return mergedSnapshot;
}

function findChapterContext(chapterId) {
  for (const project of [...state.projects, ...state.deletedProjects]) {
    const chapter = Array.isArray(project?.chapters)
      ? project.chapters.find((item) => item?.id === chapterId)
      : null;
    if (chapter) {
      return { project, chapter };
    }
  }

  return null;
}

function cloneProjectCollections() {
  return {
    projects: structuredClone(state.projects),
    deletedProjects: structuredClone(state.deletedProjects),
    expandedDeletedFiles: new Set(state.expandedDeletedFiles),
  };
}

function restoreProjectCollections(snapshot) {
  state.projects = snapshot.projects;
  state.deletedProjects = snapshot.deletedProjects;
  state.expandedDeletedFiles = snapshot.expandedDeletedFiles;
  reconcileExpandedDeletedFiles();
}

function updateChapterInState(chapterId, updater) {
  const applyToProject = (project) => {
    if (!project || !Array.isArray(project.chapters)) {
      return project;
    }

    let changed = false;
    const chapters = project.chapters.map((chapter) => {
      if (!chapter || chapter.id !== chapterId) {
        return chapter;
      }

      changed = true;
      return updater(chapter, project);
    });

    return changed ? { ...project, chapters } : project;
  };

  state.projects = state.projects.map(applyToProject);
  state.deletedProjects = state.deletedProjects.map(applyToProject);
}

function chapterGlossaryLinkFromGlossaryId(glossaryId) {
  if (typeof glossaryId !== "string" || !glossaryId.trim()) {
    return null;
  }

  const glossary = state.glossaries.find(
    (item) => item?.id === glossaryId && item.lifecycleState !== "deleted",
  );
  if (!glossary) {
    return null;
  }

  return {
    glossaryId: glossary.id,
    repoName: glossary.repoName,
  };
}

function chapterGlossaryLinkInput(link) {
  if (!link) {
    return null;
  }

  return {
    glossaryId: link.glossaryId,
    repoName: link.repoName,
  };
}

function glossarySummaryByLink(link) {
  if (!link) {
    return null;
  }

  return (
    state.glossaries.find((glossary) => glossary?.id === link.glossaryId)
    ?? state.glossaries.find((glossary) => glossary?.repoName === link.repoName)
    ?? null
  );
}

function glossaryTargetLanguageKey(glossary) {
  if (!glossary || typeof glossary !== "object") {
    return "";
  }

  return String(glossary.targetLanguage?.code ?? glossary.targetLanguage?.name ?? "").trim().toLowerCase();
}

function reconcileExpandedDeletedFiles() {
  const nextExpandedDeletedFiles = new Set(state.expandedDeletedFiles);

  for (const project of [...state.projects, ...state.deletedProjects]) {
    const chapters = Array.isArray(project?.chapters) ? project.chapters : [];
    const deletedCount = chapters.filter((chapter) => chapter?.status === "deleted").length;
    const activeCount = chapters.length - deletedCount;

    if (deletedCount === 0) {
      nextExpandedDeletedFiles.delete(project.id);
      continue;
    }

    if (activeCount === 0) {
      nextExpandedDeletedFiles.add(project.id);
    }
  }

  state.expandedDeletedFiles = nextExpandedDeletedFiles;
}

function projectTopLevelMutationStore(selectedTeam) {
  return {
    currentSnapshot: () => projectSnapshotFromState(),
    applyMutation: (snapshot, mutation) => applyProjectPendingMutation(snapshot, mutation),
    applySnapshot: (snapshot) => applyProjectSnapshotToState(snapshot, { reconcileExpandedDeletedFiles }),
    beginSync: () => beginProjectsPageSync(),
    getPendingMutations: () => state.pendingProjectMutations,
    setPendingMutations: (mutations) => {
      state.pendingProjectMutations = mutations;
    },
    persistPendingMutations: (mutations) =>
      saveStoredProjectPendingMutations(selectedTeam, mutations),
    persistVisibleState: () => persistProjectsForTeam(selectedTeam),
  };
}

function applyChapterPendingMutation(snapshot, mutation) {
  const normalizedSnapshot = sortProjectSnapshot(snapshot);
  const updateProject = (project) => {
    if (!project || project.id !== mutation.projectId || !Array.isArray(project.chapters)) {
      return project;
    }

    let changed = false;

    if (mutation.type === "permanentDelete") {
      const chapters = project.chapters.filter((chapter) => {
        const matches = chapter?.id === mutation.chapterId;
        if (matches) {
          changed = true;
        }
        return !matches;
      });
      return changed ? { ...project, chapters } : project;
    }

    const chapters = project.chapters.map((chapter) => {
      if (!chapter || chapter.id !== mutation.chapterId) {
        return chapter;
      }

      changed = true;
      if (mutation.type === "rename") {
        return {
          ...chapter,
          name: mutation.title,
        };
      }

      if (mutation.type === "softDelete") {
        return {
          ...chapter,
          status: "deleted",
        };
      }

      if (mutation.type === "restore") {
        return {
          ...chapter,
          status: "active",
        };
      }

      if (mutation.type === "setGlossaryLinks") {
        return {
          ...chapter,
          linkedGlossary1: normalizeChapterGlossaryLink(mutation.glossary1),
          linkedGlossary2: normalizeChapterGlossaryLink(mutation.glossary2),
        };
      }

      return chapter;
    });

    return changed ? { ...project, chapters } : project;
  };

  return sortProjectSnapshot({
    items: normalizedSnapshot.items.map(updateProject),
    deletedItems: normalizedSnapshot.deletedItems.map(updateProject),
  });
}

const inflightProjectMutationIds = new Set();

export async function loadTeamProjects(render, teamId = state.selectedTeamId) {
  const selectedTeam = state.teams.find((team) => team.id === teamId);
  const syncVersionAtStart = state.projectSyncVersion;
  state.projectRepoSyncByProjectId = {};

  if (!selectedTeam?.installationId) {
    state.pendingProjectMutations = [];
    state.pendingChapterMutations = [];
    state.projectRepoSyncByProjectId = {};
    applyProjectSnapshotToState({ items: [], deletedItems: [] }, { reconcileExpandedDeletedFiles });
    setProjectDiscoveryState("ready", "", "");
    render();
    return;
  }

  const cachedProjects = loadStoredProjectsForTeam(selectedTeam);
  state.pendingProjectMutations = loadStoredProjectPendingMutations(selectedTeam);
  state.pendingChapterMutations = loadStoredChapterPendingMutations(selectedTeam);
  const optimisticProjectSnapshot = applyPendingMutations(
    {
      items: cachedProjects.projects,
      deletedItems: cachedProjects.deletedProjects,
    },
    state.pendingProjectMutations,
    applyProjectPendingMutation,
  );
  const optimisticSnapshot = applyPendingMutations(
    optimisticProjectSnapshot,
    state.pendingChapterMutations,
    applyChapterPendingMutation,
  );
  const glossaryLoadPromise = loadAvailableGlossariesForTeam(selectedTeam, teamId);

  if (state.offline.isEnabled) {
    const glossaryResult = await glossaryLoadPromise;
    state.projectRepoSyncByProjectId = {};
    applyProjectSnapshotToState(optimisticSnapshot, { reconcileExpandedDeletedFiles });
    setProjectDiscoveryState(
      "ready",
      "",
      glossaryResult?.syncIssue || glossaryResult?.brokerWarning || "",
    );
    render();
    return;
  }

  if (cachedProjects.exists) {
    applyProjectSnapshotToState(optimisticSnapshot, { reconcileExpandedDeletedFiles });
    setProjectDiscoveryState("ready", "", "", "");
  } else {
    applyProjectSnapshotToState({ items: [], deletedItems: [] }, { reconcileExpandedDeletedFiles });
    setProjectDiscoveryState("loading", "", "", "");
  }
  setProjectUiDebug(render, "Refreshing projects...");
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
    const remoteProjects = projectsResult.status === "fulfilled"
      ? (Array.isArray(projectsResult.value) ? projectsResult.value : [])
      : [];
    const remoteLoaded = projectsResult.status === "fulfilled";
    let projectMetadataRecords =
      metadataResult.status === "fulfilled"
        ? metadataResult.value
        : [];
    const metadataLoaded = metadataResult.status === "fulfilled";
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
      const metadataRepaired = await repairProjectMetadataFromRemoteRename(selectedTeam, projectMetadataRecords, remoteProjects);
      if (metadataRepaired) {
        projectMetadataRecords = await listProjectMetadataRecords(selectedTeam).catch(() => projectMetadataRecords);
      }
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
    await purgeTombstonedProjectsForTeam(
      selectedTeam,
      [
        ...state.projects,
        ...state.deletedProjects,
        ...optimisticSnapshot.items,
        ...optimisticSnapshot.deletedItems,
      ].filter(Boolean),
      projectMetadataRecords,
    );
    if (syncVersionAtStart !== state.projectSyncVersion) {
      await completeProjectsPageSync(render);
      render();
      return;
    }
    const mergedProjects = mergeMetadataDiscoveryProjects({
      metadataRecords: projectMetadataRecords,
      remoteProjects,
      localProjects: [
        ...state.projects,
        ...state.deletedProjects,
        ...optimisticSnapshot.items,
        ...optimisticSnapshot.deletedItems,
      ].filter(Boolean),
      metadataLoaded,
      remoteLoaded,
      repairIssues,
    });
    const nextVisibleProjects = mergedProjects.length > 0
      ? mergedProjects
      : [...optimisticSnapshot.items, ...optimisticSnapshot.deletedItems];
    const mappedProjects = nextVisibleProjects.map((project) => ({
      ...project,
      chapters: Array.isArray(project.chapters) ? project.chapters : [],
      remoteState: project.remoteState ?? "linked",
    }));
    const preSyncListings = await loadLocalProjectFileListings(
      selectedTeam,
      mappedProjects.filter((project) =>
        project?.status !== "deleted"
        && project?.recordState !== "tombstone"
        && project?.remoteState !== "pendingCreate"
      ),
    );
    const installationRecoveryDetected =
      metadataLoaded
      && recoverableMetadataCount > 0
      && preSyncListings.length === 0;
    const recoveryMessage = installationRecoveryDetected
      ? "Local installation data was missing. Rebuilding project repos from GitHub."
      : "";
    const nextProjectSnapshot = applyPendingMutations(
      {
        items: mappedProjects.filter((project) => project.status !== "deleted"),
        deletedItems: mappedProjects.filter((project) => project.status === "deleted"),
      },
      state.pendingProjectMutations,
      applyProjectPendingMutation,
    );
    const nextSnapshot = applyPendingMutations(
      nextProjectSnapshot,
      state.pendingChapterMutations,
      applyChapterPendingMutation,
    );
    applyProjectSnapshotToState(nextSnapshot, { reconcileExpandedDeletedFiles });
    persistProjectsForTeam(selectedTeam);
    const glossaryWarning =
      glossaryDiscoveryResult.status === "fulfilled"
        ? glossaryDiscoveryResult.value?.syncIssue || glossaryDiscoveryResult.value?.brokerWarning || ""
        : glossaryDiscoveryResult.reason?.message ?? String(glossaryDiscoveryResult.reason ?? "");
    setProjectDiscoveryState("ready", "", glossaryWarning, recoveryMessage);
    render();
    await waitForNextPaint();
    await reconcileProjectRepoSyncStates(render, selectedTeam, mappedProjects);
    await refreshProjectFilesFromDisk(
      render,
      selectedTeam,
      mappedProjects,
    );
    await autoResumePendingProjects(render, mappedProjects);
    clearProjectUiDebug(render);
    await completeProjectsPageSync(render);
    render();
    if (glossaryDiscoveryResult.status === "rejected" && glossaryWarning) {
      showNoticeBadge(glossaryWarning, render, 3200);
    }
    if (state.pendingProjectMutations.length > 0) {
      void processPendingProjectMutations(render, selectedTeam);
    }
  } catch (error) {
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
      applyProjectSnapshotToState({ items: [], deletedItems: [] }, { reconcileExpandedDeletedFiles });
      setProjectDiscoveryState("error", error?.message ?? String(error), "");
    } else {
      setProjectDiscoveryState("ready", "", "");
    }
    clearProjectUiDebug(render);
    failProjectsPageSync();
    render();
  }
}

export async function createProjectForSelectedTeam(render) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  if (!guardResourceCreateStart({
    installationReady: () => Boolean(selectedTeam?.installationId),
    canCreate: () => canCreateRepoResources(selectedTeam),
    installationMessage: "New projects currently require a GitHub App-connected team.",
    permissionMessage: "You do not have permission to create projects in this team.",
    onBlocked: (message) => {
      setProjectDiscoveryState("error", message);
      render();
    },
  })) {
    return;
  }

  openEntityFormModal({
    setState: (nextState) => {
      state.projectCreation = nextState;
    },
    fields: {
      projectName: "",
    },
  });
  render();
}

export function updateProjectCreationName(projectName) {
  updateEntityFormField(state.projectCreation, "projectName", projectName);
}

export function cancelProjectCreation(render) {
  resetProjectCreation();
  render();
}

export function openProjectRename(render, projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  openTopLevelRenameModal({
    resource: project,
    getBlockedMessage: () =>
      projectLifecycleBlockedMessage(selectedTeam, "rename projects"),
    ensureNotTombstoned: (currentProject) =>
      ensureProjectNotTombstoned(render, selectedTeam, currentProject),
    onMissing: () => {
      setProjectDiscoveryState("error", "Could not find the selected project.");
      render();
    },
    onBlocked: (blockedMessage) => {
      setProjectDiscoveryState("error", blockedMessage);
      render();
    },
    setModalState: (nextState) => {
      state.projectRename = nextState;
    },
    idField: "projectId",
    nameField: "projectName",
    currentName: project?.title ?? project?.name ?? "",
    render,
  });
}

export function updateProjectRenameName(projectName) {
  updateEntityModalName(state.projectRename, "projectName", projectName);
}

export function cancelProjectRename(render) {
  cancelEntityModal(resetProjectRename, render);
}

export function openChapterRename(render, chapterId) {
  const context = findChapterContext(chapterId);
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  if (!context?.chapter) {
    setProjectDiscoveryState("error", "Could not find the selected file.");
    render();
    return;
  }

  if (!selectedTeam) {
    setProjectDiscoveryError(render, "Could not determine the selected team.");
    return;
  }

  if (!ensureChapterMutationAllowed(render, { selectedTeam, actionLabel: "rename files" })) {
    return;
  }

  state.chapterRename = {
    isOpen: true,
    projectId: context.project.id,
    chapterId,
    chapterName: context.chapter.name,
    status: "idle",
    error: "",
  };
  render();
}

export function updateChapterRenameName(chapterName) {
  state.chapterRename.chapterName = chapterName;
  if (state.chapterRename.error) {
    state.chapterRename.error = "";
  }
}

export function openChapterPermanentDeletion(render, chapterId) {
  const context = findChapterContext(chapterId);
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  if (!context?.chapter) {
    setProjectDiscoveryState("error", "Could not find the selected deleted file.");
    render();
    return;
  }

  if (!ensureChapterMutationAllowed(render, {
    selectedTeam,
    actionLabel: "permanently delete files",
    requireDelete: false,
  })) {
    return;
  }

  state.chapterPermanentDeletion = {
    isOpen: true,
    projectId: context.project.id,
    chapterId,
    chapterName: context.chapter.name,
    confirmationText: "",
    status: "idle",
    error: "",
  };
  render();
}

export function updateChapterPermanentDeletionConfirmation(value) {
  state.chapterPermanentDeletion.confirmationText = value;
  if (state.chapterPermanentDeletion.error) {
    state.chapterPermanentDeletion.error = "";
  }
}

export function cancelChapterRename(render) {
  resetChapterRename();
  render();
}

export function cancelChapterPermanentDeletion(render) {
  resetChapterPermanentDeletion();
  render();
}

export function toggleDeletedFiles(render, projectId) {
  const project =
    state.projects.find((item) => item.id === projectId)
    ?? state.deletedProjects.find((item) => item.id === projectId);
  const deletedCount = Array.isArray(project?.chapters)
    ? project.chapters.filter((chapter) => chapter?.status === "deleted").length
    : 0;

  if (deletedCount === 0) {
    state.expandedDeletedFiles.delete(projectId);
    render();
    return;
  }

  if (state.expandedDeletedFiles.has(projectId)) {
    state.expandedDeletedFiles.delete(projectId);
  } else {
    state.expandedDeletedFiles.add(projectId);
  }
  render();
}

export async function submitProjectCreation(render) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  if (!guardResourceCreateStart({
    installationReady: () => Boolean(selectedTeam?.installationId),
    canCreate: () => canCreateRepoResources(selectedTeam),
    installationMessage: "New projects currently require a GitHub App-connected team.",
    permissionMessage: "You do not have permission to create projects in this team.",
    onBlocked: (message) => {
      state.projectCreation.error = message;
      render();
    },
  })) {
    return;
  }

  const projectTitle = state.projectCreation.projectName.trim();
  const repoName = slugifyRepoName(projectTitle);

  if (!repoName) {
    state.projectCreation.error =
      "Project names must contain at least one letter or number.";
    render();
    return;
  }

  try {
    state.projectCreation.status = "loading";
    state.projectCreation.error = "";
    render();
    await waitForNextPaint();
    const pendingProjectId = crypto.randomUUID();
    let pendingProject = null;
    state.projectSyncVersion += 1;
    beginProjectsPageSync();
    setProjectUiDebug(render, "Initializing local project...");

    try {
      const createResult = await runLocalFirstCreate({
        reserveLocalRepo: async () => reserveLocalProjectRepoName(repoName),
        commitPendingMetadata: async (localRepoName) => {
          pendingProject = buildPendingProjectRecord(
            selectedTeam,
            projectTitle,
            localRepoName,
          );
          pendingProject.id = pendingProjectId;
          replaceVisibleProject(pendingProject.id, pendingProject);
          markProjectCreationInFlight(pendingProject.id);
          persistProjectsForTeam(selectedTeam);
          resetProjectCreation();
          render();
          await waitForNextPaint();
          await upsertProjectMetadataRecord(selectedTeam, pendingProjectMetadataRecord(pendingProject));
        },
        initializeLocalResource: async (localRepoName) => {
          await invoke("initialize_gtms_project_repo", {
            input: {
              installationId: selectedTeam.installationId,
              projectId: pendingProjectId,
              repoName: localRepoName,
              title: projectTitle,
            },
          });
          return pendingProject;
        },
        purgeLocalRepo: async (localRepoName) => {
          removeVisibleProject(pendingProjectId);
          persistProjectsForTeam(selectedTeam);
          await invoke("purge_local_gtms_project_repo", {
            input: {
              installationId: selectedTeam.installationId,
              projectId: pendingProjectId,
              repoName: localRepoName,
            },
          });
        },
        rollbackPendingMetadata: (error) =>
          rollbackPendingProjectMetadataOnLocalFailure(selectedTeam, pendingProjectId, error),
      });

      await refreshProjectFilesFromDisk(render, selectedTeam, [pendingProject]);
      clearProjectUiDebug(render);
      await completeProjectsPageSync(render);
      render();
      await finalizeLocalFirstCreate({
        createdResource: pendingProject,
        commitVisibleResource: (project) => currentProjectSnapshot(project),
        syncInBackground: async (project) => {
          syncProjectInBackground(render, selectedTeam, project, repoName);
        },
        showSuccessNotice: () => {
          showNoticeBadge(
            createResult.localNameCollisionResolved
              ? `Created project ${projectTitle} in local repo ${pendingProject.name} because that name was already used locally.`
              : `Created project ${projectTitle}.`,
            render,
          );
        },
      });
    } catch (error) {
      if (await handleSyncFailure(classifySyncError(error), { render })) {
        clearProjectUiDebug(render);
        failProjectsPageSync();
        clearProjectCreationInFlight(pendingProjectId);
        return;
      }
      clearProjectUiDebug(render);
      failProjectsPageSync();
      clearProjectCreationInFlight(pendingProjectId);
      state.projectCreation.status = "idle";
      state.projectCreation.error = error?.message ?? String(error);
      render();
    }
  } catch (error) {
    if (await handleSyncFailure(classifySyncError(error), { render })) {
      return;
    }
    state.projectCreation.status = "idle";
    state.projectCreation.error = error?.message ?? String(error);
    render();
  }
}

async function resumePendingProjectSetupInternal(render, projectId, options = {}) {
  const selectedTeam = selectedProjectsTeam();
  const showStartNotice = options.showStartNotice !== false;
  const showSuccessNotice = options.showSuccessNotice !== false;
  const showErrorNotice = options.showErrorNotice !== false;
  await resumePendingResourceSetup({
    render,
    resourceId: projectId,
    resourceLabel: "project",
    showStartNotice,
    showSuccessNotice,
    showErrorNotice,
    getResource: (nextProjectId) =>
      state.projects.find((item) => item.id === nextProjectId)
      ?? state.deletedProjects.find((item) => item.id === nextProjectId)
      ?? null,
    ensureResumeAllowed: () =>
      ensureChapterMutationAllowed(render, {
        selectedTeam,
        actionLabel: "resume project setup",
        requireDelete: true,
      }),
    isPendingCreate: (project) =>
      project?.remoteState === "pendingCreate" || project?.resolutionState === "pendingCreate",
    isInFlight: (project) => state.projectCreationInFlightIds.has(project.id),
    markInFlight: (project) => markProjectCreationInFlight(project.id),
    clearInFlight: (project) => clearProjectCreationInFlight(project.id),
    listRemoteResources: async () => invoke("list_gnosis_projects_for_installation", {
      installationId: selectedTeam.installationId,
      sessionToken: requireBrokerSession(),
    }),
    findMatchingRemoteResource: (project, remoteProjects) =>
      findMatchingRemoteProjectForPendingCreate(
        currentProjectSnapshot(project),
        Array.isArray(remoteProjects) ? remoteProjects : [],
      ),
    syncInBackground: async (project) => {
      syncProjectInBackground(
        render,
        selectedTeam,
        currentProjectSnapshot(project),
        currentProjectSnapshot(project)?.name ?? "",
      );
    },
    finalizePendingSetup: (project, matchedRemoteProject) =>
      finalizePendingProjectSetup(render, selectedTeam, project, matchedRemoteProject),
  });
}

async function autoResumePendingProjects(render, projects) {
  await autoResumePendingResources({
    resources: projects,
    getResourceId: (project) => project?.id ?? "",
    isPendingCreate: (project) =>
      project?.remoteState === "pendingCreate" || project?.resolutionState === "pendingCreate",
    isInFlight: (project) => state.projectCreationInFlightIds.has(project.id),
    resumePendingSetup: (projectId, options = {}) =>
      resumePendingProjectSetupInternal(render, projectId, options),
  });
}

export async function resumePendingProjectSetup(render, projectId) {
  await resumePendingProjectSetupInternal(render, projectId);
}

export async function submitProjectRename(render) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  const project = state.projects.find((item) => item.id === state.projectRename.projectId);
  state.projectSyncVersion += 1;
  await submitTopLevelRename({
    resource: selectedTeam?.installationId ? project : null,
    modalState: state.projectRename,
    render,
    nameField: "projectName",
    getBlockedMessage: () =>
      projectLifecycleBlockedMessage(selectedTeam, "rename projects"),
    ensureNotTombstoned: (currentProject) =>
      ensureProjectNotTombstoned(render, selectedTeam, currentProject),
    missingMessage: "Could not find the selected project.",
    emptyTitleMessage: "Enter a project name.",
    onTombstoned: () => {
      resetProjectRename();
    },
    previousTitle: (currentProject) => currentProject.title ?? currentProject.name,
    buildMutationFields: (currentProject) => ({
      projectId: currentProject.id,
    }),
    store: projectTopLevelMutationStore(selectedTeam),
    afterQueue: () => {
      resetProjectRename();
      render();
    },
    processQueue: () => processPendingProjectMutations(render, selectedTeam),
    onError: async (error) => {
      if (await handleSyncFailure(classifySyncError(error), { render })) {
        return;
      }
      state.projectRename.status = "idle";
      state.projectRename.error = error?.message ?? String(error);
      render();
    },
  });
}

export async function repairProjectRepoBinding(render, projectId) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  if (!selectedTeam?.installationId || typeof projectId !== "string" || !projectId.trim()) {
    return;
  }

  try {
    await repairLocalRepoBinding(selectedTeam, "project", projectId);
    showNoticeBadge("The project repo binding was repaired.", render, 2200);
    await loadTeamProjects(render, selectedTeam.id);
  } catch (error) {
    showNoticeBadge(error?.message ?? String(error), render, 3200);
    render();
  }
}

export async function rebuildProjectLocalRepo(render, projectId) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  if (!selectedTeam?.installationId || typeof projectId !== "string" || !projectId.trim()) {
    return;
  }

  showNoticeBadge("Rebuilding the local project repo from metadata and GitHub...", render, 2200);
  await loadTeamProjects(render, selectedTeam.id);
}

export async function submitChapterRename(render) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  const context = findChapterContext(state.chapterRename.chapterId);
  const nextTitle = state.chapterRename.chapterName.trim();

  if (!Number.isFinite(selectedTeam?.installationId) || !context?.project || !context?.chapter) {
    state.chapterRename.error = "Could not find the selected file.";
    render();
    return;
  }

  if (state.offline?.isEnabled === true) {
    state.chapterRename.error = "You cannot rename files while offline.";
    render();
    return;
  }

  if (selectedTeam?.canManageProjects !== true) {
    state.chapterRename.error = "You do not have permission to rename files in this team.";
    render();
    return;
  }

  if (!nextTitle) {
    state.chapterRename.error = "Enter a file name.";
    render();
    return;
  }
  if (await ensureProjectNotTombstoned(render, selectedTeam, context.project)) {
    resetChapterRename();
    render();
    return;
  }

  const snapshot = cloneProjectCollections();
  const mutation = {
    id: crypto.randomUUID(),
    type: "rename",
    projectId: context.project.id,
    chapterId: context.chapter.id,
    title: nextTitle,
  };
  state.projectSyncVersion += 1;
  updateChapterInState(context.chapter.id, (chapter) => ({
    ...chapter,
    name: nextTitle,
  }));
  if (state.editorChapter?.chapterId === context.chapter.id) {
    state.editorChapter = {
      ...state.editorChapter,
      fileTitle: nextTitle,
    };
  }
  beginProjectsPageSync();
  persistProjectsForTeam(selectedTeam);
  state.pendingChapterMutations = upsertPendingMutation(state.pendingChapterMutations, mutation);
  persistChapterPendingMutationsForTeam(selectedTeam);
  resetChapterRename();
  render();
  setProjectUiDebug(render, "Optimistic file rename applied");
  void waitForNextPaint().then(async () => {
    try {
      setProjectUiDebug(render, "Saving file...");
      await invoke("rename_gtms_chapter", {
        input: {
          installationId: selectedTeam.installationId,
          projectId: context.project.id,
          repoName: context.project.name,
          chapterId: context.chapter.id,
          title: nextTitle,
        },
      });
      state.pendingChapterMutations = removePendingMutation(state.pendingChapterMutations, mutation.id);
      persistChapterPendingMutationsForTeam(selectedTeam);
      setProjectUiDebug(render, "Background sync started");
      await reconcileProjectRepoSyncStates(render, selectedTeam, [context.project]);
      await refreshProjectFilesFromDisk(render, selectedTeam, [context.project]);
      clearProjectUiDebug(render);
      await completeProjectsPageSync(render);
      render();
    } catch (error) {
      state.pendingChapterMutations = removePendingMutation(state.pendingChapterMutations, mutation.id);
      persistChapterPendingMutationsForTeam(selectedTeam);
      restoreProjectCollections(snapshot);
      state.chapterRename = {
        isOpen: true,
        projectId: context.project.id,
        chapterId: context.chapter.id,
        chapterName: nextTitle,
        status: "idle",
        error: error?.message ?? String(error),
      };
      if (state.editorChapter?.chapterId === context.chapter.id) {
        state.editorChapter = {
          ...state.editorChapter,
          fileTitle: context.chapter.name,
        };
      }
      persistProjectsForTeam(selectedTeam);
      clearProjectUiDebug(render);
      failProjectsPageSync();
      render();
    }
  });
}

async function persistChapterGlossaryLinks(render, chapterId, nextGlossary1, nextGlossary2) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  const context = findChapterContext(chapterId);

  if (
    !Number.isFinite(selectedTeam?.installationId)
    || !context?.project?.name
    || !context?.chapter
  ) {
    setProjectDiscoveryError(render, "Could not find the selected file.");
    return;
  }

  if (!ensureChapterMutationAllowed(render, {
    selectedTeam,
    actionLabel: "change file glossary links",
  })) {
    return;
  }
  if (await ensureProjectNotTombstoned(render, selectedTeam, context.project)) {
    return;
  }

  const currentGlossary1 = normalizeChapterGlossaryLink(context.chapter.linkedGlossary1);
  const currentGlossary2 = normalizeChapterGlossaryLink(context.chapter.linkedGlossary2);

  if (
    JSON.stringify(nextGlossary1) === JSON.stringify(currentGlossary1)
    && JSON.stringify(nextGlossary2) === JSON.stringify(currentGlossary2)
  ) {
    return;
  }

  const snapshot = cloneProjectCollections();
  const mutation = {
    id: crypto.randomUUID(),
    type: "setGlossaryLinks",
    projectId: context.project.id,
    chapterId,
    glossary1: nextGlossary1,
    glossary2: nextGlossary2,
  };

  state.projectSyncVersion += 1;
  updateChapterInState(chapterId, (chapter) => ({
    ...chapter,
    linkedGlossary1: nextGlossary1,
    linkedGlossary2: nextGlossary2,
  }));
  beginProjectsPageSync();
  persistProjectsForTeam(selectedTeam);
  state.pendingChapterMutations = upsertPendingMutation(state.pendingChapterMutations, mutation);
  persistChapterPendingMutationsForTeam(selectedTeam);
  render();

  void waitForNextPaint().then(async () => {
    try {
      const payload = await invoke("update_gtms_chapter_glossary_links", {
        input: {
          installationId: selectedTeam.installationId,
          projectId: context.project.id,
          repoName: context.project.name,
          chapterId,
          glossary1: chapterGlossaryLinkInput(nextGlossary1),
          glossary2: chapterGlossaryLinkInput(nextGlossary2),
        },
      });

      state.pendingChapterMutations = removePendingMutation(state.pendingChapterMutations, mutation.id);
      persistChapterPendingMutationsForTeam(selectedTeam);
      updateChapterInState(chapterId, (chapter) => ({
        ...chapter,
        linkedGlossary1: normalizeChapterGlossaryLink(payload?.glossary1),
        linkedGlossary2: normalizeChapterGlossaryLink(payload?.glossary2),
      }));
      persistProjectsForTeam(selectedTeam);
      await reconcileProjectRepoSyncStates(render, selectedTeam, [context.project]);
      await refreshProjectFilesFromDisk(render, selectedTeam, [context.project]);
      await completeProjectsPageSync(render);
      render();
    } catch (error) {
      state.pendingChapterMutations = removePendingMutation(state.pendingChapterMutations, mutation.id);
      persistChapterPendingMutationsForTeam(selectedTeam);
      restoreProjectCollections(snapshot);
      persistProjectsForTeam(selectedTeam);
      showNoticeBadge(error?.message ?? String(error), render);
      failProjectsPageSync();
      render();
    }
  });
}

export async function updateChapterGlossaryLinks(render, chapterId, slot, glossaryId) {
  if (slot !== "glossary_1" && slot !== "glossary_2") {
    return;
  }

  const context = findChapterContext(chapterId);
  if (!context?.chapter) {
    setProjectDiscoveryState("error", "Could not find the selected file.");
    render();
    return;
  }

  const nextLink = chapterGlossaryLinkFromGlossaryId(glossaryId);
  if (glossaryId && !nextLink) {
    showNoticeBadge("Could not find the selected glossary.", render);
    return;
  }

  const currentGlossary1 = normalizeChapterGlossaryLink(context.chapter.linkedGlossary1);
  const currentGlossary2 = normalizeChapterGlossaryLink(context.chapter.linkedGlossary2);
  const otherLink = slot === "glossary_1" ? currentGlossary2 : currentGlossary1;
  const nextSummary = glossarySummaryByLink(nextLink);
  const otherSummary = glossarySummaryByLink(otherLink);
  const nextTargetLanguageKey = glossaryTargetLanguageKey(nextSummary);
  const otherTargetLanguageKey = glossaryTargetLanguageKey(otherSummary);

  if (
    nextLink
    && otherLink
    && nextTargetLanguageKey
    && otherTargetLanguageKey
    && nextTargetLanguageKey === otherTargetLanguageKey
  ) {
    state.chapterGlossaryConflict = {
      isOpen: true,
      status: "idle",
      error: "",
      chapterId,
      glossary1: slot === "glossary_1" ? nextLink : null,
      glossary2: slot === "glossary_2" ? nextLink : null,
      message: `Your two glossaries have the same target language. To prevent errors, ${otherSummary?.title ?? "the other glossary"} will be de-selected.`,
    };
    render();
    return;
  }

  await persistChapterGlossaryLinks(
    render,
    chapterId,
    slot === "glossary_1" ? nextLink : currentGlossary1,
    slot === "glossary_2" ? nextLink : currentGlossary2,
  );
}

export async function acknowledgeChapterGlossaryConflict(render) {
  const conflict = state.chapterGlossaryConflict;
  if (!conflict?.isOpen || !conflict.chapterId) {
    return;
  }

  const chapterId = conflict.chapterId;
  const glossary1 = normalizeChapterGlossaryLink(conflict.glossary1);
  const glossary2 = normalizeChapterGlossaryLink(conflict.glossary2);
  resetChapterGlossaryConflict();
  render();
  await persistChapterGlossaryLinks(render, chapterId, glossary1, glossary2);
}

export async function deleteProject(render, projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  state.projectSyncVersion += 1;
  setProjectUiDebug(render, "Delete clicked");
  await submitSimpleTopLevelMutation({
    resource: selectedTeam?.installationId ? project : null,
    type: "softDelete",
    render,
    getBlockedMessage: () =>
      projectLifecycleBlockedMessage(selectedTeam, "delete projects"),
    ensureNotTombstoned: (currentProject) =>
      ensureProjectNotTombstoned(render, selectedTeam, currentProject),
    onMissing: () => {
      setProjectDiscoveryState("error", "Could not find the selected project.");
      render();
    },
    onBlocked: (blockedMessage) => {
      setProjectDiscoveryState("error", blockedMessage);
      render();
    },
    buildMutationFields: (currentProject) => ({
      projectId: currentProject.id,
    }),
    store: {
      ...projectTopLevelMutationStore(selectedTeam),
      beforePersist: () => {
        if (state.projects.length === 0 && state.deletedProjects.length > 0) {
          state.showDeletedProjects = true;
        }
      },
    },
    afterQueue: () => {
      setProjectUiDebug(render, "Optimistic delete applied");
    },
    processQueue: () => {
      setProjectUiDebug(render, "Background sync started");
      return processPendingProjectMutations(render, selectedTeam);
    },
    waitForProcessing: async () => {
      await waitForNextPaint();
      setProjectUiDebug(render, "First paint reached");
    },
  });
}

export async function deleteChapter(render, chapterId) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  const context = findChapterContext(chapterId);

  if (!Number.isFinite(selectedTeam?.installationId) || !context?.project || !context?.chapter) {
    setProjectDiscoveryError(render, "Could not find the selected file.");
    return;
  }

  if (!ensureChapterMutationAllowed(render, { selectedTeam, actionLabel: "delete files" })) {
    return;
  }
  if (await ensureProjectNotTombstoned(render, selectedTeam, context.project)) {
    return;
  }

  const snapshot = cloneProjectCollections();
  const mutation = {
    id: crypto.randomUUID(),
    type: "softDelete",
    projectId: context.project.id,
    chapterId,
  };
  state.projectSyncVersion += 1;
  setProjectUiDebug(render, "Delete clicked");
  updateChapterInState(chapterId, (chapter) => ({
    ...chapter,
    status: "deleted",
  }));
  reconcileExpandedDeletedFiles();
  beginProjectsPageSync();
  persistProjectsForTeam(selectedTeam);
  state.pendingChapterMutations = upsertPendingMutation(state.pendingChapterMutations, mutation);
  persistChapterPendingMutationsForTeam(selectedTeam);
  render();
  setProjectUiDebug(render, "Optimistic delete applied");
  void waitForNextPaint().then(async () => {
    try {
      setProjectUiDebug(render, "Background sync started");
      await invoke("soft_delete_gtms_chapter", {
        input: {
          installationId: selectedTeam.installationId,
          projectId: context.project.id,
          repoName: context.project.name,
          chapterId,
        },
      });
      state.pendingChapterMutations = removePendingMutation(state.pendingChapterMutations, mutation.id);
      persistChapterPendingMutationsForTeam(selectedTeam);
      await reconcileProjectRepoSyncStates(render, selectedTeam, [context.project]);
      await refreshProjectFilesFromDisk(render, selectedTeam, [context.project]);
      clearProjectUiDebug(render);
      await completeProjectsPageSync(render);
      render();
    } catch (error) {
      state.pendingChapterMutations = removePendingMutation(state.pendingChapterMutations, mutation.id);
      persistChapterPendingMutationsForTeam(selectedTeam);
      restoreProjectCollections(snapshot);
      persistProjectsForTeam(selectedTeam);
      clearProjectUiDebug(render);
      failProjectsPageSync();
      showNoticeBadge(error?.message ?? String(error), render);
      render();
    }
  });
}

export async function restoreChapter(render, chapterId) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  const context = findChapterContext(chapterId);

  if (!Number.isFinite(selectedTeam?.installationId) || !context?.project || !context?.chapter) {
    setProjectDiscoveryError(render, "Could not find the selected deleted file.");
    return;
  }

  if (!ensureChapterMutationAllowed(render, { selectedTeam, actionLabel: "restore files" })) {
    return;
  }
  if (await ensureProjectNotTombstoned(render, selectedTeam, context.project)) {
    return;
  }

  const snapshot = cloneProjectCollections();
  const mutation = {
    id: crypto.randomUUID(),
    type: "restore",
    projectId: context.project.id,
    chapterId,
  };
  state.projectSyncVersion += 1;
  setProjectUiDebug(render, "Restore clicked");
  updateChapterInState(chapterId, (chapter) => ({
    ...chapter,
    status: "active",
  }));
  reconcileExpandedDeletedFiles();
  beginProjectsPageSync();
  persistProjectsForTeam(selectedTeam);
  state.pendingChapterMutations = upsertPendingMutation(state.pendingChapterMutations, mutation);
  persistChapterPendingMutationsForTeam(selectedTeam);
  render();
  setProjectUiDebug(render, "Optimistic restore applied");
  void waitForNextPaint().then(async () => {
    try {
      setProjectUiDebug(render, "Background sync started");
      await invoke("restore_gtms_chapter", {
        input: {
          installationId: selectedTeam.installationId,
          projectId: context.project.id,
          repoName: context.project.name,
          chapterId,
        },
      });
      state.pendingChapterMutations = removePendingMutation(state.pendingChapterMutations, mutation.id);
      persistChapterPendingMutationsForTeam(selectedTeam);
      await reconcileProjectRepoSyncStates(render, selectedTeam, [context.project]);
      await refreshProjectFilesFromDisk(render, selectedTeam, [context.project]);
      clearProjectUiDebug(render);
      await completeProjectsPageSync(render);
      render();
    } catch (error) {
      state.pendingChapterMutations = removePendingMutation(state.pendingChapterMutations, mutation.id);
      persistChapterPendingMutationsForTeam(selectedTeam);
      restoreProjectCollections(snapshot);
      persistProjectsForTeam(selectedTeam);
      clearProjectUiDebug(render);
      failProjectsPageSync();
      showNoticeBadge(error?.message ?? String(error), render);
      render();
    }
  });
}

export async function permanentlyDeleteChapter(render, chapterId) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  const context = findChapterContext(chapterId);

  if (!Number.isFinite(selectedTeam?.installationId) || !context?.project || !context?.chapter) {
    setProjectDiscoveryError(render, "Could not find the selected deleted file.");
    return;
  }

  if (!ensureChapterMutationAllowed(render, {
    selectedTeam,
    actionLabel: "permanently delete files",
    requireDelete: true,
  })) {
    return;
  }
  if (await ensureProjectNotTombstoned(render, selectedTeam, context.project)) {
    return;
  }

  const snapshot = cloneProjectCollections();
  const mutation = {
    id: crypto.randomUUID(),
    type: "permanentDelete",
    projectId: context.project.id,
    chapterId,
  };
  state.projectSyncVersion += 1;
  setProjectUiDebug(render, "Permanent delete clicked");
  const nextSnapshot = applyChapterPendingMutation(
    { items: state.projects, deletedItems: state.deletedProjects },
    mutation,
  );
  applyProjectSnapshotToState(nextSnapshot, { reconcileExpandedDeletedFiles });
  beginProjectsPageSync();
  persistProjectsForTeam(selectedTeam);
  state.pendingChapterMutations = upsertPendingMutation(state.pendingChapterMutations, mutation);
  persistChapterPendingMutationsForTeam(selectedTeam);
  render();
  setProjectUiDebug(render, "Optimistic permanent delete applied");
  void waitForNextPaint().then(async () => {
    try {
      setProjectUiDebug(render, "Background sync started");
      await invoke("permanently_delete_gtms_chapter", {
        input: {
          installationId: selectedTeam.installationId,
          projectId: context.project.id,
          repoName: context.project.name,
          chapterId,
        },
      });
      state.pendingChapterMutations = removePendingMutation(state.pendingChapterMutations, mutation.id);
      persistChapterPendingMutationsForTeam(selectedTeam);
      await reconcileProjectRepoSyncStates(render, selectedTeam, [context.project]);
      await refreshProjectFilesFromDisk(render, selectedTeam, [context.project]);
      clearProjectUiDebug(render);
      await completeProjectsPageSync(render);
      render();
    } catch (error) {
      state.pendingChapterMutations = removePendingMutation(state.pendingChapterMutations, mutation.id);
      persistChapterPendingMutationsForTeam(selectedTeam);
      restoreProjectCollections(snapshot);
      persistProjectsForTeam(selectedTeam);
      clearProjectUiDebug(render);
      failProjectsPageSync();
      showNoticeBadge(error?.message ?? String(error), render);
      render();
    }
  });
}

export async function confirmChapterPermanentDeletion(render) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  const context = findChapterContext(state.chapterPermanentDeletion.chapterId);

  if (!Number.isFinite(selectedTeam?.installationId) || !context?.project || !context?.chapter) {
    state.chapterPermanentDeletion.status = "idle";
    state.chapterPermanentDeletion.error = "Could not find the selected deleted file.";
    render();
    return;
  }

  if (state.offline?.isEnabled === true) {
    state.chapterPermanentDeletion.status = "idle";
    state.chapterPermanentDeletion.error = "You cannot permanently delete files while offline.";
    render();
    return;
  }

  if (!canPermanentlyDeleteProjectFiles(selectedTeam)) {
    state.chapterPermanentDeletion.status = "idle";
    state.chapterPermanentDeletion.error =
      "You do not have permission to permanently delete files in this team.";
    render();
    return;
  }

  if (state.chapterPermanentDeletion.confirmationText !== state.chapterPermanentDeletion.chapterName) {
    state.chapterPermanentDeletion.error = "File name confirmation does not match.";
    render();
    return;
  }

  state.chapterPermanentDeletion.status = "loading";
  state.chapterPermanentDeletion.error = "";
  render();
  await waitForNextPaint();
  const chapterId = state.chapterPermanentDeletion.chapterId;
  resetChapterPermanentDeletion();
  render();
  await permanentlyDeleteChapter(render, chapterId);
}

export function toggleDeletedProjects(render) {
  state.showDeletedProjects = !state.showDeletedProjects;
  render();
}

export async function restoreProject(render, projectId) {
  const project = state.deletedProjects.find((item) => item.id === projectId);
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  state.projectSyncVersion += 1;
  setProjectUiDebug(render, "Restore clicked");
  await submitSimpleTopLevelMutation({
    resource: selectedTeam?.installationId ? project : null,
    type: "restore",
    render,
    getBlockedMessage: () =>
      projectLifecycleBlockedMessage(selectedTeam, "restore projects"),
    ensureNotTombstoned: (currentProject) =>
      ensureProjectNotTombstoned(render, selectedTeam, currentProject),
    onMissing: () => {
      setProjectDiscoveryState("error", selectedTeam?.installationId
        ? "Could not find the selected deleted project."
        : "Could not restore the selected project.");
      render();
    },
    onBlocked: (blockedMessage) => {
      setProjectDiscoveryState("error", blockedMessage);
      render();
    },
    buildMutationFields: (currentProject) => ({
      projectId: currentProject.id,
    }),
    store: projectTopLevelMutationStore(selectedTeam),
    afterQueue: () => {
      setProjectUiDebug(render, "Optimistic restore applied");
    },
    processQueue: () => {
      setProjectUiDebug(render, "Background sync started");
      return processPendingProjectMutations(render, selectedTeam);
    },
    waitForProcessing: async () => {
      await waitForNextPaint();
      setProjectUiDebug(render, "First paint reached");
    },
  });
}

async function commitProjectMutation(selectedTeam, mutation) {
  const project =
    state.projects.find((item) => item.id === mutation.projectId) ??
    state.deletedProjects.find((item) => item.id === mutation.projectId);

  if (!selectedTeam?.installationId || !project) {
    return;
  }

  await commitMetadataFirstTopLevelMutation({
    mutation,
    resource: project,
    resourceLabel: "project",
    writeMetadata: (record) => upsertProjectMetadataRecord(selectedTeam, record),
    buildRecord: (currentProject, overrides = {}) =>
      projectMetadataRecordFromVisibleProject(currentProject, overrides),
    applyLocalMutation: (currentProject, currentMutation) => {
      if (currentMutation.type === "rename") {
        return invoke("rename_gnosis_project_repo", {
          input: {
            installationId: selectedTeam.installationId,
            fullName: currentProject.fullName,
            projectTitle: currentMutation.title,
          },
          sessionToken: requireBrokerSession(),
        });
      }

      if (currentMutation.type === "softDelete") {
        return invoke("mark_gnosis_project_repo_deleted", {
          input: {
            installationId: selectedTeam.installationId,
            orgLogin: selectedTeam.githubOrg,
            repoName: currentProject.name,
          },
          sessionToken: requireBrokerSession(),
        });
      }

      if (currentMutation.type === "restore") {
        return invoke("restore_gnosis_project_repo", {
          input: {
            installationId: selectedTeam.installationId,
            orgLogin: selectedTeam.githubOrg,
            repoName: currentProject.name,
          },
          sessionToken: requireBrokerSession(),
        });
      }

      return Promise.resolve();
    },
  });
}

async function processPendingProjectMutations(render, selectedTeam) {
  await processQueuedResourceMutations({
    getPendingMutations: () => state.pendingProjectMutations,
    inflightMutationIds: inflightProjectMutationIds,
    waitForNextPaint,
    commitMutation: (mutation) => commitProjectMutation(selectedTeam, mutation),
    setPendingMutations: (mutations) => {
      state.pendingProjectMutations = mutations;
    },
    persistPendingMutations: (mutations) => saveStoredProjectPendingMutations(selectedTeam, mutations),
    persistVisibleState: () => saveStoredProjectsForTeam(selectedTeam, {
      projects: state.projects,
      deletedProjects: state.deletedProjects,
    }),
    rollbackVisibleMutation: (mutation) =>
      rollbackVisibleProjectMutation(mutation, { reconcileExpandedDeletedFiles }),
    onMutationError: async (_mutation, error) => {
      if (await handleSyncFailure(classifySyncError(error), { render })) {
        clearProjectUiDebug(render);
        failProjectsPageSync();
        return true;
      }
      await loadTeamProjects(render, selectedTeam?.id);
      clearProjectUiDebug(render);
      await completeProjectsPageSync(render);
      render();
      return true;
    },
    onQueueComplete: async () => {
      clearProjectUiDebug(render);
      await completeProjectsPageSync(render);
      render();
    },
  });
}

export function permanentlyDeleteProject(render, projectId) {
  const project = state.deletedProjects.find((item) => item.id === projectId);
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  void guardTopLevelResourceAction({
    resource: project,
    isExpectedResource: (currentProject) =>
      Boolean(currentProject) && currentProject.lifecycleState === "deleted",
    getBlockedMessage: () =>
      selectedTeam?.canDelete === true
        ? ""
        : "You do not have permission to delete projects in this team.",
    ensureNotTombstoned: (currentProject) =>
      ensureProjectNotTombstoned(render, selectedTeam, currentProject),
    onMissing: () => {
      setProjectDiscoveryState("error", "Could not find the selected deleted project.");
      render();
    },
    onBlocked: (blockedMessage) => {
      setProjectDiscoveryState("error", blockedMessage);
      render();
    },
  }).then((allowed) => {
    if (!allowed) {
      return;
    }

    openEntityConfirmationModal({
      setState: (nextState) => {
        state.projectPermanentDeletion = nextState;
      },
      entityId: projectId,
      idField: "projectId",
      nameField: "projectName",
      confirmationField: "confirmationText",
      currentName: project.title ?? project.name,
    });
    render();
  });
}

export function updateProjectPermanentDeletionConfirmation(value) {
  updateEntityModalConfirmation(state.projectPermanentDeletion, "confirmationText", value);
}

export function cancelProjectPermanentDeletion(render) {
  cancelEntityModal(resetProjectPermanentDeletion, render);
}

export async function confirmProjectPermanentDeletion(render) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  const project = state.deletedProjects.find(
    (item) => item.id === state.projectPermanentDeletion.projectId,
  );
  const confirmationText = state.projectPermanentDeletion.confirmationText;
  const allowed = await guardPermanentDeleteConfirmation({
    resource: selectedTeam?.installationId ? project : null,
    modalState: state.projectPermanentDeletion,
    missingMessage: "Could not find the selected deleted project.",
    getBlockedMessage: () => {
      if (state.offline?.isEnabled === true) {
        return "You cannot delete projects while offline.";
      }
      return selectedTeam?.canDelete === true
        ? ""
        : "You do not have permission to delete projects in this team.";
    },
    confirmationMessage: "Project name confirmation does not match.",
    matchesConfirmation: () => entityConfirmationMatches(state.projectPermanentDeletion, {
      nameField: "projectName",
      confirmationField: "confirmationText",
    }),
    ensureNotTombstoned: (currentProject) =>
      ensureProjectNotTombstoned(render, selectedTeam, currentProject),
    onTombstoned: () => {
      resetProjectPermanentDeletion();
      render();
    },
    extraGuard: () => {
      if (!state.projectCreationInFlightIds.has(project.id)) {
        return true;
      }
      state.projectPermanentDeletion.status = "idle";
      state.projectPermanentDeletion.error =
        "This project is still finishing creation in the background. Wait a moment, then try deleting it permanently again.";
      return false;
    },
    render,
  });
  if (!allowed) {
    return;
  }

  const snapshot = cloneProjectCollections();
  await applyOptimisticPermanentDelete({
    beforeWait: () => {
      beginEntityModalSubmit(state.projectPermanentDeletion, render);
    },
    waitForNextPaint,
    beforeRemove: () => {
      state.projectSyncVersion += 1;
      beginProjectsPageSync();
      setProjectUiDebug(render, "Deleting project...");
    },
    removeVisibleResource: () => {
      removeVisibleProject(project.id);
    },
    persistVisibleState: () => {
      persistProjectsForTeam(selectedTeam);
    },
    resetModal: resetProjectPermanentDeletion,
    render,
  });

  runPermanentDeleteLocalFirst({
    commitTombstone: () => upsertProjectMetadataRecord(selectedTeam, {
      ...projectMetadataRecordFromVisibleProject(project),
      lifecycleState: "softDeleted",
      remoteState: "deleted",
      recordState: "tombstone",
      deletedAt: new Date().toISOString(),
    }),
    purgeLocalRepo: () => invoke("purge_local_gtms_project_repo", {
      input: {
        installationId: selectedTeam.installationId,
        projectId: project.id,
        repoName: project.name,
      },
    }),
    deleteRemote: () => invoke("permanently_delete_gnosis_project_repo", {
      input: {
        installationId: selectedTeam.installationId,
        orgLogin: selectedTeam.githubOrg,
        repoName: project.name,
      },
      sessionToken: requireBrokerSession(),
    }),
    reloadAfterSuccess: async () => {
      clearProjectUiDebug(render);
      await completeProjectsPageSync(render);
      render();
      await loadTeamProjects(render, selectedTeam.id);
    },
    rollbackBeforeTombstone: async (error) => {
      if (await handleSyncFailure(classifySyncError(error), { render })) {
        clearProjectUiDebug(render);
        failProjectsPageSync();
        return;
      }

      rollbackOptimisticPermanentDelete({
        restoreVisibleState: () => {
          restoreProjectCollections(snapshot);
        },
        persistVisibleState: () => {
          persistProjectsForTeam(selectedTeam);
        },
        reopenModal: () => {
          reopenEntityConfirmationModalWithError({
            setState: (nextState) => {
              state.projectPermanentDeletion = nextState;
            },
            entityId: project.id,
            idField: "projectId",
            nameField: "projectName",
            confirmationField: "confirmationText",
            currentName: project.title ?? project.name,
            confirmationText,
            error: error?.message ?? String(error),
          });
        },
        afterRollback: () => {
          clearProjectUiDebug(render);
          failProjectsPageSync();
        },
        render,
      });
    },
    onRemoteDeleteError: async (error) => {
      clearProjectUiDebug(render);
      await completeProjectsPageSync(render);
      showPermanentDeleteFollowupNotice({
        resourceLabel: "Project",
        phase: "remote cleanup",
        error,
        render,
      });
      render();
    },
    onLocalDeleteError: async (error) => {
      if (await handleSyncFailure(classifySyncError(error), { render })) {
        clearProjectUiDebug(render);
        failProjectsPageSync();
        return true;
      }

      showPermanentDeleteFollowupNotice({
        resourceLabel: "Project",
        phase: "local cleanup",
        error,
        render,
      });
      clearProjectUiDebug(render);
      failProjectsPageSync();
      render();
      return true;
    },
  });
}
