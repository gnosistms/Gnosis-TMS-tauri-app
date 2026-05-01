import { requireBrokerSession } from "../auth-flow.js";
import { removeStoredGlossariesForTeam } from "../glossary-cache.js";
import { removeStoredProjectDataForTeam } from "../project-cache.js";
import { invoke, waitForNextPaint } from "../runtime.js";
import {
  resetTeamLeave,
  resetTeamPermanentDeletion,
  resetTeamRename,
  state,
} from "../state.js";
import {
  removeStoredTeamRecord,
  replaceStoredTeamRecords,
  saveStoredTeamRecords,
  saveStoredTeamPendingMutations,
  updateStoredGithubAppTeam,
} from "../team-storage.js";
import {
  addDeletedMarkerToDescription,
  applyTeamPendingMutation,
  applyTeamSnapshotToState,
  applyStoredTeamRecords,
  removeDeletedMarkerFromDescription,
  resolveNextSelectedTeamId,
} from "./shared.js";
import {
  removePendingMutation,
  upsertPendingMutation,
} from "../optimistic-collection.js";
import { clearScopedSyncBadge, showScopedSyncBadge } from "../status-feedback.js";
import { classifySyncError } from "../sync-error.js";
import { handleSyncFailure } from "../sync-recovery.js";
import { canCurrentUserLeaveTeam } from "../team-member-permissions.js";
import { loadUserTeams } from "./sync.js";
import { normalizedConfirmationValue } from "../resource-entity-modal.js";
import {
  invalidateTeamsQueryAfterMutation,
  moveTeamQueryData,
  patchTeamQueryData,
} from "../team-query.js";
import { queryClient, teamKeys } from "../query-client.js";
import {
  requestTeamWriteIntent,
  teamLifecycleIntentKey,
  teamRenameIntentKey,
  teamWriteScope,
} from "../team-write-coordinator.js";

function setTeamUiDebug(render, text) {
  showScopedSyncBadge("teams", text, render);
}

function clearTeamUiDebug(render) {
  clearScopedSyncBadge("teams", render);
}

function currentAuthLogin() {
  const login = state.auth.session?.login;
  return typeof login === "string" && login.trim() ? login.trim().toLowerCase() : null;
}

function snapshotTeams() {
  return {
    teams: state.teams.map((team) => ({ ...team })),
    deletedTeams: state.deletedTeams.map((team) => ({ ...team })),
    selectedTeamId: state.selectedTeamId,
  };
}

function restoreTeamSnapshot(snapshot) {
  state.teams = snapshot.teams.map((team) => ({ ...team }));
  state.deletedTeams = snapshot.deletedTeams.map((team) => ({ ...team }));
  state.selectedTeamId = snapshot.selectedTeamId;
}

function persistVisibleTeamSnapshot() {
  saveStoredTeamRecords([...state.teams, ...state.deletedTeams]);
}

function canLeaveTeamFromCurrentState(team) {
  if (team?.canDelete === true && state.selectedTeamId !== team.id) {
    return false;
  }

  return canCurrentUserLeaveTeam(team, state.users, { offline: state.offline?.isEnabled === true });
}

function applyOptimisticTeamMutation(render, mutation, debugText) {
  state.teamSyncVersion += 1;
  const snapshot = applyTeamPendingMutation(
    { items: state.teams, deletedItems: state.deletedTeams },
    mutation,
  );
  applyTeamSnapshotToState(snapshot);
  state.pendingTeamMutations = upsertPendingMutation(state.pendingTeamMutations, mutation);
  state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, state.teams);
  render();
  if (debugText) {
    setTeamUiDebug(render, debugText);
  }
}

