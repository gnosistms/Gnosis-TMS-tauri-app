import { invoke, waitForNextPaint } from "./runtime.js";
import { requireBrokerSession } from "./auth-flow.js";
import {
  beginProjectsPageSync,
  completeProjectsPageSync,
  failProjectsPageSync,
} from "./page-sync.js";
import {
  saveStoredChapterPendingMutations,
  loadStoredProjectsForTeam,
  saveStoredProjectsForTeam,
} from "./project-cache.js";
import {
  removePendingMutation,
  upsertPendingMutation,
} from "./optimistic-collection.js";
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
import { appendRepoNameSuffix, slugifyRepoName } from "./repo-names.js";
import {
  loadTeamProjects as runLoadTeamProjects,
  refreshProjectFilesFromDisk as runRefreshProjectFilesFromDisk,
} from "./project-discovery-flow.js";
import {
  listProjectMetadataRecords,
  lookupLocalMetadataTombstone,
  repairLocalRepoBinding,
  upsertProjectMetadataRecord,
} from "./team-metadata-flow.js";
import {
  commitMetadataFirstTopLevelMutation,
  ensureResourceNotTombstoned,
  guardPermanentDeleteConfirmation,
  guardTopLevelResourceAction,
} from "./resource-lifecycle-engine.js";
import {
  openTopLevelRenameModal,
} from "./resource-top-level-controller.js";
import {
  applyProjectSnapshotToState,
  sortProjectSnapshot,
} from "./project-top-level-state.js";
import {
  canCreateRepoResources,
  canPermanentlyDeleteProjectFiles,
} from "./resource-capabilities.js";
import {
  areResourcePageWritesDisabled,
  submitResourcePageWrite,
} from "./resource-page-controller.js";
import {
  cancelEntityModal,
  entityConfirmationMatches,
  openEntityFormModal,
  openEntityConfirmationModal,
  updateEntityModalConfirmation,
  updateEntityFormField,
  updateEntityModalName,
} from "./resource-entity-modal.js";
import {
  guardResourceCreateStart,
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

function persistChapterPendingMutationsForTeam(selectedTeam) {
  saveStoredChapterPendingMutations(selectedTeam, state.pendingChapterMutations);
}

async function completeProjectCreateSynchronously(selectedTeam, projectTitle, baseRepoName) {
  const projectId = crypto.randomUUID();
  const normalizedBase = String(baseRepoName ?? "").trim();
  let remoteProject = null;
  let finalRepoName = "";
  let collisionResolved = false;
  let localRepoInitialized = false;

  if (!normalizedBase) {
    throw new Error("Could not determine the repo name.");
  }

  try {
    const usedLocalRepoNames = new Set(
      [...(state.projects ?? []), ...(state.deletedProjects ?? [])]
        .map((project) => String(project?.name ?? "").trim())
        .filter(Boolean),
    );

    for (let attempt = 1; attempt <= 100; attempt += 1) {
      const candidateRepoName = appendRepoNameSuffix(normalizedBase, attempt);
      if (usedLocalRepoNames.has(candidateRepoName)) {
        continue;
      }

      try {
        remoteProject = await invoke("create_gnosis_project_repo", {
          input: {
            installationId: selectedTeam.installationId,
            orgLogin: selectedTeam.githubOrg,
            repoName: candidateRepoName,
            projectTitle,
            projectId,
          },
          sessionToken: requireBrokerSession(),
        });
        finalRepoName = candidateRepoName;
        collisionResolved = attempt > 1;
        break;
      } catch (error) {
        const message = String(error?.message ?? error ?? "").toLowerCase();
        if (!message.includes("name already exists on this account")) {
          throw error;
        }
      }
    }

    if (!remoteProject || !finalRepoName) {
      throw new Error("Could not determine an available repo name.");
    }

    await invoke("initialize_gtms_project_repo", {
      input: {
        installationId: selectedTeam.installationId,
        projectId,
        repoName: finalRepoName,
        title: projectTitle,
      },
    });
    localRepoInitialized = true;

    await upsertProjectMetadataRecord(
      selectedTeam,
      {
        projectId,
        title: projectTitle,
        repoName: remoteProject.name,
        previousRepoNames: remoteProject.name !== finalRepoName ? [finalRepoName] : [],
        githubRepoId: remoteProject.repoId ?? null,
        githubNodeId: remoteProject.nodeId ?? null,
        fullName: remoteProject.fullName ?? null,
        defaultBranch: remoteProject.defaultBranchName || "main",
        lifecycleState: "active",
        remoteState: "linked",
        recordState: "live",
        deletedAt: null,
        chapterCount: 0,
      },
      { requirePushSuccess: true },
    );

    return {
      projectId,
      title: projectTitle,
      repoName: finalRepoName,
      collisionResolved,
    };
  } catch (error) {
    if (localRepoInitialized) {
      try {
        await invoke("purge_local_gtms_project_repo", {
          input: {
            installationId: selectedTeam.installationId,
            projectId,
            repoName: finalRepoName || remoteProject?.name || normalizedBase,
          },
        });
      } catch {}
    }

    if (remoteProject) {
      try {
        await invoke("permanently_delete_gnosis_project_repo", {
          input: {
            installationId: selectedTeam.installationId,
            orgLogin: selectedTeam.githubOrg,
            repoName: remoteProject.name,
          },
          sessionToken: requireBrokerSession(),
        });
      } catch (rollbackError) {
        throw new Error(
          `${error?.message ?? String(error)} Automatic project create rollback also failed: ${
            rollbackError?.message ?? String(rollbackError)
          }`,
        );
      }
    }

    throw error;
  }
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
      ?? (project.remoteState ?? "linked"),
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

export async function refreshProjectFilesFromDisk(render, selectedTeam, projects) {
  return runRefreshProjectFilesFromDisk(render, selectedTeam, projects, {
    applyChapterPendingMutation,
    normalizeListedChapter,
    persistProjectsForTeam,
    reconcileExpandedDeletedFiles,
  });
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

function enqueueChapterMutation(selectedTeam, mutation) {
  state.pendingChapterMutations = upsertPendingMutation(state.pendingChapterMutations, mutation);
  persistChapterPendingMutationsForTeam(selectedTeam);
}

function completeChapterMutation(selectedTeam, mutationId) {
  state.pendingChapterMutations = removePendingMutation(state.pendingChapterMutations, mutationId);
  persistChapterPendingMutationsForTeam(selectedTeam);
}

function startOptimisticChapterMutation({
  render,
  selectedTeam,
  context,
  mutation,
  applyOptimistic,
  optimisticDebugText = "",
  remoteDebugText = "",
  beforeReconcile,
  rollback,
  runRemote,
  showFailureNotice = true,
}) {
  const snapshot = cloneProjectCollections();

  state.projectSyncVersion += 1;
  applyOptimistic?.();
  beginProjectsPageSync();
  persistProjectsForTeam(selectedTeam);
  enqueueChapterMutation(selectedTeam, mutation);
  render();

  if (optimisticDebugText) {
    setProjectUiDebug(render, optimisticDebugText);
  }

  void waitForNextPaint().then(async () => {
    try {
      if (remoteDebugText) {
        setProjectUiDebug(render, remoteDebugText);
      }
      const payload = await runRemote();
      completeChapterMutation(selectedTeam, mutation.id);
      await beforeReconcile?.(payload);
      await reconcileProjectRepoSyncStates(render, selectedTeam, [context.project]);
      await refreshProjectFilesFromDisk(render, selectedTeam, [context.project]);
      clearProjectUiDebug(render);
      await completeProjectsPageSync(render);
      render();
    } catch (error) {
      completeChapterMutation(selectedTeam, mutation.id);
      restoreProjectCollections(snapshot);
      await rollback?.(error);
      persistProjectsForTeam(selectedTeam);
      clearProjectUiDebug(render);
      failProjectsPageSync();
      if (showFailureNotice) {
        showNoticeBadge(error?.message ?? String(error), render);
      }
      render();
    }
  });
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

export async function loadTeamProjects(render, teamId = state.selectedTeamId) {
  state.projectsPage.isRefreshing = true;
  render?.();
  try {
    return await runLoadTeamProjects(render, teamId, {
      applyChapterPendingMutation,
      clearProjectUiDebug,
      clearSelectedProjectState,
      dropProjectMutationsForProject,
      loadStoredProjectsForTeam,
      normalizeListedChapter,
      persistProjectsForTeam,
      projectMatchesMetadataRecord,
      projectMetadataRecordIsTombstone,
      purgeLocalProjectRepo,
      reconcileExpandedDeletedFiles,
      removeVisibleProject,
      setProjectDiscoveryState,
      setProjectUiDebug,
      upsertProjectMetadataRecord,
    });
  } finally {
    state.projectsPage.isRefreshing = false;
    render?.();
  }
}

export async function createProjectForSelectedTeam(render) {
  const selectedTeam = selectedProjectsTeam();
  if (areResourcePageWritesDisabled(state.projectsPage)) {
    setProjectDiscoveryState("error", "Wait for the current projects refresh or write to finish.");
    render();
    return;
  }
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
  const selectedTeam = selectedProjectsTeam();
  if (areResourcePageWritesDisabled(state.projectsPage)) {
    setProjectDiscoveryState("error", "Wait for the current projects refresh or write to finish.");
    render();
    return;
  }
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
  const selectedTeam = selectedProjectsTeam();
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
  const selectedTeam = selectedProjectsTeam();
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
  const selectedTeam = selectedProjectsTeam();
  if (areResourcePageWritesDisabled(state.projectsPage)) {
    state.projectCreation.error = "Wait for the current projects refresh or write to finish.";
    render();
    return;
  }
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

  state.projectCreation.status = "loading";
  state.projectCreation.error = "";
  render();
  await submitResourcePageWrite({
    pageState: state.projectsPage,
    render,
    onBlocked: async () => {
      state.projectCreation.status = "idle";
      state.projectCreation.error = "Wait for the current projects refresh or write to finish.";
      render();
    },
    runMutation: async () =>
      completeProjectCreateSynchronously(selectedTeam, projectTitle, repoName),
    refreshOptions: {
      loadData: async () => reloadProjectsAfterWrite(render, selectedTeam),
    },
    onSuccess: async (result) => {
      resetProjectCreation();
      state.selectedProjectId = result.projectId;
      showNoticeBadge(
        result.collisionResolved
          ? `Created project ${result.title} in repo ${result.repoName} because that repo name was already taken.`
          : `Created project ${result.title}.`,
        render,
      );
    },
    onError: async (error) => {
      if (await handleSyncFailure(classifySyncError(error), { render })) {
        return;
      }
      state.projectCreation.status = "idle";
      state.projectCreation.error = error?.message ?? String(error);
    },
  });
}

export async function submitProjectRename(render) {
  const selectedTeam = selectedProjectsTeam();
  const project = state.projects.find((item) => item.id === state.projectRename.projectId);
  const nextTitle = String(state.projectRename.projectName ?? "").trim();
  const allowed = await guardTopLevelResourceAction({
    resource: selectedTeam?.installationId ? project : null,
    getBlockedMessage: () =>
      projectLifecycleBlockedMessage(selectedTeam, "rename projects"),
    ensureNotTombstoned: (currentProject) =>
      ensureProjectNotTombstoned(render, selectedTeam, currentProject),
    onMissing: () => {
      state.projectRename.error = "Could not find the selected project.";
      render();
    },
    onBlocked: (blockedMessage) => {
      state.projectRename.error = blockedMessage;
      render();
    },
    onTombstoned: () => {
      resetProjectRename();
      render();
    },
  });
  if (!allowed) {
    return;
  }
  if (!nextTitle) {
    state.projectRename.error = "Enter a project name.";
    render();
    return;
  }

  state.projectRename.status = "loading";
  state.projectRename.error = "";
  render();
  await submitResourcePageWrite({
    pageState: state.projectsPage,
    render,
    onBlocked: async () => {
      state.projectRename.status = "idle";
      state.projectRename.error = "Wait for the current projects refresh or write to finish.";
      render();
    },
    runMutation: async () => {
      await commitProjectMutationStrict(selectedTeam, {
        type: "rename",
        projectId: project.id,
        title: nextTitle,
        previousTitle: project.title ?? project.name,
      });
    },
    refreshOptions: {
      loadData: async () => reloadProjectsAfterWrite(render, selectedTeam),
    },
    onSuccess: async () => {
      resetProjectRename();
    },
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
  const selectedTeam = selectedProjectsTeam();
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
  const selectedTeam = selectedProjectsTeam();
  if (!selectedTeam?.installationId || typeof projectId !== "string" || !projectId.trim()) {
    return;
  }

  showNoticeBadge("Rebuilding the local project repo from metadata and GitHub...", render, 2200);
  await loadTeamProjects(render, selectedTeam.id);
}

export async function submitChapterRename(render) {
  const selectedTeam = selectedProjectsTeam();
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

  const mutation = {
    id: crypto.randomUUID(),
    type: "rename",
    projectId: context.project.id,
    chapterId: context.chapter.id,
    title: nextTitle,
  };
  resetChapterRename();
  startOptimisticChapterMutation({
    render,
    selectedTeam,
    context,
    mutation,
    applyOptimistic: () => {
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
    },
    optimisticDebugText: "Optimistic file rename applied",
    remoteDebugText: "Saving file...",
    beforeReconcile: async () => {
      setProjectUiDebug(render, "Background sync started");
    },
    rollback: async (error) => {
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
    },
    runRemote: async () => invoke("rename_gtms_chapter", {
        input: {
          installationId: selectedTeam.installationId,
          projectId: context.project.id,
          repoName: context.project.name,
          chapterId: context.chapter.id,
          title: nextTitle,
        },
      }),
    showFailureNotice: false,
  });
}

async function persistChapterGlossaryLinks(render, chapterId, nextGlossary1, nextGlossary2) {
  const selectedTeam = selectedProjectsTeam();
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

  const mutation = {
    id: crypto.randomUUID(),
    type: "setGlossaryLinks",
    projectId: context.project.id,
    chapterId,
    glossary1: nextGlossary1,
    glossary2: nextGlossary2,
  };

  startOptimisticChapterMutation({
    render,
    selectedTeam,
    context,
    mutation,
    applyOptimistic: () => {
      updateChapterInState(chapterId, (chapter) => ({
        ...chapter,
        linkedGlossary1: nextGlossary1,
        linkedGlossary2: nextGlossary2,
      }));
    },
    runRemote: async () => invoke("update_gtms_chapter_glossary_links", {
        input: {
          installationId: selectedTeam.installationId,
          projectId: context.project.id,
          repoName: context.project.name,
          chapterId,
          glossary1: chapterGlossaryLinkInput(nextGlossary1),
          glossary2: chapterGlossaryLinkInput(nextGlossary2),
        },
      }),
    beforeReconcile: async (payload) => {
      updateChapterInState(chapterId, (chapter) => ({
        ...chapter,
        linkedGlossary1: normalizeChapterGlossaryLink(payload?.glossary1),
        linkedGlossary2: normalizeChapterGlossaryLink(payload?.glossary2),
      }));
      persistProjectsForTeam(selectedTeam);
    },
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
  const selectedTeam = selectedProjectsTeam();
  const allowed = await guardTopLevelResourceAction({
    resource: selectedTeam?.installationId ? project : null,
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
  });
  if (!allowed) {
    return;
  }

  await submitResourcePageWrite({
    pageState: state.projectsPage,
    render,
    onBlocked: async () => {
      setProjectDiscoveryState("error", "Wait for the current projects refresh or write to finish.");
      render();
    },
    runMutation: async () => {
      await commitProjectMutationStrict(selectedTeam, {
        type: "softDelete",
        projectId: project.id,
      });
    },
    refreshOptions: {
      loadData: async () => reloadProjectsAfterWrite(render, selectedTeam),
    },
    onSuccess: async () => {
      if (state.projects.length === 0 && state.deletedProjects.length > 0) {
        state.showDeletedProjects = true;
      }
    },
    onError: async (error) => {
      if (await handleSyncFailure(classifySyncError(error), { render })) {
        return;
      }
      setProjectDiscoveryState("error", error?.message ?? String(error));
      render();
    },
  });
}

export async function deleteChapter(render, chapterId) {
  const selectedTeam = selectedProjectsTeam();
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

  const mutation = {
    id: crypto.randomUUID(),
    type: "softDelete",
    projectId: context.project.id,
    chapterId,
  };
  startOptimisticChapterMutation({
    render,
    selectedTeam,
    context,
    mutation,
    applyOptimistic: () => {
      setProjectUiDebug(render, "Delete clicked");
      updateChapterInState(chapterId, (chapter) => ({
        ...chapter,
        status: "deleted",
      }));
      reconcileExpandedDeletedFiles();
    },
    optimisticDebugText: "Optimistic delete applied",
    remoteDebugText: "Background sync started",
    runRemote: async () => invoke("soft_delete_gtms_chapter", {
        input: {
          installationId: selectedTeam.installationId,
          projectId: context.project.id,
          repoName: context.project.name,
          chapterId,
        },
      }),
  });
}

export async function restoreChapter(render, chapterId) {
  const selectedTeam = selectedProjectsTeam();
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

  const mutation = {
    id: crypto.randomUUID(),
    type: "restore",
    projectId: context.project.id,
    chapterId,
  };
  startOptimisticChapterMutation({
    render,
    selectedTeam,
    context,
    mutation,
    applyOptimistic: () => {
      setProjectUiDebug(render, "Restore clicked");
      updateChapterInState(chapterId, (chapter) => ({
        ...chapter,
        status: "active",
      }));
      reconcileExpandedDeletedFiles();
    },
    optimisticDebugText: "Optimistic restore applied",
    remoteDebugText: "Background sync started",
    runRemote: async () => invoke("restore_gtms_chapter", {
        input: {
          installationId: selectedTeam.installationId,
          projectId: context.project.id,
          repoName: context.project.name,
          chapterId,
        },
      }),
  });
}

export async function permanentlyDeleteChapter(render, chapterId) {
  const selectedTeam = selectedProjectsTeam();
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

  const mutation = {
    id: crypto.randomUUID(),
    type: "permanentDelete",
    projectId: context.project.id,
    chapterId,
  };
  startOptimisticChapterMutation({
    render,
    selectedTeam,
    context,
    mutation,
    applyOptimistic: () => {
      setProjectUiDebug(render, "Permanent delete clicked");
      const nextSnapshot = applyChapterPendingMutation(
        { items: state.projects, deletedItems: state.deletedProjects },
        mutation,
      );
      applyProjectSnapshotToState(nextSnapshot, { reconcileExpandedDeletedFiles });
    },
    optimisticDebugText: "Optimistic permanent delete applied",
    remoteDebugText: "Background sync started",
    runRemote: async () => invoke("permanently_delete_gtms_chapter", {
        input: {
          installationId: selectedTeam.installationId,
          projectId: context.project.id,
          repoName: context.project.name,
          chapterId,
        },
      }),
  });
}

export async function confirmChapterPermanentDeletion(render) {
  const selectedTeam = selectedProjectsTeam();
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
  const selectedTeam = selectedProjectsTeam();
  const allowed = await guardTopLevelResourceAction({
    resource: selectedTeam?.installationId ? project : null,
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
  });
  if (!allowed) {
    return;
  }

  await submitResourcePageWrite({
    pageState: state.projectsPage,
    render,
    onBlocked: async () => {
      setProjectDiscoveryState("error", "Wait for the current projects refresh or write to finish.");
      render();
    },
    runMutation: async () => {
      await commitProjectMutationStrict(selectedTeam, {
        type: "restore",
        projectId: project.id,
      });
    },
    refreshOptions: {
      loadData: async () => reloadProjectsAfterWrite(render, selectedTeam),
    },
    onError: async (error) => {
      if (await handleSyncFailure(classifySyncError(error), { render })) {
        return;
      }
      setProjectDiscoveryState("error", error?.message ?? String(error));
      render();
    },
  });
}

async function commitProjectMutationStrict(selectedTeam, mutation) {
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
    writeMetadata: (record) => upsertProjectMetadataRecord(selectedTeam, record, { requirePushSuccess: true }),
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

async function reloadProjectsAfterWrite(render, selectedTeam) {
  await loadTeamProjects(render, selectedTeam?.id);
  return [...state.projects, ...state.deletedProjects];
}

export function permanentlyDeleteProject(render, projectId) {
  const project = state.deletedProjects.find((item) => item.id === projectId);
  const selectedTeam = selectedProjectsTeam();
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
  const selectedTeam = selectedProjectsTeam();
  const project = state.deletedProjects.find(
    (item) => item.id === state.projectPermanentDeletion.projectId,
  );
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
    render,
  });
  if (!allowed) {
    return;
  }

  state.projectPermanentDeletion.status = "loading";
  state.projectPermanentDeletion.error = "";
  render();

  await submitResourcePageWrite({
    pageState: state.projectsPage,
    render,
    onBlocked: async () => {
      state.projectPermanentDeletion.status = "idle";
      state.projectPermanentDeletion.error = "Wait for the current projects refresh or write to finish.";
      render();
    },
    runMutation: async () => {
      await upsertProjectMetadataRecord(selectedTeam, {
        ...projectMetadataRecordFromVisibleProject(project),
        lifecycleState: "softDeleted",
        remoteState: "deleted",
        recordState: "tombstone",
        deletedAt: new Date().toISOString(),
      }, { requirePushSuccess: true });
      await invoke("purge_local_gtms_project_repo", {
        input: {
          installationId: selectedTeam.installationId,
          projectId: project.id,
          repoName: project.name,
        },
      });
      await invoke("permanently_delete_gnosis_project_repo", {
        input: {
          installationId: selectedTeam.installationId,
          orgLogin: selectedTeam.githubOrg,
          repoName: project.name,
        },
        sessionToken: requireBrokerSession(),
      });
    },
    refreshOptions: {
      loadData: async () => reloadProjectsAfterWrite(render, selectedTeam),
    },
    onSuccess: async () => {
      resetProjectPermanentDeletion();
      if (state.selectedProjectId === project.id) {
        state.selectedProjectId = null;
      }
    },
    onError: async (error) => {
      if (await handleSyncFailure(classifySyncError(error), { render })) {
        return;
      }
      state.projectPermanentDeletion.status = "idle";
      state.projectPermanentDeletion.error = error?.message ?? String(error);
    },
  });
}
