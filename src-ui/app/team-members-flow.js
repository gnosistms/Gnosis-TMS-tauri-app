import { invoke, waitForNextPaint } from "./runtime.js";
import { requireBrokerSession } from "./auth-flow.js";
import { loadStoredMembersForTeam, saveStoredMembersForTeam } from "./member-cache.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import { clearScopedSyncBadge, showNoticeBadge, showScopedSyncBadge } from "./status-feedback.js";
import {
  resetTeamMemberOwnerPromotion,
  resetTeamMemberOwnerDemotion,
  resetTeamMemberRemoval,
  state,
} from "./state.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";
import { loadUserTeams } from "./team-flow/sync.js";
import { countOwners, isOwnerRole } from "./team-member-permissions.js";
import {
  buildFallbackMembers,
  memberRoleToWireRole,
  MIN_OWNER_COUNT_MESSAGE,
  normalizeOrganizationMemberRole,
  ownerCountAfterRoleChange,
  OWNER_SELF_ROLE_CHANGE_MESSAGE,
} from "./member-shared.js";
import {
  createMembersQueryOptions,
  ensureMembersQueryObserver,
  invalidateMembersQueryAfterMutation,
  removeMemberFromQueryData,
  seedMembersQueryFromCache,
  patchMemberQueryData,
} from "./member-query.js";
import { memberKeys, queryClient } from "./query-client.js";
import {
  memberOwnerPromotionIntentKey,
  memberRemovalIntentKey,
  memberRoleIntentKey,
  memberUserWriteScope,
  requestMemberWriteIntent,
} from "./member-write-coordinator.js";

function getSelectedTeam(teamId = state.selectedTeamId) {
  return state.teams.find((team) => team.id === teamId);
}

function teamHasInstallation(selectedTeam) {
  return Number.isFinite(selectedTeam?.installationId);
}

function persistTeamUsers(selectedTeam, users, options = {}) {
  if (options.updateVisibleState !== false) {
    state.users = users;
  }
  if (selectedTeam) {
    saveStoredMembersForTeam(selectedTeam, users);
  }
}

function setUsersUnavailable(message) {
  state.users = [];
  state.userDiscovery = {
    status: "error",
    error: message,
  };
}

function snapshotUsers(users = []) {
  return users.map((user) => ({ ...user }));
}

function updateLocalMemberRole(users = [], username, role, options = {}) {
  const nextRole = normalizeOrganizationMemberRole(role);
  const roleSyncPending = options.pending === true;
  let didUpdate = false;
  const nextUsers = users.map((user) => {
    if (user?.username !== username) {
      return user;
    }

    didUpdate = true;
    return {
      ...user,
      role: nextRole,
      roleSyncPending,
      pendingMutation: roleSyncPending ? "updateRole" : null,
      pendingError: "",
    };
  });

  return {
    didUpdate,
    users: nextUsers,
  };
}

function confirmationMatchesUsername(value, username) {
  return String(value ?? "").trim().replace(/^@/, "").toLowerCase()
    === String(username ?? "").trim().replace(/^@/, "").toLowerCase();
}

function shouldUpdateVisibleUsers(teamId) {
  return typeof teamId === "string" && teamId && state.selectedTeamId === teamId;
}

export function showMembersStatus(render, text) {
  const normalizedText = String(text ?? "").trim();
  if (!normalizedText) {
    return;
  }
  showScopedSyncBadge("members", normalizedText, render);
}

export function clearMembersStatus(render) {
  clearScopedSyncBadge("members", render);
}

export function showMembersNotice(render, text, durationMs) {
  showNoticeBadge(text, render, durationMs);
}

function initializeUsersFromCachedState(selectedTeam) {
  if (state.offline.isEnabled) {
    setUsersUnavailable("Members are unavailable in offline mode.");
    return null;
  }

  if (!teamHasInstallation(selectedTeam)) {
    state.users = [];
    state.userDiscovery = { status: "ready", error: "" };
    return null;
  }

  const cachedMembers = loadStoredMembersForTeam(selectedTeam);
  if (cachedMembers.exists) {
    state.users = cachedMembers.members;
    state.userDiscovery = { status: "ready", error: "" };
  } else {
    state.users = buildFallbackMembers();
    state.userDiscovery = { status: "loading", error: "" };
  }

  return cachedMembers;
}

