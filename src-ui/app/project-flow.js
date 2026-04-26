import { invoke } from "./runtime.js";
import { requireBrokerSession } from "./auth-flow.js";
import {
  loadStoredChapterPendingMutations,
  loadStoredProjectsForTeam,
} from "./project-cache.js";
import { loadStoredGlossariesForTeam } from "./glossary-cache.js";
import { buildProjectRepoFallbackConflictRecoveryInput } from "./project-repo-sync-shared.js";
import {
  resetProjectCreation,
  createProjectRepoConflictRecoveryState,
  resetProjectPermanentDeletion,
  resetProjectRename,
  state,
} from "./state.js";
import { clearNoticeBadge, showNoticeBadge } from "./status-feedback.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";
import { appendRepoNameSuffix, slugifyRepoName } from "./repo-names.js";
import {
  beginProjectsPageSync,
  completeProjectsPageSync,
  failProjectsPageSync,
} from "./page-sync.js";
import { refreshProjectSearchIndex } from "./project-search-flow.js";
import {
  repairLocalRepoBinding,
  upsertProjectMetadataRecord,
} from "./team-metadata-flow.js";
import {
  commitMetadataFirstTopLevelMutation,
  guardPermanentDeleteConfirmation,
  guardTopLevelResourceAction,
} from "./resource-lifecycle-engine.js";
import {
  openTopLevelRenameModal,
} from "./resource-top-level-controller.js";
import {
  canCreateRepoResources,
} from "./resource-capabilities.js";
import {
  areResourcePageWritesDisabled,
  areResourcePageWriteSubmissionsDisabled,
  submitResourcePageWrite,
} from "./resource-page-controller.js";
import {
  createProjectsQueryOptions,
  ensureProjectsQueryObserver,
  invalidateProjectsQueryAfterMutation,
  seedProjectsQueryFromCache,
} from "./project-query.js";
import { projectKeys, queryClient } from "./query-client.js";
import {
  applyProjectWriteIntentsToSnapshot,
  anyProjectMutatingWriteIsActive,
  anyProjectWriteIsActive,
  clearConfirmedProjectWriteIntents,
  projectLifecycleIntentKey,
  projectTitleIntentKey,
  requestProjectWriteIntent,
  teamMetadataWriteScope,
} from "./project-write-coordinator.js";
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
  clearResourceCreateProgress,
  guardResourceCreateStart,
  showResourceCreateProgress,
} from "./resource-create-flow.js";
import {
  applyChapterPendingMutation,
  clearSelectedProjectState,
  dropProjectMutationsForProject,
  ensureProjectNotTombstoned,
  normalizeListedChapter,
  preserveChapterLifecyclePatchesInProjectSnapshot,
  persistProjectsForTeam,
  projectMatchesMetadataRecord,
  projectMetadataRecordIsTombstone,
  purgeLocalProjectRepo,
  reconcileExpandedDeletedFiles,
  refreshProjectFilesFromDisk,
  removeVisibleProject,
  setProjectUiDebug,
  clearProjectUiDebug,
  selectedProjectsTeam,
  openChapterRename,
  updateChapterRenameName,
  cancelChapterRename,
  openChapterPermanentDeletion,
  updateChapterPermanentDeletionConfirmation,
  cancelChapterPermanentDeletion,
  toggleDeletedFiles,
  submitChapterRename,
  updateChapterGlossaryLinks,
  deleteChapter,
  restoreChapter,
  permanentlyDeleteChapter,
  confirmChapterPermanentDeletion,
} from "./project-chapter-flow.js";

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

function projectLifecycleBlockedMessage(selectedTeam, actionLabel) {
  return selectedTeam?.canManageProjects === true
    ? ""
    : `You do not have permission to ${actionLabel} in this team.`;
}

