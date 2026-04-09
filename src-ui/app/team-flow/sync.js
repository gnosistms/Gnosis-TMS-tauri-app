import {
  requireBrokerSession,
} from "../auth-flow.js";
import { beginPageSync, completePageSync, failPageSync } from "../page-sync.js";
import { invoke } from "../runtime.js";
import { state } from "../state.js";
import {
  replaceStoredTeamRecords,
  saveStoredTeamRecords,
  splitStoredTeamRecords,
} from "../team-storage.js";
import { applyPendingMutations } from "../optimistic-collection.js";
import { loadStoredTeamPendingMutations } from "../team-storage.js";
import {
  applyTeamPendingMutation,
  applyTeamSnapshotToState,
  buildTeamRecordFromInstallation,
  reconcileStoredTeam,
  resolveNextSelectedTeamId,
} from "./shared.js";
import { processPendingTeamMutations } from "./actions.js";
import { classifySyncError } from "../sync-error.js";
import { handleSyncFailure } from "../sync-recovery.js";

export async function loadUserTeams(render) {
  const syncVersionAtStart = state.teamSyncVersion;
  const storedTeamRecords = splitStoredTeamRecords();
  const storedActiveTeams = storedTeamRecords.activeTeams;
  const storedDeletedTeams = storedTeamRecords.deletedTeams;
  state.pendingTeamMutations = loadStoredTeamPendingMutations();
  const storedSnapshot = {
    items: storedActiveTeams,
    deletedItems: storedDeletedTeams,
  };
  const optimisticSnapshot = applyPendingMutations(
    storedSnapshot,
    state.pendingTeamMutations,
    applyTeamPendingMutation,
  );

  if (!state.auth.session?.sessionToken) {
    applyTeamSnapshotToState(optimisticSnapshot);
    state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, optimisticSnapshot.items);
    state.orgDiscovery = { status: "idle", error: "" };
    render();
    return;
  }

  if (state.offline.isEnabled) {
    applyTeamSnapshotToState(optimisticSnapshot);
    state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, optimisticSnapshot.items);
    state.orgDiscovery = { status: "ready", error: "" };
    render();
    return;
  }

  applyTeamSnapshotToState(optimisticSnapshot);
  state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, optimisticSnapshot.items);
  beginPageSync();
  state.orgDiscovery = { status: "loading", error: "" };
  render();

  try {
    const existingTeamRecords = [...storedActiveTeams, ...storedDeletedTeams];
    const installations = await invoke("list_accessible_github_app_installations", {
      sessionToken: requireBrokerSession(),
    });
    const installationList = Array.isArray(installations) ? installations : [];
    const storedTeamsByInstallationId = new Map(
      existingTeamRecords
        .filter((team) => Number.isFinite(team.installationId))
        .map((team) => [team.installationId, team]),
    );
    const reconciledTeams = [
      ...installationList.map((installation) => {
        const storedTeam = storedTeamsByInstallationId.get(installation.installationId);
        return storedTeam
          ? reconcileStoredTeam(storedTeam, installation)
          : buildTeamRecordFromInstallation(installation);
      }),
    ];

    if (syncVersionAtStart !== state.teamSyncVersion) {
      await completePageSync(render);
      return;
    }

    const nextStoredTeams = replaceStoredTeamRecords(reconciledTeams.filter(Boolean));
    const nextStoredSnapshot = splitStoredTeamRecords(nextStoredTeams);
    const nextSnapshot = applyPendingMutations(
      {
        items: nextStoredSnapshot.activeTeams,
        deletedItems: nextStoredSnapshot.deletedTeams,
      },
      state.pendingTeamMutations,
      applyTeamPendingMutation,
    );
    applyTeamSnapshotToState(nextSnapshot);
    saveStoredTeamRecords([...state.teams, ...state.deletedTeams]);
    state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, state.teams);
    state.orgDiscovery = { status: "ready", error: "" };
    await completePageSync(render);
    if (state.pendingTeamMutations.length > 0) {
      void processPendingTeamMutations(render);
    }
  } catch (error) {
    if (await handleSyncFailure(classifySyncError(error), { render })) {
      failPageSync();
      return;
    }
    if (syncVersionAtStart !== state.teamSyncVersion) {
      failPageSync();
      render();
      return;
    }
    applyTeamSnapshotToState(optimisticSnapshot);
    state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, optimisticSnapshot.items);
    state.orgDiscovery = {
      status: "error",
      error: error?.message ?? String(error),
    };
    failPageSync();
    render();
  }
}