function persistOptimisticTeamSnapshot() {
  saveStoredTeamRecords([...state.teams, ...state.deletedTeams]);
  saveStoredTeamPendingMutations(state.pendingTeamMutations);
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

  const previousSnapshot = snapshotTeams();
  const authLogin = currentAuthLogin();
  return new Promise((resolve) => {
    requestTeamWriteIntent({
      key: teamRenameIntentKey(team.id),
      scope: teamWriteScope(team),
      teamId: team.id,
      type: "teamRename",
      previousValue: { name: team.name || team.githubOrg },
      value: { name: nextName },
    }, {
      applyOptimistic: () => {
        state.teamRename.status = "loading";
        state.teamRename.error = "";
        const nextSnapshot = applyTeamPendingMutation(
          { items: state.teams, deletedItems: state.deletedTeams },
          {
            id: `rename-${team.id}`,
            type: "rename",
            teamId: team.id,
            name: nextName,
          },
        );
        applyTeamSnapshotToState({
          items: nextSnapshot.items.map((item) =>
            item.id === team.id ? { ...item, pendingMutation: "rename", pendingError: "" } : item,
          ),
          deletedItems: nextSnapshot.deletedItems,
        });
        queryClient.setQueryData(
          teamKeys.currentUser(authLogin),
          (queryData) => patchTeamQueryData(queryData, team.id, {
            name: nextName,
            pendingMutation: "rename",
            pendingError: "",
          }),
        );
        persistVisibleTeamSnapshot();
        resetTeamRename();
        setTeamUiDebug(render, "Renaming team...");
        render();
      },
      run: async () => {
        await waitForNextPaint();
        await invoke("update_organization_name_for_installation", {
          installationId: team.installationId,
          orgLogin: team.githubOrg,
          name: nextName,
          sessionToken: requireBrokerSession(),
        });
      },
      onSuccess: async () => {
        try {
          setTeamUiDebug(render, "Refreshing teams...");
          await invalidateTeamsQueryAfterMutation({ authLogin, render });
          clearTeamUiDebug(render);
        } finally {
          render();
          resolve();
        }
      },
      onError: async (error) => {
        restoreTeamSnapshot(previousSnapshot);
        persistVisibleTeamSnapshot();
        clearTeamUiDebug(render);
        if (await handleSyncFailure(classifySyncError(error), { render })) {
          render();
          resolve();
          return;
        }
        state.teamRename = {
          isOpen: true,
          teamId: team.id,
          teamName: nextName,
          status: "idle",
          error: error?.message ?? String(error),
        };
        render();
        resolve();
      },
    });
  });
}

export function deleteTeam(render, teamId) {
  const team = state.teams.find((item) => item.id === teamId);
  if (!team) {
    return;
  }

  if (!team.canDelete) {
    openTeamLeave(render, teamId);
    return;
  }

  const previousSnapshot = snapshotTeams();
  const deletedAt = new Date().toISOString();
  const authLogin = currentAuthLogin();
  requestTeamWriteIntent({
    key: teamLifecycleIntentKey(team.id),
    scope: teamWriteScope(team),
    teamId: team.id,
    type: "teamLifecycle",
    previousValue: { lifecycleState: "active" },
    value: { lifecycleState: "deleted", deletedAt },
  }, {
    applyOptimistic: () => {
      const mutation = {
        id: `soft-delete-${team.id}`,
        type: "softDelete",
        teamId: team.id,
        deletedAt,
      };
      const snapshot = applyTeamPendingMutation(
        { items: state.teams, deletedItems: state.deletedTeams },
        mutation,
      );
      applyTeamSnapshotToState({
        items: snapshot.items,
        deletedItems: snapshot.deletedItems.map((item) =>
          item.id === team.id ? { ...item, pendingMutation: "softDelete", pendingError: "" } : item,
        ),
      });
      state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, state.teams);
      queryClient.setQueryData(
        teamKeys.currentUser(authLogin),
        (queryData) => moveTeamQueryData(queryData, team.id, "deleted", {
          description: addDeletedMarkerToDescription(team.description),
          isDeleted: true,
          deletedAt,
          syncState: "deleted",
          statusLabel: "Removed from active teams",
          pendingMutation: "softDelete",
          pendingError: "",
        }),
      );
      persistVisibleTeamSnapshot();
      setTeamUiDebug(render, "Deleting team...");
      render();
    },
    run: async () => {
      await waitForNextPaint();
      await persistTeamDeletedState({ team, isDeleted: true });
    },
    onSuccess: async () => {
      try {
        setTeamUiDebug(render, "Refreshing teams...");
        await invalidateTeamsQueryAfterMutation({ authLogin, render });
        clearTeamUiDebug(render);
      } finally {
        render();
      }
    },
    onError: async (error) => {
      restoreTeamSnapshot(previousSnapshot);
      persistVisibleTeamSnapshot();
      clearTeamUiDebug(render);
      if (await handleSyncFailure(classifySyncError(error), { render })) {
        render();
        return;
      }
      state.orgDiscovery = {
        status: "error",
        error: error?.message ?? String(error),
      };
      render();
    },
  });
}

