import { openConnectionFailureModal } from "./connection-failure.js";
import { checkInternetConnection } from "./offline-connectivity.js";
import { showNoticeBadge } from "./status-feedback.js";
import { createProjectDiscoveryState, state } from "./state.js";
import { removeStoredTeamRecord, splitStoredTeamRecords } from "./team-storage.js";
import { applyTeamSnapshotToState, resolveNextSelectedTeamId } from "./team-flow/shared.js";
import { parseRequiredAppUpdateFromError, requireAppUpdate } from "./updater-flow.js";

export async function handleSyncFailure(
  classification,
  { render, teamId = null, currentResource = false } = {},
) {
  if (classification?.type === "app_update_required") {
    const requirement = parseRequiredAppUpdateFromError(classification.message);
    return requireAppUpdate(requirement, render);
  }

  if (classification?.type === "connection_unavailable") {
    if (state.offline?.isEnabled === true) {
      return true;
    }

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
      state.projectDiscovery = createProjectDiscoveryState();
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

  state.auth = {
    ...state.auth,
    status: "expired",
    message:
      "GitHub could not refresh this session. You are still signed in locally; online sync will retry automatically.",
  };
  if (render) {
    showNoticeBadge(state.auth.message, render);
  }
  return true;
}