export function primeUsersForTeam(teamId = state.selectedTeamId) {
  const selectedTeam = getSelectedTeam(teamId);
  initializeUsersFromCachedState(selectedTeam);
}

export async function makeOrganizationAdmin(render, username) {
  await updateOrganizationMemberRole(render, username, "Admin");
}

export async function revokeOrganizationAdmin(render, username) {
  await updateOrganizationMemberRole(render, username, "Translator");
}

export function updateTeamMemberOwnerDemotionConfirmation(render, confirmationText) {
  state.teamMemberOwnerDemotion.confirmationText = confirmationText;
  state.teamMemberOwnerDemotion.error = "";
  render();
}

export function updateTeamMemberRemovalConfirmation(render, confirmationText) {
  state.teamMemberRemoval.confirmationText = confirmationText;
  state.teamMemberRemoval.error = "";
  render();
}

export function cancelTeamMemberOwnerDemotion(render) {
  resetTeamMemberOwnerDemotion();
  render();
}

export function updateOrganizationMemberRole(render, username, nextRoleValue) {
  const selectedTeam = getSelectedTeam();
  const member = state.users.find((user) => user?.username === username);
  const nextRole = normalizeOrganizationMemberRole(nextRoleValue);
  if (!teamHasInstallation(selectedTeam) || selectedTeam.canDelete !== true || !member) {
    return;
  }

  const currentRole = normalizeOrganizationMemberRole(member.role);
  if (currentRole === nextRole) {
    render();
    return;
  }

  if (member.isCurrentUser) {
    showMembersNotice(render, OWNER_SELF_ROLE_CHANGE_MESSAGE, 3200);
    return;
  }

  if (isOwnerRole(member) && nextRole !== "Owner") {
    if (ownerCountAfterRoleChange(state.users, username, nextRole) < 1) {
      showMembersNotice(render, MIN_OWNER_COUNT_MESSAGE, 3200);
      return;
    }
    openTeamMemberOwnerDemotion(render, username, nextRole);
    return;
  }

  if (nextRole === "Owner") {
    openTeamMemberOwnerPromotion(render, username);
    return;
  }

  return updateOrganizationMemberRoleViaBroker(render, username, nextRole);
}

export function openTeamMemberOwnerPromotion(render, username) {
  const selectedTeam = getSelectedTeam();
  const member = state.users.find((user) => user?.username === username);
  if (
    !teamHasInstallation(selectedTeam) ||
    selectedTeam.canDelete !== true ||
    !member ||
    member.isCurrentUser ||
    isOwnerRole(member)
  ) {
    return;
  }

  state.teamMemberOwnerPromotion = {
    isOpen: true,
    status: "idle",
    error: "",
    teamId: selectedTeam.id,
    teamName: selectedTeam.name || selectedTeam.githubOrg,
    username: member.username,
    memberName: member.name || member.username,
  };
  render();
}

export function cancelTeamMemberOwnerPromotion(render) {
  resetTeamMemberOwnerPromotion();
  render();
}

export function openTeamMemberOwnerDemotion(render, username, targetRole) {
  const selectedTeam = getSelectedTeam();
  const member = state.users.find((user) => user?.username === username);
  const nextRole = normalizeOrganizationMemberRole(targetRole);
  if (
    !teamHasInstallation(selectedTeam) ||
    selectedTeam.canDelete !== true ||
    !member ||
    member.isCurrentUser ||
    !isOwnerRole(member) ||
    nextRole === "Owner"
  ) {
    return;
  }

  if (ownerCountAfterRoleChange(state.users, username, nextRole) < 1) {
    showMembersNotice(render, MIN_OWNER_COUNT_MESSAGE, 3200);
    return;
  }

  state.teamMemberOwnerDemotion = {
    isOpen: true,
    status: "idle",
    error: "",
    teamId: selectedTeam.id,
    teamName: selectedTeam.name || selectedTeam.githubOrg,
    username: member.username,
    memberName: member.name || member.username,
    targetRole: nextRole,
    confirmationText: "",
  };
  render();
}

