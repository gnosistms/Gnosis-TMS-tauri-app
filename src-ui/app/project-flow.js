import { invoke } from "./runtime.js";
import { requireBrokerSession } from "./auth-flow.js";
import {
  loadStoredProjectsForTeam,
} from "./project-cache.js";
import {
  resetProjectCreation,
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
import {
  loadTeamProjects as runLoadTeamProjects,
} from "./project-discovery-flow.js";
import {
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
  canCreateRepoResources,
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

  state.projectRename.status = "loading";
  state.projectRename.error = "";
  render();
  await submitResourcePageWrite({
    pageState: state.projectsPage,
    syncController: projectPageSyncController,
    setProgress: (text) => setProjectsPageProgress(render, text),
    clearProgress: clearNoticeBadge,
    render,
    progressLabels: {
      submitting: "Saving project rename...",
      refreshing: "Refreshing project list...",
    },
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
    syncController: projectPageSyncController,
    setProgress: (text) => setProjectsPageProgress(render, text),
    clearProgress: clearNoticeBadge,
    render,
    progressLabels: {
      submitting: "Deleting project...",
      refreshing: "Refreshing project list...",
    },
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
    syncController: projectPageSyncController,
    setProgress: (text) => setProjectsPageProgress(render, text),
    clearProgress: clearNoticeBadge,
    render,
    progressLabels: {
      submitting: "Restoring project...",
      refreshing: "Refreshing project list...",
    },
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

async function reloadProjectsAfterWrite(render, selectedTeam, options = {}) {
  await loadTeamProjects(render, selectedTeam?.id, {
    suppressRecoveryWarning: options.suppressRecoveryWarning === true,
  });
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