export function restoreTeam(render, teamId) {
  const team = state.deletedTeams.find((item) => item.id === teamId);
  if (!team) {
    return;
  }

  const previousSnapshot = snapshotTeams();
  const authLogin = currentAuthLogin();
  requestTeamWriteIntent({
    key: teamLifecycleIntentKey(team.id),
    scope: teamWriteScope(team),
    teamId: team.id,
    type: "teamLifecycle",
    previousValue: { lifecycleState: "deleted" },
    value: { lifecycleState: "active", deletedAt: team.deletedAt ?? new Date().toISOString() },
  }, {
    applyOptimistic: () => {
      const mutation = {
        id: `restore-${team.id}`,
        type: "restore",
        teamId: team.id,
        deletedAt: team.deletedAt ?? new Date().toISOString(),
      };
      const snapshot = applyTeamPendingMutation(
        { items: state.teams, deletedItems: state.deletedTeams },
        mutation,
      );
      applyTeamSnapshotToState({
        items: snapshot.items.map((item) =>
          item.id === team.id ? { ...item, pendingMutation: "restore", pendingError: "" } : item,
        ),
        deletedItems: snapshot.deletedItems,
      });
      state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, state.teams);
      queryClient.setQueryData(
        teamKeys.currentUser(authLogin),
        (queryData) => moveTeamQueryData(queryData, team.id, "active", {
          description: removeDeletedMarkerFromDescription(team.description),
          isDeleted: false,
          deletedAt: null,
          syncState: "active",
          statusLabel: "",
          pendingMutation: "restore",
          pendingError: "",
        }),
      );
      persistVisibleTeamSnapshot();
      setTeamUiDebug(render, "Restoring team...");
      render();
    },
    run: async () => {
      await waitForNextPaint();
      await persistTeamDeletedState({ team, isDeleted: false });
    },
    onSuccess: async () => {
      try {
        setTeamUiDebug(render, "Refreshing teams...");
        await invalidateTeamsQueryAfterMutation({ authLogin, render });
        clearTeamUiDebug(render);
      } finally {
        render();
      }
    },
    onError: async (error) => {
      restoreTeamSnapshot(previousSnapshot);
      persistVisibleTeamSnapshot();
      clearTeamUiDebug(render);
      if (await handleSyncFailure(classifySyncError(error), { render })) {
        render();
        return;
      }
      state.orgDiscovery = {
        status: "error",
        error: error?.message ?? String(error),
      };
      render();
    },
  });
}

export function openTeamPermanentDeletion(render, teamId) {
  const team = state.deletedTeams.find((item) => item.id === teamId);
  if (!team) {
    return;
  }

  state.teamPermanentDeletion = {
    isOpen: true,
    teamId,
    teamName: team.name || team.githubOrg,
    confirmationText: "",
    status: "idle",
    error: "",
  };
  render();
}

export function updateTeamPermanentDeletionConfirmation(value) {
  state.teamPermanentDeletion.confirmationText = value;
  if (state.teamPermanentDeletion.error) {
    state.teamPermanentDeletion.error = "";
  }
}

export function cancelTeamPermanentDeletion(render) {
  resetTeamPermanentDeletion();
  render();
}

export async function confirmTeamPermanentDeletion(render) {
  const deletion = state.teamPermanentDeletion;
  const team = state.deletedTeams.find((item) => item.id === deletion.teamId);
  if (!team) {
    resetTeamPermanentDeletion();
    render();
    return;
  }

  if (normalizedConfirmationValue(deletion.confirmationText) !== normalizedConfirmationValue(deletion.teamName)) {
    state.teamPermanentDeletion.error = "Team name confirmation does not match.";
    render();
    return;
  }

  try {
    state.teamPermanentDeletion.status = "loading";
    state.teamPermanentDeletion.error = "";
    render();
    await waitForNextPaint();
    if (!team.installationId) {
      throw new Error("Team deletion requires a GitHub App-connected team.");
    }
    await invoke("delete_organization_for_installation", {
      installationId: team.installationId,
      orgLogin: team.githubOrg,
      sessionToken: requireBrokerSession(),
    });
    await invoke("purge_local_installation_data", {
      installationId: team.installationId,
    });
    removeStoredProjectDataForTeam(team);
    removeStoredGlossariesForTeam(team);

    const nextStoredTeams = removeStoredTeamRecord(team.id);
    applyStoredTeamRecords(nextStoredTeams);
    state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, state.teams);
    await invalidateTeamsQueryAfterMutation({
      authLogin: currentAuthLogin(),
      render,
      refetchIfInactive: false,
    });
    resetTeamPermanentDeletion();
    render();
  } catch (error) {
    state.teamPermanentDeletion.status = "idle";
    if (await handleSyncFailure(classifySyncError(error), { render })) {
      render();
      return;
    }
    state.teamPermanentDeletion.error = error?.message ?? String(error);
    render();
  }
}