export async function confirmTeamMemberOwnerDemotion(render) {
  const selectedTeam = getSelectedTeam();
  const demotion = state.teamMemberOwnerDemotion;
  const username = String(demotion?.username ?? "").trim();
  const targetRole = normalizeOrganizationMemberRole(demotion?.targetRole);
  if (!teamHasInstallation(selectedTeam) || selectedTeam.id !== demotion?.teamId || !username) {
    resetTeamMemberOwnerDemotion();
    render();
    return;
  }

  const member = state.users.find((user) => user?.username === username);
  if (!member || member.isCurrentUser || !isOwnerRole(member) || targetRole === "Owner") {
    resetTeamMemberOwnerDemotion();
    render();
    return;
  }

  if (ownerCountAfterRoleChange(state.users, username, targetRole) < 1) {
    state.teamMemberOwnerDemotion.error = MIN_OWNER_COUNT_MESSAGE;
    render();
    return;
  }

  if (!confirmationMatchesUsername(demotion.confirmationText, username)) {
    state.teamMemberOwnerDemotion.error = `Type ${username} to confirm this role change.`;
    render();
    return;
  }

  state.teamMemberOwnerDemotion.status = "loading";
  state.teamMemberOwnerDemotion.error = "";
  render();
  await updateOrganizationMemberRoleViaBroker(render, username, targetRole, {
    confirmationUsername: demotion.confirmationText,
    ownerDemotion: {
      ...demotion,
      targetRole,
    },
  });
}

export async function confirmTeamMemberOwnerPromotion(render) {
  const selectedTeam = getSelectedTeam();
  const promotion = state.teamMemberOwnerPromotion;
  const username = String(promotion?.username ?? "").trim();
  if (!teamHasInstallation(selectedTeam) || selectedTeam.id !== promotion?.teamId || !username) {
    resetTeamMemberOwnerPromotion();
    render();
    return;
  }

  if (selectedTeam.canDelete !== true) {
    state.teamMemberOwnerPromotion.error = "Only the team owner can promote another owner.";
    render();
    return;
  }

  const member = state.users.find((user) => user?.username === username);
  if (!member || member.isCurrentUser || isOwnerRole(member)) {
    resetTeamMemberOwnerPromotion();
    render();
    return;
  }

  const selectedTeamIdAtStart = selectedTeam.id;
  const previousUsers = snapshotUsers(state.users);

  return new Promise((resolve) => {
    requestMemberWriteIntent({
      key: memberOwnerPromotionIntentKey(selectedTeam.id, username),
      scope: memberUserWriteScope(selectedTeam, username),
      teamId: selectedTeam.id,
      username,
      type: "memberOwnerPromotion",
      previousValue: { users: previousUsers, member },
      value: { username },
    }, {
      clearOnSuccess: true,
      applyOptimistic: () => {
        beginPageSync();
        resetTeamMemberOwnerPromotion();
        const nextUsers = state.users.map((user) =>
          user?.username === username
            ? {
                ...user,
                role: "Owner",
                pendingMutation: "promoteOwner",
                pendingError: "",
              }
            : user,
        );
        queryClient.setQueryData(
          memberKeys.byTeam(selectedTeam.id),
          (queryData) => patchMemberQueryData(queryData, username, {
            role: "Owner",
            pendingMutation: "promoteOwner",
            pendingError: "",
          }),
        );
        persistTeamUsers(selectedTeam, nextUsers);
        showMembersStatus(render, "Promoting team owner...");
        render();
      },
      run: async () => {
        await waitForNextPaint();
        await invoke("promote_organization_owner_for_installation", {
          installationId: selectedTeam.installationId,
          orgLogin: selectedTeam.githubOrg,
          username,
          sessionToken: requireBrokerSession(),
        });
      },
      onSuccess: async () => {
        try {
          showMembersStatus(render, "Refreshing team access...");
          await loadUserTeams(render);
          if (shouldUpdateVisibleUsers(selectedTeamIdAtStart) && getSelectedTeam(selectedTeamIdAtStart)) {
            showMembersStatus(render, "Refreshing member list...");
            await invalidateMembersQueryAfterMutation(selectedTeam, {
              teamId: selectedTeamIdAtStart,
              render,
            });
          }
          clearMembersStatus(render);
          await completePageSync(render);
          showMembersNotice(render, "Team owner promoted.");
        } finally {
          render();
          resolve();
        }
      },
      onError: async (error) => {
        persistTeamUsers(selectedTeam, previousUsers, {
          updateVisibleState: shouldUpdateVisibleUsers(selectedTeamIdAtStart),
        });
        queryClient.setQueryData(memberKeys.byTeam(selectedTeam.id), (queryData) => ({
          ...(queryData ?? {}),
          members: previousUsers,
        }));
        clearMembersStatus(render);
        if (await handleSyncFailure(classifySyncError(error), { render })) {
          failPageSync();
          render();
          resolve();
          return;
        }
        failPageSync();
        state.teamMemberOwnerPromotion = {
          isOpen: true,
          status: "idle",
          error: error?.message ?? String(error),
          teamId: selectedTeam.id,
          teamName: selectedTeam.name || selectedTeam.githubOrg,
          username: member.username,
          memberName: member.name || member.username,
        };
        render();
        resolve();
      },
    });
  });
}

