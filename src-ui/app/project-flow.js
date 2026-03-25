import { invoke } from "./runtime.js";
import { resetProjectCreation, state } from "./state.js";

export async function loadTeamProjects(render, teamId = state.selectedTeamId) {
  const selectedTeam = state.teams.find((team) => team.id === teamId);

  if (!selectedTeam?.installationId) {
    state.projects = [];
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
    state.projects = projects.map((project) => ({
      ...project,
      id: `repo-${project.id}`,
      chapters: [],
    }));
    state.projectDiscovery = { status: "ready", error: "" };
    render();
  } catch (error) {
    state.projects = [];
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

function slugifyRepositoryName(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}
