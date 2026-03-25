import { GITHUB_FREE_ORG_SETUP_URL, GNOSIS_TMS_ORG_DESCRIPTION } from "./constants.js";
import { loadTeamProjects } from "./project-flow.js";
import { invoke, openExternalUrl, waitForNextPaint } from "./runtime.js";
import { resetTeamRename, resetTeamSetup, state } from "./state.js";
import {
  replaceStoredTeamRecords,
  splitStoredTeamRecords,
  updateStoredGithubAppTeam,
  upsertStoredTeamRecords,
} from "./team-storage.js";

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
    const nextTeam = {
      id: `github-app-installation-${installation.installationId}`,
      name: installation.accountLogin,
      githubOrg: installation.accountLogin,
      ownerLogin: state.auth.session?.login ?? installation.accountLogin,
      installationId: installation.installationId,
      isDeleted: false,
      deletedAt: null,
      syncState: "active",
      statusLabel: "",
      lastSeenAt: new Date().toISOString(),
    };
    const nextTeamRecords = upsertStoredTeamRecords([nextTeam]);
    applyStoredTeamRecords(nextTeamRecords);
    state.selectedTeamId =
      state.teams.find((team) => team.githubOrg === nextTeam.githubOrg)?.id ?? nextTeam.id;
    state.screen = "projects";
    state.showDeletedTeams = false;
    resetTeamSetup();
    render();
    await loadTeamProjects(render, state.selectedTeamId);
  } catch (error) {
    state.teamSetup.error = error?.message ?? String(error);
    render();
  }
}

export async function loadUserTeams(render) {
  const storedTeamRecords = splitStoredTeamRecords();
  const storedActiveTeams = storedTeamRecords.activeTeams;
  const storedDeletedTeams = storedTeamRecords.deletedTeams;

  if (!state.auth.session?.accessToken) {
    state.teams = storedActiveTeams;
    state.deletedTeams = storedDeletedTeams;
    state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, storedActiveTeams);
    state.orgDiscovery = { status: "idle", error: "" };
    state.sync.teams = "idle";
    if (state.teams.length === 0 && state.deletedTeams.length > 0) {
      state.showDeletedTeams = true;
    }
    render();
    return;
  }

  state.teams = storedActiveTeams;
  state.deletedTeams = storedDeletedTeams;
  state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, storedActiveTeams);
  state.sync.teams = "syncing";
  state.orgDiscovery = { status: "loading", error: "" };
  if (state.teams.length === 0 && state.deletedTeams.length > 0) {
    state.showDeletedTeams = true;
  }
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
        installationId: null,
        orgCreatedAt: organization.createdAt ?? null,
        isDeleted: false,
        deletedAt: null,
        syncState: "active",
        statusLabel: "",
        lastSeenAt: new Date().toISOString(),
      }));

    const existingTeamRecords = [...storedActiveTeams, ...storedDeletedTeams];
    const teamsByOrg = new Map(oauthTeams.map((team) => [team.githubOrg.toLowerCase(), team]));
    const reconciledTeams = await Promise.all(
      existingTeamRecords.map(async (storedTeam) => {
        const matchedOrg = teamsByOrg.get(storedTeam.githubOrg.toLowerCase());
        const nextTeam = {
          ...storedTeam,
          name: matchedOrg?.name || storedTeam.name || storedTeam.githubOrg,
          ownerLogin:
            matchedOrg?.ownerLogin || storedTeam.ownerLogin || state.auth.session.login,
          orgCreatedAt: matchedOrg?.orgCreatedAt ?? storedTeam.orgCreatedAt ?? null,
          lastSeenAt: matchedOrg ? new Date().toISOString() : storedTeam.lastSeenAt ?? null,
        };

        if (!matchedOrg) {
          return {
            ...nextTeam,
            isDeleted: true,
            deletedAt: storedTeam.deletedAt ?? new Date().toISOString(),
            syncState: "deleted",
            statusLabel: "Preserved locally",
          };
        }

        if (!storedTeam.installationId) {
          return {
            ...nextTeam,
            isDeleted: false,
            deletedAt: null,
            syncState: "active",
            statusLabel: "",
          };
        }

        try {
          await invoke("inspect_github_app_installation", {
            installationId: storedTeam.installationId,
          });
          return {
            ...nextTeam,
            isDeleted: false,
            deletedAt: null,
            syncState: "active",
            statusLabel: "",
          };
        } catch {
          return {
            ...nextTeam,
            isDeleted: false,
            deletedAt: null,
            syncState: "disconnected",
            statusLabel: "GitHub App disconnected",
          };
        }
      }),
    );

    oauthTeams.forEach((oauthTeam) => {
      if (!reconciledTeams.some((team) => team.githubOrg === oauthTeam.githubOrg)) {
        reconciledTeams.push(oauthTeam);
      }
    });

    const nextStoredTeams = replaceStoredTeamRecords(reconciledTeams);
    applyStoredTeamRecords(nextStoredTeams);
    state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, state.teams);
    state.orgDiscovery = { status: "ready", error: "" };
    state.sync.teams = "idle";
    const shouldAutoOpenSingleTeam = storedActiveTeams.length === 0 && state.teams.length === 1;
    if (state.teams.length === 0 && state.deletedTeams.length > 0) {
      state.showDeletedTeams = true;
    }
    if (shouldAutoOpenSingleTeam) {
      state.selectedTeamId = state.teams[0].id;
      state.screen = "projects";
    }
    render();
    if (shouldAutoOpenSingleTeam && state.selectedTeamId) {
      await loadTeamProjects(render, state.selectedTeamId);
    }
  } catch (error) {
    state.teams = storedActiveTeams;
    state.deletedTeams = storedDeletedTeams;
    state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, storedActiveTeams);
    state.orgDiscovery = {
      status: "error",
      error: error?.message ?? String(error),
    };
    state.sync.teams = "idle";
    if (state.teams.length === 0 && state.deletedTeams.length > 0) {
      state.showDeletedTeams = true;
    }
    render();
  }
}