export function openTeamMemberRemoval(render, username) {
  const selectedTeam = getSelectedTeam();
  const member = state.users.find((user) => user?.username === username);
  if (!selectedTeam || !member || member.isCurrentUser) {
    return;
  }

  const ownerRemoval = isOwnerRole(member);
  if (ownerRemoval && selectedTeam.canDelete !== true) {
    return;
  }

  if (ownerRemoval && countOwners(state.users) <= 1) {
    showMembersNotice(render, MIN_OWNER_COUNT_MESSAGE, 3200);
    return;
  }

  state.teamMemberRemoval = {
    isOpen: true,
    status: "idle",
    error: "",
    teamId: selectedTeam.id,
    teamName: selectedTeam.name || selectedTeam.githubOrg,
    username: member.username,
    memberName: member.name || member.username,
    requiresConfirmation: ownerRemoval,
    confirmationText: "",
  };
  render();
}

export function cancelTeamMemberRemoval(render) {
  resetTeamMemberRemoval();
  render();
}

export async function confirmTeamMemberRemoval(render) {
  const selectedTeam = getSelectedTeam();
  const removal = state.teamMemberRemoval;
  const username = String(removal?.username ?? "").trim();
  if (!teamHasInstallation(selectedTeam) || !username) {
    resetTeamMemberRemoval();
    render();
    return;
  }

  if (selectedTeam.canManageMembers !== true) {
    state.teamMemberRemoval.error = "Only the team owner can remove members.";
    render();
    return;
  }

  const member = state.users.find((user) => user?.username === username);
  if (!member || member.isCurrentUser) {
    resetTeamMemberRemoval();
    render();
    return;
  }

  const ownerRemoval = isOwnerRole(member);
  if (ownerRemoval && selectedTeam.canDelete !== true) {
    state.teamMemberRemoval.error = "Only the team owner can remove another owner.";
    render();
    return;
  }

  if (ownerRemoval && countOwners(state.users) <= 1) {
    state.teamMemberRemoval.error = MIN_OWNER_COUNT_MESSAGE;
    render();
    return;
  }

  if (ownerRemoval && !confirmationMatchesUsername(removal.confirmationText, username)) {
    state.teamMemberRemoval.error = `Type ${username} to confirm removal.`;
    render();
    return;
  }

  const previousUsers = snapshotUsers(state.users);

  return new Promise((resolve) => {
    requestMemberWriteIntent({
      key: memberRemovalIntentKey(selectedTeam.id, username),
      scope: memberUserWriteScope(selectedTeam, username),
      teamId: selectedTeam.id,
      username,
      type: "memberRemoval",
      previousValue: { users: previousUsers, member },
      value: { username },
    }, {
      clearOnSuccess: true,
      applyOptimistic: () => {
        beginPageSync();
        resetTeamMemberRemoval();
        const nextUsers = previousUsers.filter((user) => user?.username !== username);
        queryClient.setQueryData(
          memberKeys.byTeam(selectedTeam.id),
          (queryData) => removeMemberFromQueryData(queryData, username),
        );
        persistTeamUsers(selectedTeam, nextUsers);
        showMembersStatus(render, "Removing member...");
        render();
      },
      run: async () => {
        await waitForNextPaint();
        await invoke("remove_organization_member_for_installation", {
          installationId: selectedTeam.installationId,
          orgLogin: selectedTeam.githubOrg,
          username,
          confirmationUsername: ownerRemoval ? removal.confirmationText : null,
          sessionToken: requireBrokerSession(),
        });
      },
      onSuccess: async () => {
        try {
          showMembersStatus(render, "Refreshing member list...");
          await invalidateMembersQueryAfterMutation(selectedTeam, {
            teamId: selectedTeam.id,
            render,
          });
          clearMembersStatus(render);
          await completePageSync(render);
          showMembersNotice(render, "Member removed.");
        } finally {
          render();
          resolve();
        }
      },
      onError: async (error) => {
        persistTeamUsers(selectedTeam, previousUsers);
        queryClient.setQueryData(memberKeys.byTeam(selectedTeam.id), (queryData) => ({
          ...(queryData ?? {}),
          members: previousUsers,
        }));
        clearMembersStatus(render);
        if (await handleSyncFailure(classifySyncError(error), { render })) {
          failPageSync();
          render();
          resolve();
          return;
        }
        failPageSync();
        state.teamMemberRemoval = {
          isOpen: true,
          status: "idle",
          error: error?.message ?? String(error),
          teamId: selectedTeam.id,
          teamName: selectedTeam.name || selectedTeam.githubOrg,
          username: member.username,
          memberName: member.name || member.username,
          requiresConfirmation: ownerRemoval,
          confirmationText: removal.confirmationText ?? "",
        };
        render();
        resolve();
      },
    });
  });
}

