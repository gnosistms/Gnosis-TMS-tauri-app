import { invoke, waitForNextPaint } from "./runtime.js";
import { requireBrokerSession } from "./auth-flow.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import {
  loadStoredProjectPendingMutations,
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
import {
  resetProjectCreation,
  resetProjectPermanentDeletion,
  resetProjectRename,
  state,
} from "./state.js";
import { clearScopedSyncBadge, showScopedSyncBadge } from "./status-feedback.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";

function setProjectUiDebug(render, text) {
  showScopedSyncBadge("projects", text, render);
}

function clearProjectUiDebug(render) {
  clearScopedSyncBadge("projects", render);
}

function applyProjectSnapshotToState(snapshot) {
  state.projects = snapshot.items;
  state.deletedProjects = snapshot.deletedItems;
  if (snapshot.deletedItems.length === 0) {
    state.showDeletedProjects = false;
  }
}

function normalizeProjectSnapshot(snapshot, pendingMutations = []) {
  const latestMutationByProjectId = new Map();
  for (const mutation of pendingMutations) {
    latestMutationByProjectId.set(mutation.projectId, mutation.type);
  }

  const activeById = new Map(snapshot.items.map((item) => [item.id, item]));
  const deletedById = new Map(snapshot.deletedItems.map((item) => [item.id, item]));

  for (const [projectId, deletedItem] of deletedById.entries()) {
    if (!activeById.has(projectId)) {
      continue;
    }

    const latestMutation = latestMutationByProjectId.get(projectId);
    if (latestMutation === "restore" || latestMutation === "rename") {
      deletedById.delete(projectId);
      continue;
    }

    if (latestMutation === "softDelete") {
      activeById.delete(projectId);
      continue;
    }

    activeById.delete(projectId);
  }

  return {
    items: [...activeById.values()],
    deletedItems: [...deletedById.values()],
  };
}

function applyProjectPendingMutation(snapshot, mutation) {
  const normalizedSnapshot = normalizeProjectSnapshot(snapshot);
  const findProject = () =>
    normalizedSnapshot.items.find((item) => item.id === mutation.projectId) ??
    normalizedSnapshot.deletedItems.find((item) => item.id === mutation.projectId);
  const currentProject = findProject();

  if (!currentProject) {
    return normalizedSnapshot;
  }

  if (mutation.type === "softDelete") {
    const deletedProject = {
      ...currentProject,
      status: "deleted",
    };
    return normalizeProjectSnapshot({
      items: removeItem(normalizedSnapshot.items, mutation.projectId),
      deletedItems: [deletedProject, ...removeItem(normalizedSnapshot.deletedItems, mutation.projectId)],
    });
  }

  if (mutation.type === "restore") {
    const restoredProject = {
      ...currentProject,
      status: "active",
    };
    return normalizeProjectSnapshot({
      items: replaceItem(removeItem(normalizedSnapshot.items, mutation.projectId), restoredProject),
      deletedItems: removeItem(normalizedSnapshot.deletedItems, mutation.projectId),
    });
  }

  if (mutation.type === "rename") {
    const renamedProject = {
      ...currentProject,
      title: mutation.title,
    };
    const isDeleted = normalizedSnapshot.deletedItems.some((item) => item.id === mutation.projectId);
    return normalizeProjectSnapshot(
      isDeleted
        ? {
            items: normalizedSnapshot.items,
            deletedItems: replaceItem(normalizedSnapshot.deletedItems, renamedProject),
          }
        : {
            items: replaceItem(normalizedSnapshot.items, renamedProject),
            deletedItems: normalizedSnapshot.deletedItems,
          },
    );
  }

  return normalizedSnapshot;
}

const inflightProjectMutationIds = new Set();

