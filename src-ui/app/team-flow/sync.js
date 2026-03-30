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
  reconcileStoredTeam,
  resolveNextSelectedTeamId,
} from "./shared.js";
import { processPendingTeamMutations } from "./actions.js";
import { classifySyncError } from "../sync-error.js";
import { handleSyncFailure } from "../sync-recovery.js";

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
          const classification = classifySyncError(error);
          if (classification.type === "auth_invalid" || classification.type === "connection_unavailable") {
            throw error;
          }
          if (classification.type === "resource_access_lost") {
            return null;
          }
          return disconnectedTeam(storedTeam);
        }
      }),
    );

    if (syncVersionAtStart !== state.teamSyncVersion) {
      completePageSync(render);
      render();
      return;
    }

    const nextStoredTeams = replaceStoredTeamRecords(reconciledTeams.filter(Boolean));
    const nextSnapshot = applyPendingMutations(
      splitStoredTeamRecords(nextStoredTeams),
      state.pendingTeamMutations,
      applyTeamPendingMutation,
    );
    applyTeamSnapshotToState(nextSnapshot);
    saveStoredTeamRecords([...state.teams, ...state.deletedTeams]);
    state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, state.teams);
    state.orgDiscovery = { status: "ready", error: "" };
    completePageSync(render);

    render();
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
