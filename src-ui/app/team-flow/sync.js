import {
  handleBrokerAuthExpired,
  isBrokerAuthExpiredError,
  requireBrokerSession,
} from "../auth-flow.js";
import { beginPageSync, completePageSync, failPageSync } from "../page-sync.js";
import { loadTeamProjects } from "../project-flow.js";
import { invoke } from "../runtime.js";
import { state } from "../state.js";
import { replaceStoredTeamRecords, splitStoredTeamRecords } from "../team-storage.js";
import {
  applyStoredTeamRecords,
  reconcileStoredTeam,
  resolveNextSelectedTeamId,
} from "./shared.js";

function disconnectedTeam(storedTeam) {
  return {
    ...storedTeam,
    isDeleted: false,
    deletedAt: null,
    syncState: "disconnected",
    statusLabel: "GitHub App disconnected",
  };
}

function missingInstallationTeam(storedTeam) {
  return {
    ...storedTeam,
    isDeleted: true,
    deletedAt: storedTeam.deletedAt ?? new Date().toISOString(),
    syncState: "deleted",
    statusLabel: "Missing GitHub App installation",
  };
}

export async function loadUserTeams(render) {
  const storedTeamRecords = splitStoredTeamRecords();
  const storedActiveTeams = storedTeamRecords.activeTeams;
  const storedDeletedTeams = storedTeamRecords.deletedTeams;

  if (!state.auth.session?.sessionToken) {
    state.teams = storedActiveTeams;
    state.deletedTeams = storedDeletedTeams;
    state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, storedActiveTeams);
    state.orgDiscovery = { status: "idle", error: "" };
    state.sync.teams = "idle";
    render();
    return;
  }

  state.teams = storedActiveTeams;
  state.deletedTeams = storedDeletedTeams;
  state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, storedActiveTeams);
  state.sync.teams = "syncing";
  beginPageSync();
  state.orgDiscovery = { status: "loading", error: "" };
  if (state.teams.length === 0 && state.deletedTeams.length > 0) {
    state.showDeletedTeams = true;
  }
  render();

  try {
    const existingTeamRecords = [...storedActiveTeams, ...storedDeletedTeams];
    const reconciledTeams = await Promise.all(
      existingTeamRecords.map(async (storedTeam) => {
        if (!storedTeam.installationId) {
          return missingInstallationTeam(storedTeam);
        }

        try {
          const installation = await invoke("inspect_github_app_installation", {
            installationId: storedTeam.installationId,
            sessionToken: requireBrokerSession(),
          });
          return reconcileStoredTeam(storedTeam, installation);
        } catch (error) {
          if (isBrokerAuthExpiredError(error)) {
            throw error;
          }
          return disconnectedTeam(storedTeam);
        }
      }),
    );

    const nextStoredTeams = replaceStoredTeamRecords(reconciledTeams);
    applyStoredTeamRecords(nextStoredTeams);
    state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, state.teams);
    state.orgDiscovery = { status: "ready", error: "" };
    state.sync.teams = "idle";
    completePageSync(render);

    const shouldAutoOpenSingleTeam =
      storedActiveTeams.length === 0 && state.teams.length === 1;

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
    if (await handleBrokerAuthExpired(render, error)) {
      failPageSync();
      return;
    }
    state.teams = storedActiveTeams;
    state.deletedTeams = storedDeletedTeams;
    state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, storedActiveTeams);
    state.orgDiscovery = {
      status: "error",
      error: error?.message ?? String(error),
    };
    state.sync.teams = "idle";
    failPageSync();
    if (state.teams.length === 0 && state.deletedTeams.length > 0) {
      state.showDeletedTeams = true;
    }
    render();
  }
}
