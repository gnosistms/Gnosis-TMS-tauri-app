import { beginPageSync, completePageSync, failPageSync } from "../page-sync.js";
import { state } from "../state.js";
import {
  splitStoredTeamRecords,
} from "../team-storage.js";
import {
  applyTeamSnapshotToState,
  resolveNextSelectedTeamId,
} from "./shared.js";
import { classifySyncError } from "../sync-error.js";
import { handleSyncFailure } from "../sync-recovery.js";
import {
  loadTeamProjects,
  primeProjectsLoadingState,
} from "../project-flow.js";
import { consumePendingSingleTeamAutoOpen } from "./auto-open.js";
import {
  ensureTeamsQueryObserver,
  seedTeamsQueryFromCache,
} from "../team-query.js";

export async function loadUserTeams(render) {
  const authLogin = typeof state.auth.session?.login === "string"
    ? state.auth.session.login.trim().toLowerCase()
    : null;

  if (!state.auth.session?.sessionToken) {
    const storedTeamRecords = splitStoredTeamRecords();
    applyTeamSnapshotToState({
      items: storedTeamRecords.activeTeams,
      deletedItems: storedTeamRecords.deletedTeams,
    });
    state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, state.teams);
    state.orgDiscovery = { status: "idle", error: "" };
    state.teamsPage.isRefreshing = false;
    render();
    return;
  }

  if (state.offline.isEnabled) {
    seedTeamsQueryFromCache({ authLogin, render });
    state.teamsPage.isRefreshing = false;
    state.orgDiscovery = { status: "ready", error: "" };
    render();
    return;
  }

  seedTeamsQueryFromCache({ authLogin, render });
  beginPageSync();
  state.orgDiscovery = { status: "loading", error: "" };
  render();

  try {
    const teamsQuerySubscription = ensureTeamsQueryObserver(render, { authLogin });
    const teamsQueryObserver = teamsQuerySubscription.observer;
    await teamsQueryObserver.refetch({
      throwOnError: true,
      cancelRefetch: false,
    });
    await completePageSync(render);
    render();
    const shouldAutoOpenSingleTeam = consumePendingSingleTeamAutoOpen(
      state.auth,
      state.screen,
    );
    if (shouldAutoOpenSingleTeam && state.teams.length === 1) {
      state.selectedTeamId = state.teams[0].id;
      state.screen = "projects";
      primeProjectsLoadingState(state.selectedTeamId);
      render();
      await loadTeamProjects(render, state.selectedTeamId);
      return;
    }
  } catch (error) {
    state.teamsPage.isRefreshing = false;
    if (await handleSyncFailure(classifySyncError(error), { render })) {
      failPageSync();
      render();
      return;
    }
    state.orgDiscovery = {
      status: "error",
      error: error?.message ?? String(error),
    };
    failPageSync();
    render();
  }
}