async function updateOrganizationMemberRoleViaBroker(render, username, nextRoleValue, options = {}) {
  const selectedTeam = getSelectedTeam();
  if (!teamHasInstallation(selectedTeam)) {
    return;
  }
  const selectedTeamIdAtStart = selectedTeam.id;

  if (selectedTeam.canDelete !== true) {
    state.userDiscovery = {
      status: "error",
      error: "Only the team owner can change member roles.",
    };
    render();
    return;
  }

  const nextRole = normalizeOrganizationMemberRole(nextRoleValue);
  const previousUsers = snapshotUsers(state.users);
  const ownerDemotion = options.ownerDemotion ?? null;

  return new Promise((resolve) => {
    requestMemberWriteIntent({
      key: memberRoleIntentKey(selectedTeam.id, username),
      scope: memberUserWriteScope(selectedTeam, username),
      teamId: selectedTeam.id,
      username,
      type: "memberRole",
      previousValue: { users: previousUsers },
      value: {
        username,
        role: nextRole,
      },
    }, {
      applyOptimistic: () => {
        const optimisticUsers = updateLocalMemberRole(previousUsers, username, nextRole, {
          pending: true,
        });
        beginPageSync();
        resetTeamMemberOwnerDemotion();
        if (optimisticUsers.didUpdate) {
          queryClient.setQueryData(
            memberKeys.byTeam(selectedTeam.id),
            (queryData) => patchMemberQueryData(queryData, username, {
              role: nextRole,
              pendingMutation: "updateRole",
              pendingError: "",
              roleSyncPending: true,
            }),
          );
          persistTeamUsers(selectedTeam, optimisticUsers.users);
        }
        state.userDiscovery = { status: "ready", error: "" };
        showMembersStatus(render, "Updating member role...");
        render();
      },
      run: async () => {
        await waitForNextPaint();
        await invoke("set_organization_member_role_for_installation", {
          installationId: selectedTeam.installationId,
          orgLogin: selectedTeam.githubOrg,
          username,
          role: memberRoleToWireRole(nextRole),
          confirmationUsername: options.confirmationUsername ?? null,
          sessionToken: requireBrokerSession(),
        });
      },
      onSuccess: async () => {
        try {
          const optimisticUsers = updateLocalMemberRole(state.users, username, nextRole, {
            pending: true,
          });
          persistTeamUsers(selectedTeam, optimisticUsers.users, {
            updateVisibleState: shouldUpdateVisibleUsers(selectedTeamIdAtStart),
          });
          queryClient.setQueryData(
            memberKeys.byTeam(selectedTeam.id),
            (queryData) => patchMemberQueryData(queryData, username, {
              role: nextRole,
              pendingMutation: "updateRole",
              pendingError: "",
              roleSyncPending: true,
            }),
          );
          showMembersStatus(render, "Refreshing team access...");
          await loadUserTeams(render);
          if (shouldUpdateVisibleUsers(selectedTeamIdAtStart) && getSelectedTeam(selectedTeamIdAtStart)) {
            showMembersStatus(render, "Refreshing member list...");
            await invalidateMembersQueryAfterMutation(selectedTeam, {
              teamId: selectedTeamIdAtStart,
              render,
            });
          }
          clearMembersStatus(render);
          await completePageSync(render);
          showMembersNotice(render, "Member role updated.");
        } catch (error) {
          failPageSync();
          showNoticeBadge(error?.message ?? String(error), render, 2600);
        } finally {
          render();
          resolve();
        }
      },
      onError: async (error) => {
        persistTeamUsers(selectedTeam, previousUsers, {
          updateVisibleState: shouldUpdateVisibleUsers(selectedTeamIdAtStart),
        });
        queryClient.setQueryData(memberKeys.byTeam(selectedTeam.id), (queryData) => ({
          ...(queryData ?? {}),
          members: previousUsers,
        }));
        clearMembersStatus(render);
        if (await handleSyncFailure(classifySyncError(error), { render })) {
          failPageSync();
          resolve();
          return;
        }
        failPageSync();
        if (ownerDemotion) {
          state.teamMemberOwnerDemotion = {
            ...ownerDemotion,
            isOpen: true,
            status: "idle",
            error: error?.message ?? String(error),
          };
        } else {
          showNoticeBadge(`Could not update @${username}'s role.`, render, 2600);
        }
        render();
        resolve();
      },
    });
  });
}