export function openTeamLeave(render, teamId) {
  setTeamUiDebug(render, "Leave clicked");
  const team = state.teams.find((item) => item.id === teamId);
  if (!team) {
    return;
  }

  if (!canLeaveTeamFromCurrentState(team)) {
    setTeamUiDebug(render, "This team needs at least two owners before you can leave.");
    return;
  }

  state.teamLeave = {
    isOpen: true,
    teamId,
    teamName: team.name || team.githubOrg,
    status: "idle",
    error: "",
  };
  render();
}

export function cancelTeamLeave(render) {
  resetTeamLeave();
  render();
}

export async function confirmTeamLeave(render) {
  const leave = state.teamLeave;
  const team = state.teams.find((item) => item.id === leave.teamId);
  if (!team?.installationId) {
    resetTeamLeave();
    render();
    return;
  }

  if (!canLeaveTeamFromCurrentState(team)) {
    state.teamLeave.status = "idle";
    state.teamLeave.error = "This team needs at least two owners before you can leave.";
    render();
    return;
  }

  try {
    state.teamLeave.status = "loading";
    state.teamLeave.error = "";
    render();
    await waitForNextPaint();
    await invoke("leave_organization_for_installation", {
      installationId: team.installationId,
      orgLogin: team.githubOrg,
      sessionToken: requireBrokerSession(),
    });
    const nextStoredTeams = removeStoredTeamRecord(team.id);
    applyStoredTeamRecords(nextStoredTeams);
    state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, state.teams);
    await invalidateTeamsQueryAfterMutation({
      authLogin: currentAuthLogin(),
      render,
      refetchIfInactive: false,
    });
    resetTeamLeave();
    render();
  } catch (error) {
    state.teamLeave.status = "idle";
    if (await handleSyncFailure(classifySyncError(error), { render })) {
      render();
      return;
    }
    state.teamLeave.error = error?.message ?? String(error);
    render();
  }
}

async function persistTeamDeletedState({
  team,
  isDeleted,
}) {
  const nextDescription = isDeleted
    ? addDeletedMarkerToDescription(team.description)
    : removeDeletedMarkerFromDescription(team.description);
  const organization = await invoke("update_organization_description_for_installation", {
    installationId: team.installationId,
    orgLogin: team.githubOrg,
    description: nextDescription,
    sessionToken: requireBrokerSession(),
  });
  return updateStoredGithubAppTeam(team.id, {
    description: organization.description ?? nextDescription,
    isDeleted,
    deletedAt: isDeleted ? new Date().toISOString() : null,
    syncState: isDeleted ? "deleted" : "active",
    statusLabel: isDeleted ? "Removed from active teams" : "",
  });
}

async function commitTeamMutation(mutation) {
  const team =
    state.teams.find((item) => item.id === mutation.teamId) ??
    state.deletedTeams.find((item) => item.id === mutation.teamId);

  if (!team?.installationId) {
    return;
  }

  if (mutation.type === "rename") {
    const organization = await invoke("update_organization_name_for_installation", {
      installationId: team.installationId,
      orgLogin: team.githubOrg,
      name: mutation.name,
      sessionToken: requireBrokerSession(),
    });
    updateStoredGithubAppTeam(team.id, {
      name: organization.name || organization.login || mutation.name,
    });
    return;
  }

  if (mutation.type === "softDelete") {
    await persistTeamDeletedState({
      team,
      isDeleted: true,
    });
    return;
  }

  if (mutation.type === "restore") {
    await persistTeamDeletedState({
      team,
      isDeleted: false,
    });
  }
}

function rollbackVisibleTeamMutation(mutation) {
  const inverseMutation =
    mutation.type === "rename"
      ? {
          id: `${mutation.id}-rollback`,
          type: "rename",
          teamId: mutation.teamId,
          name: mutation.previousName,
        }
      : mutation.type === "softDelete"
        ? {
            id: `${mutation.id}-rollback`,
            type: "restore",
            teamId: mutation.teamId,
          }
        : mutation.type === "restore"
          ? {
              id: `${mutation.id}-rollback`,
              type: "softDelete",
              teamId: mutation.teamId,
              deletedAt: mutation.deletedAt ?? new Date().toISOString(),
            }
          : null;

  if (!inverseMutation) {
    return;
  }

  const snapshot = applyTeamPendingMutation(
    { items: state.teams, deletedItems: state.deletedTeams },
    inverseMutation,
  );
  applyTeamSnapshotToState(snapshot);
  state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, state.teams);
}
