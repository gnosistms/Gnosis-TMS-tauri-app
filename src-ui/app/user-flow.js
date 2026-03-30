import { invoke } from "./runtime.js";
import { requireBrokerSession } from "./auth-flow.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import { state } from "./state.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";

export async function loadTeamUsers(render, teamId = state.selectedTeamId) {
  const selectedTeam = state.teams.find((team) => team.id === teamId);

  if (state.offline.isEnabled) {
    state.users = [];
    state.userDiscovery = {
      status: "error",
      error: "Users are unavailable in offline mode.",
    };
    render();
    return;
  }

  if (!selectedTeam?.installationId) {
    state.users = [];
    state.userDiscovery = { status: "ready", error: "" };
    render();
    return;
  }

  state.userDiscovery = { status: "loading", error: "" };
  beginPageSync();
  render();

  try {
    const users = await invoke("list_organization_members_for_installation", {
      installationId: selectedTeam.installationId,
      orgLogin: selectedTeam.githubOrg,
      sessionToken: requireBrokerSession(),
    });
    state.users = users;
    state.userDiscovery = { status: "ready", error: "" };
    completePageSync(render);
    render();
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
    state.users = [];
    state.userDiscovery = {
      status: "error",
      error: error?.message ?? String(error),
    };
    failPageSync();
    render();
  }
}