export function openTeamRename(render, teamId) {
  const team = state.teams.find((item) => item.id === teamId);
  if (!team) {
    return;
  }

  state.teamRename = {
    isOpen: true,
    teamId,
    teamName: team.name || team.githubOrg,
    status: "idle",
    error: "",
  };
  render();
}

export function updateTeamRenameName(teamName) {
  state.teamRename.teamName = teamName;
  if (state.teamRename.error) {
    state.teamRename.error = "";
  }
}

export function cancelTeamRename(render) {
  resetTeamRename();
  render();
}

export async function submitTeamRename(render) {
  const team = state.teams.find((item) => item.id === state.teamRename.teamId);
  if (!team?.installationId) {
    state.teamRename.error = "Team renaming currently requires a GitHub App-connected team.";
    render();
    return;
  }

  const nextName = state.teamRename.teamName.trim();
  if (!nextName) {
    state.teamRename.error = "Enter a team name.";
    render();
    return;
  }

  try {
    state.teamRename.status = "loading";
    state.teamRename.error = "";
    render();
    await waitForNextPaint();
    const organization = await invoke("update_organization_name_for_installation", {
      installationId: team.installationId,
      orgLogin: team.githubOrg,
      name: nextName,
    });

    const resolvedName = organization.name || organization.login;
    state.teams = state.teams.map((item) =>
      item.id === team.id
        ? {
            ...item,
            name: resolvedName,
          }
        : item,
    );
    updateStoredGithubAppTeam(team.id, { name: resolvedName });
    resetTeamRename();
    render();
  } catch (error) {
    state.teamRename.status = "idle";
    state.teamRename.error = error?.message ?? String(error);
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

function applyStoredTeamRecords(teamRecords) {
  const { activeTeams, deletedTeams } = splitStoredTeamRecords(teamRecords);
  state.teams = activeTeams;
  state.deletedTeams = deletedTeams;
  if (deletedTeams.length === 0) {
    state.showDeletedTeams = false;
  }
}

function resolveNextSelectedTeamId(currentTeamId, teams) {
  if (currentTeamId && teams.some((team) => team.id === currentTeamId)) {
    return currentTeamId;
  }

  return teams[0]?.id ?? null;
}
