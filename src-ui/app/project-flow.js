import { invoke } from "./runtime.js";
import { requireBrokerSession } from "./auth-flow.js";
import {
  loadStoredChapterPendingMutations,
  loadStoredProjectsForTeam,
  saveStoredProjectsForTeam,
} from "./project-cache.js";
import { loadStoredGlossariesForTeam } from "./glossary-cache.js";
import {
  buildProjectRepoFallbackConflictRecoveryInput,
  buildProjectRepoSyncInput,
} from "./project-repo-sync-shared.js";
import {
  createProjectOldLayoutDiscardState,
  createProjectRepoConflictRecoveryState,
  resetProjectCreation,
  resetProjectPermanentDeletion,
  resetProjectRename,
  state,
} from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";
import { appendRepoNameSuffix, slugifyRepoName } from "./repo-names.js";
import {
  beginProjectsPageSync,
  completeProjectsPageSync,
  failProjectsPageSync,
} from "./page-sync.js";
import {
  refreshProjectSearchIndex,
  resetProjectSearchState,
} from "./project-search-flow.js";
import {
  repairLocalRepoBinding,
  upsertProjectMetadataRecord,
} from "./team-metadata-flow.js";
import {
  guardPermanentDeleteConfirmation,
  guardTopLevelResourceAction,
} from "./resource-lifecycle-engine.js";
import {
  openTopLevelRenameModal,
} from "./resource-top-level-controller.js";
import {
  canCreateRepoResources,
  canMutateProjectFiles,
} from "./resource-capabilities.js";
import {
  clearResourcePageDataOwner,
  setResourcePageRefreshing,
  submitResourcePageWrite,
} from "./resource-page-controller.js";
import { addLocalHardDeleteTombstone } from "./local-hard-delete-store.js";
import {
  createProjectRenameMutationOptions,
  createProjectRestoreMutationOptions,
  createProjectSoftDeleteMutationOptions,
  createProjectsQueryOptions,
  createProjectsQuerySnapshot,
  ensureProjectsQueryObserver,
  seedProjectsQueryFromCache,
} from "./project-query.js";
import { createMutationObserver, projectKeys, queryClient } from "./query-client.js";
import { teamCacheKey } from "./team-cache.js";
import {
  applyProjectWriteIntentsToSnapshot,
  anyProjectWriteIsActive,
  clearConfirmedProjectWriteIntents,
} from "./project-write-coordinator.js";
import {
  enqueueRepoWrite,
  projectRepoScope,
} from "./repo-write-queue.js";
import {
  areProjectCreationWritesDisabled,
  areProjectHeavyWritesDisabled,
  areProjectLifecycleWritesDisabled,
  areProjectLocalHardDeleteWritesDisabled,
  projectLifecycleWriteBlockedMessage,
  projectWriteBlockedMessage,
  resourceHasPendingLifecycleMutation,
} from "./project-page-write-state.js";
import { commitProjectMutationStrict } from "./project-lifecycle-flow.js";
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
  updateProjectQueryCache,
  clearProjectUiDebug,
  clearProjectsStatus,
  showProjectsNotice,
  showProjectsStatus,
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
  return canMutateProjectFiles(selectedTeam)
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
    showProjectsStatus(render, "Creating project repo...");
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

    showProjectsStatus(render, "Initializing local project...");
    await invoke("initialize_gtms_project_repo", {
      input: {
        installationId: selectedTeam.installationId,
        projectId,
        repoName: finalRepoName,
        title: projectTitle,
      },
    });
    localRepoInitialized = true;

    showProjectsStatus(render, "Saving project metadata...");
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
        await invoke("rollback_created_gnosis_project_repo", {
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

const projectPageSyncController = {
  begin: beginProjectsPageSync,
  complete: completeProjectsPageSync,
  fail: failProjectsPageSync,
};

function setProjectsPageProgress(render, text) {
  showProjectsStatus(render, text);
}

function projectsPageOwnsTeam(team) {
  const expectedCacheKey = teamCacheKey(team);
  return Boolean(
    team?.id
    && expectedCacheKey
    && state.projectsPage?.visibleTeamId === team.id
    && state.projectsPage?.visibleCacheKey === expectedCacheKey
  );
}

function glossariesPageOwnsTeam(team) {
  const expectedCacheKey = teamCacheKey(team);
  return Boolean(
    team?.id
    && expectedCacheKey
    && state.glossariesPage?.visibleTeamId === team.id
    && state.glossariesPage?.visibleCacheKey === expectedCacheKey
  );
}

function visibleProjectsContainChapter(chapterId) {
  if (!chapterId) {
    return false;
  }
  return [...state.projects, ...state.deletedProjects].some((project) =>
    Array.isArray(project?.chapters)
    && project.chapters.some((chapter) => chapter?.id === chapterId),
  );
}

function canPreserveActiveEditorProjectContext(team) {
  const chapterId = state.editorChapter?.chapterId ?? state.selectedChapterId ?? "";
  return Boolean(
    state.screen === "translate"
    && team?.id
    && state.selectedTeamId === team.id
    && state.editorChapter?.chapterId === chapterId
    && visibleProjectsContainChapter(chapterId)
  );
}

export function primeProjectsLoadingState(teamId = state.selectedTeamId, options = {}) {
  if (teamId) {
    state.selectedTeamId = teamId;
  }
  const team = options.team ?? state.teams.find((item) => item?.id === teamId);
  const canPreserveVisibleData =
    (
      projectsPageOwnsTeam(team)
      || canPreserveActiveEditorProjectContext(team)
    )
    && (state.projects.length > 0 || state.deletedProjects.length > 0);

  if (!canPreserveVisibleData) {
    state.projects = [];
    state.deletedProjects = [];
    clearResourcePageDataOwner(state.projectsPage);
  }
  if (!glossariesPageOwnsTeam(team)) {
    state.glossaries = [];
    clearResourcePageDataOwner(state.glossariesPage);
  }
  state.projectRepoSyncByProjectId = {};
  state.projectRepoConflictRecovery = createProjectRepoConflictRecoveryState();
  state.projectOldLayoutDiscard = createProjectOldLayoutDiscardState();
  if (!canPreserveVisibleData) {
    state.pendingChapterMutations = [];
  }
  state.projectDiscovery = {
    status: canPreserveVisibleData ? "ready" : "loading",
    error: "",
    glossaryWarning: "",
    recoveryMessage: "",
  };
  setResourcePageRefreshing(state.projectsPage, true);
  resetProjectSearchState();
  resetProjectCreation();
  resetProjectRename();
  resetProjectPermanentDeletion();
  if (canPreserveVisibleData) {
    return { preservedVisibleData: true, seededFromCache: false };
  }

  const seededSnapshot =
    options.seedFromCache === false || !Number.isFinite(team?.installationId)
      ? null
      : seedProjectsQueryFromCache(team, {
          teamId,
          loadStoredProjectsForTeam,
          loadStoredChapterPendingMutations,
          loadStoredGlossariesForTeam,
          applyChapterPendingMutation,
          reconcileExpandedDeletedFiles,
        });
  if (seededSnapshot) {
    return { preservedVisibleData: false, seededFromCache: true };
  }

  queryClient.setQueryData(
    projectKeys.byTeam(teamId ?? null),
    createProjectsQuerySnapshot({
      discovery: {
        status: "loading",
        error: "",
        glossaryWarning: "",
        recoveryMessage: "",
      },
    }),
  );
  return { preservedVisibleData: false, seededFromCache: false };
}

export function finishProjectsLoadingForTeam(teamId = state.selectedTeamId, render) {
  if (state.selectedTeamId !== teamId) {
    return false;
  }
  setResourcePageRefreshing(state.projectsPage, false);
  render?.();
  return true;
}

export async function loadTeamProjects(render, teamId = state.selectedTeamId) {
  const selectedTeam = state.teams.find((team) => team.id === teamId);
  const previousProjectSnapshot = projectsPageOwnsTeam(selectedTeam)
    ? {
        items: state.projects,
        deletedItems: state.deletedProjects,
      }
    : { items: [], deletedItems: [] };
  primeProjectsLoadingState(teamId);
  void refreshProjectSearchIndex(render, teamId).catch(() => {});
  render?.();

  if (!Number.isFinite(selectedTeam?.installationId)) {
    state.pendingChapterMutations = [];
    state.projectRepoSyncByProjectId = {};
    state.projects = [];
    state.deletedProjects = [];
    setProjectDiscoveryState("ready", "", "");
    setResourcePageRefreshing(state.projectsPage, false);
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
      pageSyncController: projectPageSyncController,
      preserveProjectLifecyclePatches: (snapshot) => {
        clearConfirmedProjectWriteIntents(snapshot);
        return applyProjectWriteIntentsToSnapshot(
          preserveChapterLifecyclePatchesInProjectSnapshot(
            snapshot,
            previousProjectSnapshot,
          ),
        );
      },
      persistProjectsForTeam,
      projectMatchesMetadataRecord,
      projectMetadataRecordIsTombstone,
      purgeLocalProjectRepo,
      reconcileExpandedDeletedFiles,
      removeProjectRepoSyncState: (projectId) => {
        delete state.projectRepoSyncByProjectId[projectId];
      },
      removeVisibleProject,
      setProjectDiscoveryState,
      setProjectUiDebug,
      upsertProjectMetadataRecord,
      render,
      teamId: selectedTeam.id,
    };

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
    finishProjectsLoadingForTeam(selectedTeam?.id ?? teamId, render);
  }
}

function persistProjectQueryDataForTeam(selectedTeam, queryData) {
  if (!selectedTeam || !queryData?.snapshot) {
    return;
  }
  saveStoredProjectsForTeam(selectedTeam, {
    projects: Array.isArray(queryData.snapshot.items) ? queryData.snapshot.items : [],
    deletedProjects: Array.isArray(queryData.snapshot.deletedItems) ? queryData.snapshot.deletedItems : [],
  });
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
    clearProgress: () => clearProjectsStatus(render),
    render,
    progressLabels: {
      submitting: "Creating project...",
      refreshing: "Refreshing project list...",
    },
    onBlocked: async () => {
      state.projectCreation.status = "idle";
      state.projectCreation.error = "Wait for the current projects refresh or write to finish.";
      render();
    },
    runMutation: async () =>
      enqueueRepoWrite({
        scope: projectRepoScope({ team: selectedTeam }),
        kind: "projectCreate",
        sourceScreen: "projects",
        errorTarget: {
          kind: "projectCreate",
        },
        run: () => completeProjectCreateSynchronously(selectedTeam, projectTitle, repoName, render),
      }),
    refreshOptions: {
      loadData: async () => {
        showProjectsStatus(render, "Refreshing project list...");
        return reloadProjectsAfterWrite(render, selectedTeam, { suppressRecoveryWarning: true });
      },
    },
    onSuccess: async (result) => {
      clearProjectsStatus(render);
      resetProjectCreation();
      state.selectedProjectId = result.projectId;
      showProjectsNotice(
        render,
        result.collisionResolved
          ? `Created project ${result.title} in repo ${result.repoName} because that repo name was already taken.`
          : `Created project ${result.title}`,
      );
    },
    onError: async (error) => {
      clearProjectsStatus(render);
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

  try {
    await createMutationObserver(createProjectRenameMutationOptions({
      team: selectedTeam,
      project,
      nextTitle,
      commitMutation: async (team, mutation) => commitProjectMutationStrict(team, mutation, {
        render,
        statusLabels: {
          metadata: "Updating project metadata...",
          local: "Renaming project repo...",
        },
      }),
      onOptimisticApplied: () => {
        showProjectsStatus(render, "Renaming project...");
        resetProjectRename();
      },
      onSuccessApplied: (queryData) => {
        persistProjectQueryDataForTeam(selectedTeam, queryData);
        clearProjectsStatus(render);
        showProjectsNotice(render, "Project renamed.");
      },
      render,
      reconcileExpandedDeletedFiles,
    })).mutate();
  } catch (error) {
    clearProjectsStatus(render);
    state.projectRename = {
      isOpen: true,
      projectId: project.id,
      projectName: nextTitle,
      status: "idle",
      error: error?.message ?? String(error),
    };
    render();
  }
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
    showProjectsStatus(render, "Repairing project repo binding...");
    await enqueueRepoWrite({
      scope: projectRepoScope({ team: selectedTeam, projectId }),
      kind: "projectRepairBinding",
      sourceScreen: "projects",
      errorTarget: {
        projectId,
        kind: "projectRepairBinding",
      },
      run: () => repairLocalRepoBinding(selectedTeam, "project", projectId),
    });
    showProjectsStatus(render, "Refreshing project list...");
    await loadTeamProjects(render, selectedTeam.id);
    clearProjectsStatus(render);
    showProjectsNotice(render, "The project repo binding was repaired.", 2200);
  } catch (error) {
    clearProjectsStatus(render);
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

  try {
    showProjectsStatus(render, "Rebuilding local project repo...");
    await enqueueRepoWrite({
      scope: projectRepoScope({ team: selectedTeam, projectId }),
      kind: "projectRebuildLocalRepo",
      sourceScreen: "projects",
      errorTarget: {
        projectId,
        kind: "projectRebuildLocalRepo",
      },
      run: async () => {},
    });
    showProjectsStatus(render, "Refreshing project list...");
    await loadTeamProjects(render, selectedTeam.id);
    clearProjectsStatus(render);
    showProjectsNotice(render, "Local project repo rebuilt.", 2200);
  } catch (error) {
    clearProjectsStatus(render);
    showNoticeBadge(error?.message ?? String(error), render, 3200);
    render();
  }
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
    showProjectsStatus(render, "Overwriting conflicted project repos...");
    const response = await enqueueRepoWrite({
      scope: projectRepoScope({ team: selectedTeam }),
      kind: "projectConflictRecovery",
      sourceScreen: "projects",
      errorTarget: {
        kind: "projectConflictRecovery",
      },
      run: () => invoke("overwrite_conflicted_gtms_project_repos", {
        input,
        sessionToken: requireBrokerSession(),
      }),
    });
    const resolvedCount = Array.isArray(response?.resolvedProjectIds)
      ? response.resolvedProjectIds.length
      : input.projects.length;
    state.projectRepoConflictRecovery = createProjectRepoConflictRecoveryState();
    showProjectsStatus(render, "Refreshing project list...");
    await loadTeamProjects(render, selectedTeam.id);
    clearProjectsStatus(render);
    showProjectsNotice(
      render,
      `Overwrote ${resolvedCount} conflicted project repo${resolvedCount === 1 ? "" : "s"} with the latest data from the server.`,
      3600,
    );
  } catch (error) {
    clearProjectsStatus(render);
    state.projectRepoConflictRecovery = {
      teamId: selectedTeam.id,
      status: "idle",
      error: error?.message ?? String(error),
    };
    render();
  }
}

export function openProjectOldLayoutDiscard(render, projectId) {
  const selectedTeam = selectedProjectsTeam();
  const project = [...state.projects, ...state.deletedProjects]
    .find((item) => item?.id === projectId);
  if (!selectedTeam?.id || !project) {
    showNoticeBadge("Could not find the selected project.", render, 2600);
    return;
  }

  state.projectOldLayoutDiscard = {
    isOpen: true,
    teamId: selectedTeam.id,
    resourceId: project.id,
    resourceName: project.title || project.name || "Project",
    status: "idle",
    error: "",
  };
  render?.();
}

export function closeProjectOldLayoutDiscard(render) {
  if (state.projectOldLayoutDiscard?.status === "loading") {
    return;
  }
  state.projectOldLayoutDiscard = createProjectOldLayoutDiscardState();
  render?.();
}

export async function confirmProjectOldLayoutDiscard(render) {
  const modal = state.projectOldLayoutDiscard ?? {};
  if (modal.isOpen !== true || modal.status === "loading") {
    return;
  }

  const selectedTeam = selectedProjectsTeam();
  const project = [...state.projects, ...state.deletedProjects]
    .find((item) => item?.id === modal.resourceId);
  if (!selectedTeam?.installationId || selectedTeam.id !== modal.teamId || !project) {
    state.projectOldLayoutDiscard = {
      ...modal,
      status: "idle",
      error: "Could not find the selected project.",
    };
    render?.();
    return;
  }

  if (state.offline?.isEnabled === true || state.projectsPageSync?.status === "syncing" || anyProjectWriteIsActive()) {
    state.projectOldLayoutDiscard = {
      ...modal,
      status: "idle",
      error: "Wait for the current refresh to finish before discarding local changes.",
    };
    render?.();
    return;
  }

  const input = buildProjectRepoSyncInput(selectedTeam, [project]);
  if (!Array.isArray(input.projects) || input.projects.length !== 1) {
    state.projectOldLayoutDiscard = {
      ...modal,
      status: "idle",
      error: "Could not prepare this project for sync recovery.",
    };
    render?.();
    return;
  }

  state.projectOldLayoutDiscard = {
    ...modal,
    status: "loading",
    error: "",
  };
  render?.();

  try {
    showProjectsStatus(render, "Discarding old-format local changes...");
    const response = await enqueueRepoWrite({
      scope: projectRepoScope({ team: selectedTeam, projectId: project.id }),
      kind: "projectOldLayoutDiscard",
      sourceScreen: "projects",
      errorTarget: {
        kind: "projectOldLayoutDiscard",
        projectId: project.id,
      },
      run: () => invoke("discard_old_layout_gtms_project_repos", {
        input,
        sessionToken: requireBrokerSession(),
      }),
    });
    const resolvedCount = Array.isArray(response?.resolvedProjectIds)
      ? response.resolvedProjectIds.length
      : 1;
    state.projectOldLayoutDiscard = createProjectOldLayoutDiscardState();
    showProjectsStatus(render, "Refreshing project list...");
    await loadTeamProjects(render, selectedTeam.id);
    clearProjectsStatus(render);
    showProjectsNotice(
      render,
      resolvedCount > 0
        ? "Discarded old local changes and synced the migrated project from the server."
        : "This project no longer needed old-format recovery.",
      3600,
    );
  } catch (error) {
    clearProjectsStatus(render);
    state.projectOldLayoutDiscard = {
      ...modal,
      status: "idle",
      error: error?.message ?? String(error),
    };
    render?.();
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

  try {
    await createMutationObserver(createProjectSoftDeleteMutationOptions({
      team: selectedTeam,
      project,
      commitMutation: async (team, mutation) => commitProjectMutationStrict(team, mutation, {
        render,
        statusLabels: {
          metadata: "Updating project metadata...",
          local: "Marking project repo deleted...",
        },
      }),
      onOptimisticApplied: () => {
        showProjectsStatus(render, "Deleting project...");
        if (state.projects.length === 0 && state.deletedProjects.length > 0) {
          state.showDeletedProjects = true;
        }
      },
      onSuccessApplied: (queryData) => {
        persistProjectQueryDataForTeam(selectedTeam, queryData);
        clearProjectsStatus(render);
        showProjectsNotice(render, "Project deleted.");
      },
      render,
      reconcileExpandedDeletedFiles,
    })).mutate();
  } catch (error) {
    clearProjectsStatus(render);
    setProjectDiscoveryState("error", error?.message ?? String(error));
    render();
  }
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

  try {
    await createMutationObserver(createProjectRestoreMutationOptions({
      team: selectedTeam,
      project,
      commitMutation: async (team, mutation) => commitProjectMutationStrict(team, mutation, {
        render,
        statusLabels: {
          metadata: "Updating project metadata...",
          local: "Restoring project repo...",
        },
      }),
      onOptimisticApplied: () => {
        showProjectsStatus(render, "Restoring project...");
      },
      onSuccessApplied: (queryData) => {
        persistProjectQueryDataForTeam(selectedTeam, queryData);
        clearProjectsStatus(render);
        showProjectsNotice(render, "Project restored.");
      },
      render,
      reconcileExpandedDeletedFiles,
    })).mutate();
  } catch (error) {
    clearProjectsStatus(render);
    setProjectDiscoveryState("error", error?.message ?? String(error));
    render();
  }
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
  if (areProjectLocalHardDeleteWritesDisabled()) {
    setProjectDiscoveryState("error", projectWriteBlockedMessage());
    render();
    return;
  }
  if (resourceHasPendingLifecycleMutation(project)) {
    setProjectDiscoveryState("error", projectLifecycleWriteBlockedMessage());
    render();
    return;
  }
  void guardTopLevelResourceAction({
    resource: project,
    isExpectedResource: (currentProject) =>
      Boolean(currentProject) && currentProject.lifecycleState === "deleted",
    getBlockedMessage: () =>
      selectedTeam ? "" : "Could not determine the selected team.",
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
  if (areProjectLocalHardDeleteWritesDisabled()) {
    state.projectPermanentDeletion.status = "idle";
    state.projectPermanentDeletion.error = projectWriteBlockedMessage();
    render();
    return;
  }
  if (resourceHasPendingLifecycleMutation(project)) {
    state.projectPermanentDeletion.status = "idle";
    state.projectPermanentDeletion.error = projectLifecycleWriteBlockedMessage();
    render();
    return;
  }
  const allowed = await guardPermanentDeleteConfirmation({
    resource: selectedTeam?.installationId ? project : null,
    modalState: state.projectPermanentDeletion,
    missingMessage: "Could not find the selected deleted project.",
    getBlockedMessage: () => {
      return selectedTeam ? "" : "Could not determine the selected team.";
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
  showProjectsStatus(render, "Removing local project repo...");
  render();

  try {
    await enqueueRepoWrite({
      scope: projectRepoScope({ team: selectedTeam, project }),
      kind: "projectLocalHardDelete",
      sourceScreen: "projects",
      errorTarget: {
        projectId: project.id,
        kind: "projectLocalHardDelete",
      },
      run: () => invoke("purge_local_gtms_project_repo", {
        input: {
          installationId: selectedTeam.installationId,
          projectId: project.id,
          repoName: project.name,
        },
      }),
    });
    addLocalHardDeleteTombstone(selectedTeam, "project", project);
    removeVisibleProject(project.id);
    clearSelectedProjectState(project);
    dropProjectMutationsForProject(selectedTeam, project.id);
    delete state.projectRepoSyncByProjectId[project.id];
    persistProjectsForTeam(selectedTeam);
    updateProjectQueryCache(selectedTeam);
    resetProjectPermanentDeletion();
    clearProjectsStatus(render);
    showProjectsNotice(render, "Local project copy removed.");
  } catch (error) {
    clearProjectsStatus(render);
    state.projectPermanentDeletion.status = "idle";
    state.projectPermanentDeletion.error = error?.message ?? String(error);
    render();
  }
}