async function completeProjectCreateSynchronously(selectedTeam, projectTitle, baseRepoName, render) {
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
    showResourceCreateProgress(render, "Creating GitHub repository...");
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

    showResourceCreateProgress(render, "Initializing local project repo...");
    await invoke("initialize_gtms_project_repo", {
      input: {
        installationId: selectedTeam.installationId,
        projectId,
        repoName: finalRepoName,
        title: projectTitle,
      },
    });
    localRepoInitialized = true;

    showResourceCreateProgress(render, "Saving team metadata...");
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

function projectMetadataRecordFromVisibleProject(project, overrides = {}) {
  const isDeletedLifecycleState =
    project?.lifecycleState === "deleted"
    || project?.lifecycleState === "softDeleted"
    || project?.status === "deleted";
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
      ?? (isDeletedLifecycleState ? "softDeleted" : "active"),
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

const projectPageSyncController = {
  begin: beginProjectsPageSync,
  complete: completeProjectsPageSync,
  fail: failProjectsPageSync,
};

function setProjectsPageProgress(render, text) {
  showNoticeBadge(text, render, null);
}

export async function loadTeamProjects(render, teamId = state.selectedTeamId) {
  const selectedTeam = state.teams.find((team) => team.id === teamId);
  state.projectsPage.isRefreshing = true;
  state.selectedTeamId = teamId ?? state.selectedTeamId;
  void refreshProjectSearchIndex(render, teamId).catch(() => {});
  render?.();

  if (!Number.isFinite(selectedTeam?.installationId)) {
    state.pendingChapterMutations = [];
    state.projectRepoSyncByProjectId = {};
    state.projects = [];
    state.deletedProjects = [];
    setProjectDiscoveryState("ready", "", "");
    state.projectsPage.isRefreshing = false;
    render?.();
    return [];
  }

  try {
    const queryOptionsContext = {
      applyChapterPendingMutation,
      clearProjectUiDebug,
      clearSelectedProjectState,
      dropProjectMutationsForProject,
      loadStoredProjectsForTeam,
      normalizeListedChapter,
      preserveProjectLifecyclePatches: (snapshot) => {
        clearConfirmedProjectWriteIntents(snapshot);
        return applyProjectWriteIntentsToSnapshot(
          preserveChapterLifecyclePatchesInProjectSnapshot(
            snapshot,
            { items: state.projects, deletedItems: state.deletedProjects },
          ),
        );
      },
      persistProjectsForTeam,
      projectMatchesMetadataRecord,
      projectMetadataRecordIsTombstone,
      purgeLocalProjectRepo,
      reconcileExpandedDeletedFiles,
      removeVisibleProject,
      setProjectDiscoveryState,
      setProjectUiDebug,
      upsertProjectMetadataRecord,
      render,
      teamId: selectedTeam.id,
    };

    seedProjectsQueryFromCache(selectedTeam, {
      ...queryOptionsContext,
      loadStoredProjectsForTeam,
      loadStoredChapterPendingMutations,
      loadStoredGlossariesForTeam,
    });

    ensureProjectsQueryObserver(render, selectedTeam, queryOptionsContext);
    const querySnapshot = await queryClient.fetchQuery(
      createProjectsQueryOptions(selectedTeam, queryOptionsContext),
    );
    queryClient.setQueryData(projectKeys.byTeam(selectedTeam.id), querySnapshot);
    persistProjectsForTeam(selectedTeam);
    return [...state.projects, ...state.deletedProjects];
  } catch (error) {
    if (String(error?.message ?? error) === "Stale project refresh ignored.") {
      return [];
    }
    throw error;
  } finally {
    state.projectsPage.isRefreshing = false;
    render?.();
  }
}

function projectWriteBlockedMessage() {
  return "Wait for the current projects refresh or write to finish.";
}

function areProjectHeavyWritesDisabled() {
  return areResourcePageWritesDisabled(state.projectsPage) || anyProjectWriteIsActive();
}

function areProjectCreationWritesDisabled() {
  return areResourcePageWritesDisabled(state.projectsPage) || anyProjectMutatingWriteIsActive();
}

function projectLifecycleWriteBlockedMessage() {
  return "Wait for the current project write to finish.";
}

function areProjectLifecycleWritesDisabled() {
  return areResourcePageWriteSubmissionsDisabled(state.projectsPage);
}

function beginProjectLifecyclePageSync() {
  const refreshWasActive = state.projectsPage?.isRefreshing === true;
  if (!refreshWasActive) {
    beginProjectsPageSync();
  }
  return { refreshWasActive };
}

async function completeProjectLifecyclePageSync(render, syncContext) {
  if (!syncContext?.refreshWasActive) {
    await completeProjectsPageSync(render);
  }
}

function failProjectLifecyclePageSync(syncContext) {
  if (!syncContext?.refreshWasActive) {
    failProjectsPageSync();
  }
}

export async function createProjectForSelectedTeam(render) {
  const selectedTeam = selectedProjectsTeam();
  if (areProjectCreationWritesDisabled()) {
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
  if (areProjectLifecycleWritesDisabled()) {
    setProjectDiscoveryState("error", projectLifecycleWriteBlockedMessage());
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

function patchProjectInVisibleState(projectId, patch) {
  const patchProject = (project) => (
    project?.id === projectId
      ? { ...project, ...patch }
      : project
  );
  state.projects = state.projects.map(patchProject);
  state.deletedProjects = state.deletedProjects.map(patchProject);
}

function moveProjectInVisibleState(project, targetCollection, patch = {}) {
  if (!project?.id) {
    return;
  }
  const nextProject = {
    ...project,
    ...patch,
  };
  state.projects = state.projects.filter((item) => item.id !== project.id);
  state.deletedProjects = state.deletedProjects.filter((item) => item.id !== project.id);
  if (targetCollection === "deleted") {
    state.deletedProjects = [...state.deletedProjects, nextProject];
  } else {
    state.projects = [...state.projects, nextProject];
  }
  reconcileExpandedDeletedFiles();
}

export async function submitProjectCreation(render) {
  const selectedTeam = selectedProjectsTeam();
  if (areProjectCreationWritesDisabled()) {
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
    syncController: projectPageSyncController,
    setProgress: (text) => setProjectsPageProgress(render, text),
    clearProgress: clearNoticeBadge,
    render,
    onBlocked: async () => {
      state.projectCreation.status = "idle";
      state.projectCreation.error = "Wait for the current projects refresh or write to finish.";
      render();
    },
    runMutation: async () =>
      completeProjectCreateSynchronously(selectedTeam, projectTitle, repoName, render),
    refreshOptions: {
      loadData: async () => {
        showResourceCreateProgress(render, "Refreshing project list...");
        return reloadProjectsAfterWrite(render, selectedTeam, { suppressRecoveryWarning: true });
      },
    },
    onSuccess: async (result) => {
      clearResourceCreateProgress();
      resetProjectCreation();
      state.selectedProjectId = result.projectId;
      showNoticeBadge(
        result.collisionResolved
          ? `Created project ${result.title} in repo ${result.repoName} because that repo name was already taken.`
          : `Created project ${result.title}`,
        render,
      );
    },
    onError: async (error) => {
      clearResourceCreateProgress();
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

  requestProjectWriteIntent({
    key: projectTitleIntentKey(project.id),
    scope: teamMetadataWriteScope(selectedTeam),
    teamId: selectedTeam.id,
    projectId: project.id,
    type: "projectTitle",
    value: {
      title: nextTitle,
    },
    previousValue: {
      title: project.title ?? project.name,
    },
  }, {
    applyOptimistic: (intent) => {
      patchProjectInVisibleState(project.id, {
        title: intent.value.title,
        pendingMutation: "rename",
      });
      persistProjectsForTeam(selectedTeam);
      resetProjectRename();
      render();
    },
    run: async (intent) => commitProjectMutationStrict(selectedTeam, {
      type: "rename",
      projectId: project.id,
      title: intent.value.title,
      previousTitle: project.title ?? project.name,
    }),
    onSuccess: (intent) => {
      patchProjectInVisibleState(project.id, {
        title: intent.value.title,
        pendingMutation: null,
        localLifecycleIntent: "rename",
      });
      persistProjectsForTeam(selectedTeam);
      void invalidateProjectsQueryAfterMutation(selectedTeam, {
        teamId: selectedTeam.id,
        render,
        reconcileExpandedDeletedFiles,
        refetchIfInactive: false,
      });
    },
    onError: (error) => {
      state.projectRename = {
        isOpen: true,
        projectId: project.id,
        projectName: nextTitle,
        status: "idle",
        error: error?.message ?? String(error),
      };
      render();
    },
  });
}

export async function repairProjectRepoBinding(render, projectId) {
  const selectedTeam = selectedProjectsTeam();
  if (!selectedTeam?.installationId || typeof projectId !== "string" || !projectId.trim()) {
    return;
  }
  if (areProjectHeavyWritesDisabled()) {
    setProjectDiscoveryState("error", projectWriteBlockedMessage());
    render();
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
  if (areProjectHeavyWritesDisabled()) {
    setProjectDiscoveryState("error", projectWriteBlockedMessage());
    render();
    return;
  }

  showNoticeBadge("Rebuilding the local project repo from metadata and GitHub...", render, 2200);
  await loadTeamProjects(render, selectedTeam.id);
}

export async function overwriteConflictedProjectRepos(render) {
  const selectedTeam = selectedProjectsTeam();
  if (!selectedTeam?.installationId || typeof selectedTeam?.id !== "string" || !selectedTeam.id.trim()) {
    return;
  }

  if (state.offline?.isEnabled === true || state.projectsPageSync?.status === "syncing" || anyProjectWriteIsActive()) {
    state.projectRepoConflictRecovery = {
      teamId: selectedTeam.id,
      status: "idle",
      error: "Wait for the current refresh to finish before overwriting conflicted repos.",
    };
    render();
    return;
  }

  const input = buildProjectRepoFallbackConflictRecoveryInput(
    selectedTeam,
    state.projects,
    state.deletedProjects,
    state.projectRepoSyncByProjectId,
  );
  if (!Array.isArray(input.projects) || input.projects.length === 0) {
    state.projectRepoConflictRecovery = createProjectRepoConflictRecoveryState();
    showNoticeBadge("No conflicted project repos need fallback recovery.", render, 2600);
    render();
    return;
  }

  state.projectRepoConflictRecovery = {
    teamId: selectedTeam.id,
    status: "loading",
    error: "",
  };
  render();

  try {
    const response = await invoke("overwrite_conflicted_gtms_project_repos", {
      input,
      sessionToken: requireBrokerSession(),
    });
    const resolvedCount = Array.isArray(response?.resolvedProjectIds)
      ? response.resolvedProjectIds.length
      : input.projects.length;
    state.projectRepoConflictRecovery = createProjectRepoConflictRecoveryState();
    await loadTeamProjects(render, selectedTeam.id);
    showNoticeBadge(
      `Overwrote ${resolvedCount} conflicted project repo${resolvedCount === 1 ? "" : "s"} with the latest data from the server.`,
      render,
      3600,
    );
  } catch (error) {
    state.projectRepoConflictRecovery = {
      teamId: selectedTeam.id,
      status: "idle",
      error: error?.message ?? String(error),
    };
    render();
  }
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

  requestProjectWriteIntent({
    key: projectLifecycleIntentKey(project.id),
    scope: teamMetadataWriteScope(selectedTeam),
    teamId: selectedTeam.id,
    projectId: project.id,
    type: "projectLifecycle",
    value: {
      lifecycleState: "deleted",
      mutationType: "softDelete",
    },
    previousValue: {
      lifecycleState: "active",
    },
  }, {
    applyOptimistic: () => {
      moveProjectInVisibleState(project, "deleted", {
        lifecycleState: "deleted",
        pendingMutation: "softDelete",
      });
      if (state.projects.length === 0 && state.deletedProjects.length > 0) {
        state.showDeletedProjects = true;
      }
      persistProjectsForTeam(selectedTeam);
      render();
    },
    run: async () => commitProjectMutationStrict(selectedTeam, {
      type: "softDelete",
      projectId: project.id,
    }),
    onSuccess: () => {
      moveProjectInVisibleState(project, "deleted", {
        lifecycleState: "deleted",
        pendingMutation: null,
        localLifecycleIntent: "softDelete",
      });
      persistProjectsForTeam(selectedTeam);
      void invalidateProjectsQueryAfterMutation(selectedTeam, {
        teamId: selectedTeam.id,
        render,
        reconcileExpandedDeletedFiles,
        refetchIfInactive: false,
      });
    },
    onError: (error) => {
      setProjectDiscoveryState("error", error?.message ?? String(error));
      render();
    },
  });
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

  requestProjectWriteIntent({
    key: projectLifecycleIntentKey(project.id),
    scope: teamMetadataWriteScope(selectedTeam),
    teamId: selectedTeam.id,
    projectId: project.id,
    type: "projectLifecycle",
    value: {
      lifecycleState: "active",
      mutationType: "restore",
    },
    previousValue: {
      lifecycleState: "deleted",
    },
  }, {
    applyOptimistic: () => {
      moveProjectInVisibleState(project, "active", {
        lifecycleState: "active",
        pendingMutation: "restore",
      });
      persistProjectsForTeam(selectedTeam);
      render();
    },
    run: async () => commitProjectMutationStrict(selectedTeam, {
      type: "restore",
      projectId: project.id,
    }),
    onSuccess: () => {
      moveProjectInVisibleState(project, "active", {
        lifecycleState: "active",
        pendingMutation: null,
        localLifecycleIntent: "restore",
      });
      persistProjectsForTeam(selectedTeam);
      void invalidateProjectsQueryAfterMutation(selectedTeam, {
        teamId: selectedTeam.id,
        render,
        reconcileExpandedDeletedFiles,
        refetchIfInactive: false,
      });
    },
    onError: (error) => {
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

async function reloadProjectsAfterWrite(render, selectedTeam, options = {}) {
  await loadTeamProjects(render, selectedTeam?.id, {
    suppressRecoveryWarning: options.suppressRecoveryWarning === true,
  });
  return [...state.projects, ...state.deletedProjects];
}

export function permanentlyDeleteProject(render, projectId) {
  const project = state.deletedProjects.find((item) => item.id === projectId);
  const selectedTeam = selectedProjectsTeam();
  if (areProjectHeavyWritesDisabled()) {
    setProjectDiscoveryState("error", projectWriteBlockedMessage());
    render();
    return;
  }
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
  if (areProjectHeavyWritesDisabled()) {
    state.projectPermanentDeletion.status = "idle";
    state.projectPermanentDeletion.error = projectWriteBlockedMessage();
    render();
    return;
  }
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
    syncController: projectPageSyncController,
    setProgress: (text) => setProjectsPageProgress(render, text),
    clearProgress: clearNoticeBadge,
    render,
    progressLabels: {
      submitting: "Deleting project permanently...",
      refreshing: "Refreshing project list...",
    },
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
