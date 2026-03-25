import { GITHUB_FREE_ORG_SETUP_URL, GNOSIS_TMS_ORG_DESCRIPTION } from "./constants.js";
import { invoke, openExternalUrl } from "./runtime.js";
import { resetProjectCreation, resetTeamSetup, state } from "./state.js";
import { loadStoredGithubAppTeams, mergeTeams, saveStoredGithubAppTeams } from "./team-storage.js";

export async function openTeamSetup(render) {
  state.teamSetup = {
    ...state.teamSetup,
    ...resetOpenState(),
    isOpen: true,
  };
  render();

  if (!state.auth.session?.accessToken) {
    state.teamSetup.error = "Sign in with GitHub before creating a team.";
    render();
  }
}

export async function beginTeamOrgSetup(render) {
  state.teamSetup.step = "confirm";
  state.teamSetup.error = "";
  render();
  openExternalUrl(GITHUB_FREE_ORG_SETUP_URL);
}

export async function beginGithubAppInstall(render) {
  try {
    const { installUrl } = await invoke("begin_github_app_install");
    state.teamSetup.step = "waitingForAppInstall";
    state.teamSetup.error = "";
    render();
    openExternalUrl(installUrl);
  } catch (error) {
    state.teamSetup.error = error?.message ?? String(error);
    render();
  }
}

export async function finishTeamSetup(render, loadUserTeams) {
  if (!state.teamSetup.githubAppInstallationId) {
    state.teamSetup.error = "Install the Gnosis TMS GitHub App before finishing setup.";
    render();
    return;
  }

  try {
    const installation = await invoke("inspect_github_app_installation", {
      installationId: state.teamSetup.githubAppInstallationId,
    });
    await invoke("ensure_gnosis_repo_properties_schema", {
      installationId: installation.installationId,
      orgLogin: installation.accountLogin,
    });
    state.teamSetup.githubAppInstallation = installation;
    const githubAppTeams = loadStoredGithubAppTeams();
    const nextTeam = {
      id: `github-app-installation-${installation.installationId}`,
      name: installation.accountLogin,
      githubOrg: installation.accountLogin,
      ownerLogin: state.auth.session?.login ?? installation.accountLogin,
      statusLabel: "GitHub App Connected",
      installationId: installation.installationId,
    };
    const nextTeams = mergeTeams([nextTeam], githubAppTeams);
    saveStoredGithubAppTeams(nextTeams);
    state.teams = mergeTeams(state.teams, nextTeams);
    state.selectedTeamId = nextTeam.id;
    resetTeamSetup();
    render();
  } catch (error) {
    state.teamSetup.error = error?.message ?? String(error);
    render();
  }
}

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

export async function loadTeamUsers(render, teamId = state.selectedTeamId) {
  const selectedTeam = state.teams.find((team) => team.id === teamId);

  if (!selectedTeam?.installationId) {
    state.users = [];
    state.userDiscovery = { status: "ready", error: "" };
    render();
    return;
  }

  state.userDiscovery = { status: "loading", error: "" };
  render();

  try {
    const users = await invoke("list_organization_members_for_installation", {
      installationId: selectedTeam.installationId,
      orgLogin: selectedTeam.githubOrg,
    });
    state.users = users;
    state.userDiscovery = { status: "ready", error: "" };
    render();
  } catch (error) {
    state.users = [];
    state.userDiscovery = {
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

export function updateProjectCreationName(render, projectName) {
  state.projectCreation.projectName = projectName;
  if (state.projectCreation.error) {
    state.projectCreation.error = "";
  }
  render();
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

export async function loadUserTeams(render) {
  const githubAppTeams = loadStoredGithubAppTeams();
  if (!state.auth.session?.accessToken) {
    state.teams = githubAppTeams;
    state.orgDiscovery = { status: "idle", error: "" };
    render();
    return;
  }

  state.orgDiscovery = { status: "loading", error: "" };
  render();

  try {
    const organizations = await invoke("list_user_organizations", {
      accessToken: state.auth.session.accessToken,
    });
    const oauthTeams = organizations
      .filter(
        (organization) =>
          organization.description === GNOSIS_TMS_ORG_DESCRIPTION,
      )
      .map((organization) => ({
        id: organization.login,
        name: organization.name || organization.login,
        githubOrg: organization.login,
        ownerLogin: state.auth.session.login,
        statusLabel: "Connected",
      }));
    state.teams = mergeTeams(oauthTeams, githubAppTeams);
    state.selectedTeamId = state.teams[0]?.id ?? null;
    state.orgDiscovery = { status: "ready", error: "" };
    render();
  } catch (error) {
    state.teams = githubAppTeams;
    state.orgDiscovery = {
      status: "error",
      error: error?.message ?? String(error),
    };
    render();
  }
}

export function setGithubAppInstallation(payload, render) {
  if (payload?.status === "success" && payload.installationId) {
    state.teamSetup.githubAppInstallationId = payload.installationId;
    state.teamSetup.step = "finishInstall";
    state.teamSetup.error = "";
    render();
    return;
  }

  state.teamSetup.error =
    payload?.message ?? "GitHub App installation did not complete.";
  render();
}

function resetOpenState() {
  return {
    step: "guide",
    error: "",
    githubAppInstallationId: null,
    githubAppInstallation: null,
  };
}

function slugifyRepositoryName(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}
