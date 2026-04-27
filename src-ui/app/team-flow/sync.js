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
import { loadTeamProjects } from "../project-flow.js";
import { consumePendingSingleTeamAutoOpen } from "./auto-open.js";
import {
  createTeamsQueryOptions,
  ensureTeamsQueryObserver,
  seedTeamsQueryFromCache,
} from "../team-query.js";
import { queryClient } from "../query-client.js";

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
    ensureTeamsQueryObserver(render, { authLogin });
    await queryClient.fetchQuery(createTeamsQueryOptions({ authLogin }));
    await completePageSync(render);
    const shouldAutoOpenSingleTeam = consumePendingSingleTeamAutoOpen(
      state.auth,
      state.screen,
    );
    if (shouldAutoOpenSingleTeam && state.teams.length === 1) {
      state.selectedTeamId = state.teams[0].id;
      state.screen = "projects";
      render();
      await loadTeamProjects(render, state.selectedTeamId);
      return;
    }
  } catch (error) {
    if (await handleSyncFailure(classifySyncError(error), { render })) {
      failPageSync();
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