export async function loadTeamProjects(render, teamId = state.selectedTeamId) {
  const selectedTeam = state.teams.find((team) => team.id === teamId);
  const syncVersionAtStart = state.projectSyncVersion;

  if (!selectedTeam?.installationId) {
    applyProjectSnapshotToState({ items: [], deletedItems: [] });
    state.projectDiscovery = { status: "ready", error: "" };
    render();
    return;
  }

  const cachedProjects = loadStoredProjectsForTeam(selectedTeam);
  state.pendingProjectMutations = loadStoredProjectPendingMutations(selectedTeam);
  const optimisticSnapshot = applyPendingMutations(
    {
      items: cachedProjects.projects,
      deletedItems: cachedProjects.deletedProjects,
      },
    state.pendingProjectMutations,
    applyProjectPendingMutation,
  );

  if (state.offline.isEnabled) {
    applyProjectSnapshotToState(optimisticSnapshot);
    state.projectDiscovery = { status: "ready", error: "" };
    render();
    return;
  }

  if (cachedProjects.exists) {
    applyProjectSnapshotToState(optimisticSnapshot);
    state.projectDiscovery = { status: "ready", error: "" };
  } else {
    applyProjectSnapshotToState({ items: [], deletedItems: [] });
    state.projectDiscovery = { status: "loading", error: "" };
  }
  beginPageSync();
  render();

  try {
    const projects = await invoke("list_gnosis_projects_for_installation", {
      installationId: selectedTeam.installationId,
      sessionToken: requireBrokerSession(),
    });
    if (syncVersionAtStart !== state.projectSyncVersion) {
      completePageSync(render);
      render();
      return;
    }
    const mappedProjects = projects.map((project) => ({
      ...project,
      chapters: [],
    }));
    const nextSnapshot = applyPendingMutations(
      {
        items: mappedProjects.filter((project) => project.status !== "deleted"),
        deletedItems: mappedProjects.filter((project) => project.status === "deleted"),
      },
      state.pendingProjectMutations,
      applyProjectPendingMutation,
    );
    applyProjectSnapshotToState(nextSnapshot);
    saveStoredProjectsForTeam(selectedTeam, {
      projects: mappedProjects.filter((project) => project.status !== "deleted"),
      deletedProjects: mappedProjects.filter((project) => project.status === "deleted"),
    });
    state.projectDiscovery = { status: "ready", error: "" };
    completePageSync(render);
    render();
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
      failPageSync();
      return;
    }

    if (syncVersionAtStart !== state.projectSyncVersion) {
      failPageSync();
      render();
      return;
    }

    if (!cachedProjects.exists) {
      applyProjectSnapshotToState({ items: [], deletedItems: [] });
      state.projectDiscovery = {
        status: "error",
        error: error?.message ?? String(error),
      };
    } else {
      state.projectDiscovery = { status: "ready", error: "" };
    }
    failPageSync();
    render();
  }
}

export async function createProjectForSelectedTeam(render) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);

  if (!selectedTeam?.installationId) {
    state.projectDiscovery = {
      status: "error",
      error: "New projects currently require a GitHub App-connected team.",
    };
    render();
    return;
  }

  if (selectedTeam.canManageProjects !== true) {
    state.projectDiscovery = {
      status: "error",
      error: "You do not have permission to create projects in this team.",
    };
    render();
    return;
  }

  state.projectCreation = {
    isOpen: true,
    projectName: "",
    status: "idle",
    error: "",
  };
  render();
}

export function updateProjectCreationName(projectName) {
  state.projectCreation.projectName = projectName;
  if (state.projectCreation.error) {
    state.projectCreation.error = "";
  }
}

export function cancelProjectCreation(render) {
  resetProjectCreation();
  render();
}

export function openProjectRename(render, projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  if (!project) {
    state.projectDiscovery = {
      status: "error",
      error: "Could not find the selected project.",
    };
    render();
    return;
  }

  if (selectedTeam?.canManageProjects !== true) {
    state.projectDiscovery = {
      status: "error",
      error: "You do not have permission to rename projects in this team.",
    };
    render();
    return;
  }

  state.projectRename = {
    isOpen: true,
    projectId,
    projectName: project.title ?? project.name,
    status: "idle",
    error: "",
  };
  render();
}

export function updateProjectRenameName(projectName) {
  state.projectRename.projectName = projectName;
  if (state.projectRename.error) {
    state.projectRename.error = "";
  }
}

export function cancelProjectRename(render) {
  resetProjectRename();
  render();
}

