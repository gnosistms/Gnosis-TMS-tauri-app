import { clearStoredAuthSession } from "./auth-storage.js";
import { openConnectionFailureModal } from "./connection-failure.js";
import { checkInternetConnection } from "./offline-connectivity.js";
import { showNoticeBadge } from "./status-feedback.js";
import { resetSessionState, state } from "./state.js";
import { removeStoredTeamRecord, splitStoredTeamRecords } from "./team-storage.js";
import { applyTeamSnapshotToState, resolveNextSelectedTeamId } from "./team-flow/shared.js";

export async function handleSyncFailure(
  classification,
  { render, teamId = null, currentResource = false } = {},
) {
  if (classification?.type === "connection_unavailable") {
    const hasConnection = await checkInternetConnection();
    state.offline.checked = true;
    state.offline.hasConnection = hasConnection;

    const message =
      !hasConnection
        ? "No internet connection."
        :
      classification.source === "broker"
        ? "Could not connect to Gnosis TMS server."
        : classification.source === "github"
          ? "Could not connect to GitHub."
          : "Could not connect. Try again or work offline.";
    openConnectionFailureModal(message, render);
    return true;
  }

  if (classification?.type === "resource_access_lost") {
    if (teamId) {
      const nextStoredTeams = removeStoredTeamRecord(teamId);
      const splitTeams = splitStoredTeamRecords(nextStoredTeams);
      applyTeamSnapshotToState({
        items: splitTeams.activeTeams,
        deletedItems: splitTeams.deletedTeams,
      });
      state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, state.teams);
    }

    if (currentResource) {
      state.projects = [];
      state.deletedProjects = [];
      state.users = [];
      state.projectDiscovery = { status: "idle", error: "" };
      state.userDiscovery = { status: "idle", error: "" };
      state.screen = "teams";
      showNoticeBadge("You no longer have access to this team.", render);
      render?.();
    }

    return true;
  }

  if (classification?.type !== "auth_invalid") {
    return false;
  }

  await clearStoredAuthSession();
  resetSessionState();
  state.auth = {
    status: "expired",
    message:
      "Your GitHub session expired. Please log in with GitHub again to continue.",
    session: null,
  };
  state.screen = "start";
  render?.();
  return true;
}
