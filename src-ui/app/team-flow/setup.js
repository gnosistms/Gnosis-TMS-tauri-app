import { GITHUB_FREE_ORG_SETUP_URL } from "../constants.js";
import { handleBrokerAuthExpired, requireBrokerSession } from "../auth-flow.js";
import { loadTeamProjects } from "../project-flow.js";
import { invoke, openExternalUrl } from "../runtime.js";
import { resetTeamSetup, state } from "../state.js";
import { upsertStoredTeamRecords } from "../team-storage.js";
import {
  applyStoredTeamRecords,
  buildTeamRecordFromInstallation,
  resetOpenState,
} from "./shared.js";

async function runFinishTeamSetupStep(label, action) {
  try {
    return await action();
  } catch (error) {
    throw new Error(`Failed while ${label}: ${error?.message ?? String(error)}`);
  }
}

export async function openTeamSetup(render) {
  state.teamSetup = {
    ...state.teamSetup,
    ...resetOpenState(),
    isOpen: true,
  };
  render();

  if (!state.auth.session?.sessionToken) {
    state.teamSetup.error = "Sign in with GitHub before creating a team.";
    render();
  }
}

export async function beginTeamOrgSetup(render) {
  state.teamSetup.step = "returnFromOrgCreation";
  state.teamSetup.error = "";
  render();
  openExternalUrl(GITHUB_FREE_ORG_SETUP_URL);
}

export function acknowledgeTeamSetup(render) {
  state.teamSetup.step = "guide";
  state.teamSetup.error = "";
  render();
}

export function continueTeamSetupAfterOrgCreation(render) {
  state.teamSetup.step = "confirm";
  state.teamSetup.error = "";
  render();
}

export async function beginGithubAppInstall(render) {
  try {
    const { installUrl } = await invoke("begin_github_app_install");
    state.teamSetup.step = "waitingForAppInstall";
    state.teamSetup.error = "";
    render();
    openExternalUrl(installUrl);
  } catch (error) {
    if (await handleBrokerAuthExpired(render, error)) {
      return;
    }
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
    const installation = await runFinishTeamSetupStep("loading the GitHub App installation details", () =>
      invoke("inspect_github_app_installation", {
        installationId: state.teamSetup.githubAppInstallationId,
        sessionToken: requireBrokerSession(),
      })
    );
    await runFinishTeamSetupStep("configuring the GitHub organization", () =>
      invoke("setup_organization_for_installation", {
        installationId: installation.installationId,
        orgLogin: installation.accountLogin,
        sessionToken: requireBrokerSession(),
      })
    );
    await runFinishTeamSetupStep("configuring the GitHub custom repository property schema", () =>
      invoke("ensure_gnosis_repo_properties_schema", {
        installationId: installation.installationId,
        orgLogin: installation.accountLogin,
        sessionToken: requireBrokerSession(),
      })
    );
    await runFinishTeamSetupStep("verifying the team-metadata repository", () =>
      invoke("inspect_team_metadata_repo_for_installation", {
        installationId: installation.installationId,
        orgLogin: installation.accountLogin,
        sessionToken: requireBrokerSession(),
      })
    );

    state.teamSetup.githubAppInstallation = installation;
    const nextTeamRecords = upsertStoredTeamRecords([
      buildTeamRecordFromInstallation(installation),
    ]);
    applyStoredTeamRecords(nextTeamRecords);

    const teamId =
      state.teams.find((team) => team.githubOrg === installation.accountLogin)?.id ??
      `github-app-installation-${installation.installationId}`;
    state.selectedTeamId = teamId;
    state.screen = "projects";
    state.showDeletedTeams = false;
    resetTeamSetup();
    render();
    await loadTeamProjects(render, teamId);
  } catch (error) {
    if (await handleBrokerAuthExpired(render, error)) {
      return;
    }
    state.teamSetup.error = error?.message ?? String(error);
    render();
  }
}

export function setGithubAppInstallation(payload, render) {
  if (!state.teamSetup.isOpen) {
    return;
  }

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

export function cancelTeamSetup(render) {
  resetTeamSetup();
  render();
}