export async function submitProjectCreation(render) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  if (!selectedTeam?.installationId) {
    state.projectCreation.error = "New projects currently require a GitHub App-connected team.";
    render();
    return;
  }

  if (selectedTeam.canManageProjects !== true) {
    state.projectCreation.error = "You do not have permission to create projects in this team.";
    render();
    return;
  }

  const projectTitle = state.projectCreation.projectName.trim();
  const repoName = slugifyRepositoryName(projectTitle);

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
    await invoke("create_gnosis_project_repo", {
      input: {
        installationId: selectedTeam.installationId,
        orgLogin: selectedTeam.githubOrg,
        repoName,
        projectTitle,
      },
      sessionToken: requireBrokerSession(),
    });
    resetProjectCreation();
    await loadTeamProjects(render, selectedTeam.id);
  } catch (error) {
    if (await handleSyncFailure(classifySyncError(error), { render })) {
      return;
    }
    state.projectCreation.status = "idle";
    state.projectCreation.error = error?.message ?? String(error);
    render();
  }
}

export async function submitProjectRename(render) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  const project = state.projects.find((item) => item.id === state.projectRename.projectId);

  if (!selectedTeam?.installationId || !project) {
    state.projectRename.error = "Could not find the selected project.";
    render();
    return;
  }

  if (selectedTeam.canManageProjects !== true) {
    state.projectRename.error = "You do not have permission to rename projects in this team.";
    render();
    return;
  }

  const nextTitle = state.projectRename.projectName.trim();
  if (!nextTitle) {
    state.projectRename.error = "Enter a project name.";
    render();
    return;
  }

  try {
    state.projectRename.status = "loading";
    state.projectRename.error = "";
    render();
    const mutation = {
      id: crypto.randomUUID(),
      type: "rename",
      projectId: project.id,
      title: nextTitle,
      previousTitle: project.title ?? project.name,
    };
    state.projectSyncVersion += 1;
    const snapshot = applyProjectPendingMutation(
      { items: state.projects, deletedItems: state.deletedProjects },
      mutation,
    );
    applyProjectSnapshotToState(snapshot);
    state.pendingProjectMutations = upsertPendingMutation(state.pendingProjectMutations, mutation);
    saveStoredProjectsForTeam(selectedTeam, {
      projects: state.projects,
      deletedProjects: state.deletedProjects,
    });
    saveStoredProjectPendingMutations(selectedTeam, state.pendingProjectMutations);
    resetProjectRename();
    render();
    void processPendingProjectMutations(render, selectedTeam);
  } catch (error) {
    if (await handleSyncFailure(classifySyncError(error), { render })) {
      return;
    }
    state.projectRename.status = "idle";
    state.projectRename.error = error?.message ?? String(error);
    render();
  }
}

export async function deleteProject(render, projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);

  if (!project) {
    state.projectDiscovery = {
      status: "error",
      error: "Could not find the selected project.",
    };
    render();
    return;
  }

  if (!selectedTeam?.installationId || !project) {
    state.projectDiscovery = {
      status: "error",
      error: "Could not find the selected project.",
    };
    render();
    return;
  }

  if (selectedTeam.canManageProjects !== true) {
    state.projectDiscovery = {
      status: "error",
      error: "You do not have permission to delete projects in this team.",
    };
    render();
    return;
  }

  state.projectSyncVersion += 1;
  setProjectUiDebug(render, "Delete clicked");
  const mutation = {
    id: crypto.randomUUID(),
    type: "softDelete",
    projectId: project.id,
  };
  const snapshot = applyProjectPendingMutation(
    { items: state.projects, deletedItems: state.deletedProjects },
    mutation,
  );
  applyProjectSnapshotToState(snapshot);
  state.pendingProjectMutations = upsertPendingMutation(state.pendingProjectMutations, mutation);
  if (state.projects.length === 0 && state.deletedProjects.length > 0) {
    state.showDeletedProjects = true;
  }
  saveStoredProjectsForTeam(selectedTeam, {
    projects: state.projects,
    deletedProjects: state.deletedProjects,
  });
  saveStoredProjectPendingMutations(selectedTeam, state.pendingProjectMutations);
  render();

  setProjectUiDebug(render, "Optimistic delete applied");
  void waitForNextPaint().then(() => {
    setProjectUiDebug(render, "First paint reached");
    setProjectUiDebug(render, "Background sync started");
    void processPendingProjectMutations(render, selectedTeam);
  });
}