export async function loadTeamUsers(render, teamId = state.selectedTeamId) {
  const selectedTeam = getSelectedTeam(teamId);
  const cachedMembers = initializeUsersFromCachedState(selectedTeam);
  const shouldSync = teamHasInstallation(selectedTeam) && !state.offline.isEnabled;
  if (shouldSync) {
    beginPageSync();
    showMembersStatus(render, cachedMembers?.exists ? "Refreshing member list..." : "Loading members...");
  }
  render();

  if (!shouldSync) {
    return;
  }

  try {
    if (cachedMembers?.exists) {
      seedMembersQueryFromCache(selectedTeam, { teamId, render });
    }
    ensureMembersQueryObserver(render, selectedTeam, { teamId, render });
    const querySnapshot = await queryClient.fetchQuery(
      createMembersQueryOptions(selectedTeam, { teamId, render }),
    );
    queryClient.setQueryData(memberKeys.byTeam(teamId), querySnapshot);
    clearMembersStatus(render);
    await completePageSync(render);
  } catch (error) {
    const errorMessage = error?.message ?? String(error);
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

    if (!cachedMembers?.exists) {
      setUsersUnavailable(errorMessage);
    } else {
      state.userDiscovery = { status: "ready", error: "" };
    }
    clearMembersStatus(render);
    failPageSync();
    render();
  }
}
