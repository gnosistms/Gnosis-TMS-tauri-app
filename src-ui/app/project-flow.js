import { invoke, waitForNextPaint } from "./runtime.js";
import {
  resetProjectCreation,
  resetProjectDeletion,
  resetProjectPermanentDeletion,
  resetProjectRename,
  state,
} from "./state.js";

export async function loadTeamProjects(render, teamId = state.selectedTeamId) {
  const selectedTeam = state.teams.find((team) => team.id === teamId);

  if (!selectedTeam?.installationId) {
    state.projects = [];
    state.deletedProjects = [];
    state.projectDiscovery = { status: "ready", error: "" };
    render();
    return;
  }

  state.projectDiscovery = { status: "loading", error: "" };
  render();

  try {
    const projects = await invoke("list_gnosis_projects_for_installation", {
      installationId: selectedTeam.installationId,
    });
    const mappedProjects = projects.map((project) => ({
      ...project,
      chapters: [],
    }));
    state.projects = mappedProjects.filter((project) => project.status !== "deleted");
    state.deletedProjects = mappedProjects.filter((project) => project.status === "deleted");
    state.projectDiscovery = { status: "ready", error: "" };
    render();
  } catch (error) {
    state.projects = [];
    state.deletedProjects = [];
    state.projectDiscovery = {
      status: "error",
      error: error?.message ?? String(error),
    };
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
  if (!project) {
    state.projectDiscovery = {
      status: "error",
      error: "Could not find the selected project.",
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
    });
    resetProjectCreation();
    await loadTeamProjects(render, selectedTeam.id);
  } catch (error) {
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
    await waitForNextPaint();
    await invoke("rename_gnosis_project_repo", {
      input: {
        installationId: selectedTeam.installationId,
        fullName: project.fullName,
        projectTitle: nextTitle,
      },
    });
    state.projects = state.projects.map((item) =>
      item.id === project.id
        ? {
            ...item,
            title: nextTitle,
          }
        : item,
    );
    resetProjectRename();
    render();
  } catch (error) {
    state.projectRename.status = "idle";
    state.projectRename.error = error?.message ?? String(error);
    render();
  }
}

export async function deleteProject(render, projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) {
    state.projectDiscovery = {
      status: "error",
      error: "Could not find the selected project.",
    };
    render();
    return;
  }

  state.projectDeletion = {
    isOpen: true,
    projectId,
    projectName: project.title ?? project.name,
    status: "idle",
    error: "",
  };
  render();
}

export function cancelProjectDeletion(render) {
  resetProjectDeletion();
  render();
}

export function toggleDeletedProjects(render) {
  state.showDeletedProjects = !state.showDeletedProjects;
  render();
}

export function permanentlyDeleteProject(render, projectId) {
  const project = state.deletedProjects.find((item) => item.id === projectId);
  if (!project) {
    state.projectDiscovery = {
      status: "error",
      error: "Could not find the selected deleted project.",
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

export async function confirmProjectDeletion(render) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  const project = state.projects.find((item) => item.id === state.projectDeletion.projectId);

  if (!selectedTeam?.installationId || !project) {
    state.projectDeletion.status = "idle";
    state.projectDeletion.error = "Could not find the selected project.";
    render();
    return;
  }

  try {
    state.projectDeletion.status = "loading";
    state.projectDeletion.error = "";
    render();
    await waitForNextPaint();
    await invoke("mark_gnosis_project_repo_deleted", {
      input: {
        installationId: selectedTeam.installationId,
        orgLogin: selectedTeam.githubOrg,
        repoName: project.name,
      },
    });
    resetProjectDeletion();
    await loadTeamProjects(render, selectedTeam.id);
  } catch (error) {
    state.projectDeletion.status = "idle";
    state.projectDeletion.error = error?.message ?? String(error);
    render();
  }
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
    });
    resetProjectPermanentDeletion();
    await loadTeamProjects(render, selectedTeam.id);
  } catch (error) {
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