export function toggleDeletedProjects(render) {
  state.showDeletedProjects = !state.showDeletedProjects;
  render();
}

export async function restoreProject(render, projectId) {
  const project = state.deletedProjects.find((item) => item.id === projectId);
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);

  if (!project) {
    state.projectDiscovery = {
      status: "error",
      error: "Could not find the selected deleted project.",
    };
    render();
    return;
  }

  if (!selectedTeam?.installationId) {
    state.projectDiscovery = {
      status: "error",
      error: "Could not restore the selected project.",
    };
    render();
    return;
  }

  if (selectedTeam.canManageProjects !== true) {
    state.projectDiscovery = {
      status: "error",
      error: "You do not have permission to restore projects in this team.",
    };
    render();
    return;
  }

  state.projectSyncVersion += 1;
  setProjectUiDebug(render, "Restore clicked");
  const mutation = {
    id: crypto.randomUUID(),
    type: "restore",
    projectId: project.id,
  };
  const snapshot = applyProjectPendingMutation(
    { items: state.projects, deletedItems: state.deletedProjects },
    mutation,
  );
  applyProjectSnapshotToState(snapshot);
  state.pendingProjectMutations = upsertPendingMutation(state.pendingProjectMutations, mutation);
  saveStoredProjectsForTeam(selectedTeam, {
    projects: state.projects,
    deletedProjects: state.deletedProjects,
  });
  saveStoredProjectPendingMutations(selectedTeam, state.pendingProjectMutations);
  render();

  setProjectUiDebug(render, "Optimistic restore applied");
  void waitForNextPaint().then(() => {
    setProjectUiDebug(render, "First paint reached");
    setProjectUiDebug(render, "Background sync started");
    void processPendingProjectMutations(render, selectedTeam);
  });
}

async function commitProjectMutation(selectedTeam, mutation) {
  const project =
    state.projects.find((item) => item.id === mutation.projectId) ??
    state.deletedProjects.find((item) => item.id === mutation.projectId);

  if (!selectedTeam?.installationId || !project) {
    return;
  }

  if (mutation.type === "rename") {
    await invoke("rename_gnosis_project_repo", {
      input: {
        installationId: selectedTeam.installationId,
        fullName: project.fullName,
        projectTitle: mutation.title,
      },
      sessionToken: requireBrokerSession(),
    });
    return;
  }

  if (mutation.type === "softDelete") {
    await invoke("mark_gnosis_project_repo_deleted", {
      input: {
        installationId: selectedTeam.installationId,
        orgLogin: selectedTeam.githubOrg,
        repoName: project.name,
      },
      sessionToken: requireBrokerSession(),
    });
    return;
  }

  if (mutation.type === "restore") {
    await invoke("restore_gnosis_project_repo", {
      input: {
        installationId: selectedTeam.installationId,
        orgLogin: selectedTeam.githubOrg,
        repoName: project.name,
      },
      sessionToken: requireBrokerSession(),
    });
  }
}

function rollbackVisibleProjectMutation(mutation) {
  const inverseMutation =
    mutation.type === "rename"
      ? {
          id: `${mutation.id}-rollback`,
          type: "rename",
          projectId: mutation.projectId,
          title: mutation.previousTitle,
        }
      : mutation.type === "softDelete"
        ? {
            id: `${mutation.id}-rollback`,
            type: "restore",
            projectId: mutation.projectId,
          }
        : mutation.type === "restore"
          ? {
              id: `${mutation.id}-rollback`,
              type: "softDelete",
              projectId: mutation.projectId,
            }
          : null;

  if (!inverseMutation) {
    return;
  }

  const snapshot = applyProjectPendingMutation(
    { items: state.projects, deletedItems: state.deletedProjects },
    inverseMutation,
  );
  applyProjectSnapshotToState(snapshot);
}

