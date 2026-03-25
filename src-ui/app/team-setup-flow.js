import { GITHUB_FREE_ORG_SETUP_URL, GNOSIS_TMS_ORG_DESCRIPTION } from "./constants.js";
import { invoke, openExternalUrl } from "./runtime.js";
import { resetTeamSetup, state } from "./state.js";
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

export async function finishTeamSetup(render) {
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
    state.screen = "projects";
    resetTeamSetup();
    render();
  } catch (error) {
    state.teamSetup.error = error?.message ?? String(error);
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
      .filter((organization) => organization.description === GNOSIS_TMS_ORG_DESCRIPTION)
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
    state.screen = state.teams.length === 1 ? "projects" : "teams";
    render();
  } catch (error) {
    state.teams = githubAppTeams;
    state.selectedTeamId = state.teams[0]?.id ?? null;
    state.orgDiscovery = {
      status: "error",
      error: error?.message ?? String(error),
    };
    state.screen = state.teams.length === 1 ? "projects" : "teams";
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