async function processPendingProjectMutations(render, selectedTeam) {
  const pendingMutations = [...state.pendingProjectMutations];

  for (const mutation of pendingMutations) {
    if (inflightProjectMutationIds.has(mutation.id)) {
      continue;
    }

    inflightProjectMutationIds.add(mutation.id);
    try {
      await waitForNextPaint();
      await commitProjectMutation(selectedTeam, mutation);
      state.pendingProjectMutations = removePendingMutation(
        state.pendingProjectMutations,
        mutation.id,
      );
      saveStoredProjectPendingMutations(selectedTeam, state.pendingProjectMutations);
      saveStoredProjectsForTeam(selectedTeam, {
        projects: state.projects,
        deletedProjects: state.deletedProjects,
      });
      setProjectUiDebug(render, `Background sync finished (${mutation.type})`);
      window.setTimeout(() => clearProjectUiDebug(render), 1200);
    } catch (error) {
      inflightProjectMutationIds.delete(mutation.id);
      clearProjectUiDebug(render);
      state.pendingProjectMutations = removePendingMutation(
        state.pendingProjectMutations,
        mutation.id,
      );
      saveStoredProjectPendingMutations(selectedTeam, state.pendingProjectMutations);
      rollbackVisibleProjectMutation(mutation);
      saveStoredProjectsForTeam(selectedTeam, {
        projects: state.projects,
        deletedProjects: state.deletedProjects,
      });
      if (await handleSyncFailure(classifySyncError(error), { render })) {
        return;
      }
      setProjectUiDebug(render, `Background sync failed (${mutation.type})`);
      await loadTeamProjects(render, selectedTeam?.id);
      return;
    }
    inflightProjectMutationIds.delete(mutation.id);
  }
}

export function permanentlyDeleteProject(render, projectId) {
  const project = state.deletedProjects.find((item) => item.id === projectId);
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  if (!project) {
    state.projectDiscovery = {
      status: "error",
      error: "Could not find the selected deleted project.",
    };
    render();
    return;
  }

  if (selectedTeam?.canDelete !== true) {
    state.projectDiscovery = {
      status: "error",
      error: "You do not have permission to delete projects in this team.",
    };
    render();
    return;
  }

  state.projectPermanentDeletion = {
    isOpen: true,
    projectId,
    projectName: project.title ?? project.name,
    confirmationText: "",
    status: "idle",
    error: "",
  };
  render();
}

export function updateProjectPermanentDeletionConfirmation(value) {
  state.projectPermanentDeletion.confirmationText = value;
  if (state.projectPermanentDeletion.error) {
    state.projectPermanentDeletion.error = "";
  }
}

export function cancelProjectPermanentDeletion(render) {
  resetProjectPermanentDeletion();
  render();
}

export async function confirmProjectPermanentDeletion(render) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  const project = state.deletedProjects.find(
    (item) => item.id === state.projectPermanentDeletion.projectId,
  );

  if (!selectedTeam?.installationId || !project) {
    state.projectPermanentDeletion.status = "idle";
    state.projectPermanentDeletion.error = "Could not find the selected deleted project.";
    render();
    return;
  }

  if (selectedTeam.canManageProjects !== true) {
    state.projectPermanentDeletion.status = "idle";
    state.projectPermanentDeletion.error = "You do not have permission to delete projects in this team.";
    render();
    return;
  }

  if (state.projectPermanentDeletion.confirmationText !== state.projectPermanentDeletion.projectName) {
    state.projectPermanentDeletion.error = "Project name confirmation does not match.";
    render();
    return;
  }

  try {
    state.projectPermanentDeletion.status = "loading";
    state.projectPermanentDeletion.error = "";
    render();
    await waitForNextPaint();
    await invoke("permanently_delete_gnosis_project_repo", {
      input: {
        installationId: selectedTeam.installationId,
        orgLogin: selectedTeam.githubOrg,
        repoName: project.name,
      },
      sessionToken: requireBrokerSession(),
    });
    resetProjectPermanentDeletion();
    await loadTeamProjects(render, selectedTeam.id);
  } catch (error) {
    if (await handleSyncFailure(classifySyncError(error), { render })) {
      return;
    }
    state.projectPermanentDeletion.status = "idle";
    state.projectPermanentDeletion.error = error?.message ?? String(error);
    render();
  }
}

function slugifyRepositoryName(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}
