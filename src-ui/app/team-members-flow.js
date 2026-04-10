import { invoke, waitForNextPaint } from "./runtime.js";
import { requireBrokerSession } from "./auth-flow.js";
import { loadStoredMembersForTeam, saveStoredMembersForTeam } from "./member-cache.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import { showNoticeBadge } from "./status-feedback.js";
import { resetTeamMemberRemoval, state } from "./state.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";

function getSelectedTeam(teamId = state.selectedTeamId) {
  return state.teams.find((team) => team.id === teamId);
}

function teamHasInstallation(selectedTeam) {
  return Number.isFinite(selectedTeam?.installationId);
}

function persistTeamUsers(selectedTeam, users) {
  state.users = users;
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

function normalizeOrganizationMember(member) {
  const username = typeof member?.login === "string" && member.login.trim() ? member.login.trim() : "";
  if (!username) {
    return null;
  }

  const currentSession = state.auth.session ?? {};
  const isCurrentUser = currentSession.login === username;
  const name =
    (isCurrentUser && typeof currentSession.name === "string" && currentSession.name.trim()) ||
    (typeof member?.name === "string" && member.name.trim()) ||
    username;

  return {
    id: username,
    name,
    username,
    role:
      typeof member?.role === "string" && member.role.trim()
        ? member.role.trim().toLowerCase() === "owner"
          ? "Owner"
          : member.role.trim().toLowerCase() === "admin"
            ? "Admin"
            : "Translator"
        : "Translator",
    avatarUrl: member?.avatarUrl ?? null,
    htmlUrl: member?.htmlUrl ?? null,
    isCurrentUser,
  };
}

function buildFallbackUsers() {
  const currentSession = state.auth.session;
  if (!currentSession?.login) {
    return [];
  }

  const currentUser = normalizeOrganizationMember({
    login: currentSession.login,
    name: currentSession.name ?? currentSession.login,
    avatarUrl: currentSession.avatarUrl ?? null,
    htmlUrl: currentSession.login ? `https://github.com/${currentSession.login}` : null,
  });

  return currentUser ? [currentUser] : [];
}

function snapshotUsers(users = []) {
  return users.map((user) => ({ ...user }));
}

function updateLocalAdminRole(users = [], username, shouldBeAdmin) {
  const nextRole = shouldBeAdmin ? "Admin" : "Translator";
  let didUpdate = false;
  const nextUsers = users.map((user) => {
    if (user?.username !== username) {
      return user;
    }

    didUpdate = true;
    return {
      ...user,
      role: nextRole,
      roleSyncPending: true,
    };
  });

  return {
    didUpdate,
    users: nextUsers,
  };
}

const inflightAdminMembershipUsernames = new Set();

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
    state.users = buildFallbackUsers();
    state.userDiscovery = { status: "loading", error: "" };
  }

  return cachedMembers;
}

export function primeUsersForTeam(teamId = state.selectedTeamId) {
  const selectedTeam = getSelectedTeam(teamId);
  initializeUsersFromCachedState(selectedTeam);
}

export async function makeOrganizationAdmin(render, username) {
  await updateOrganizationAdminMembership(render, username, true);
}

export async function revokeOrganizationAdmin(render, username) {
  await updateOrganizationAdminMembership(render, username, false);
}

export function openTeamMemberRemoval(render, username) {
  const selectedTeam = getSelectedTeam();
  const member = state.users.find((user) => user?.username === username);
  if (!selectedTeam || !member || member.isCurrentUser || member.role === "Owner") {
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
  if (!member || member.isCurrentUser || member.role === "Owner") {
    resetTeamMemberRemoval();
    render();
    return;
  }

  try {
    state.teamMemberRemoval.status = "loading";
    state.teamMemberRemoval.error = "";
    render();
    await waitForNextPaint();
    await invoke("remove_organization_member_for_installation", {
      installationId: selectedTeam.installationId,
      orgLogin: selectedTeam.githubOrg,
      username,
      sessionToken: requireBrokerSession(),
    });

    persistTeamUsers(selectedTeam, state.users.filter((user) => user?.username !== username));
    resetTeamMemberRemoval();
    render();
    await loadTeamUsers(render, selectedTeam.id);
  } catch (error) {
    if (await handleSyncFailure(classifySyncError(error), { render })) {
      return;
    }
    state.teamMemberRemoval.status = "idle";
    state.teamMemberRemoval.error = error?.message ?? String(error);
    render();
  }
}

async function updateOrganizationAdminMembership(render, username, shouldBeAdmin) {
  const selectedTeam = getSelectedTeam();
  if (!teamHasInstallation(selectedTeam)) {
    return;
  }

  if (inflightAdminMembershipUsernames.has(username)) {
    return;
  }

  if (selectedTeam.canManageMembers !== true) {
    state.userDiscovery = {
      status: "error",
      error: "Only the team owner can change admin access.",
    };
    render();
    return;
  }

  const previousUsers = snapshotUsers(state.users);
  inflightAdminMembershipUsernames.add(username);

  try {
    const optimisticUsers = updateLocalAdminRole(previousUsers, username, shouldBeAdmin);
    beginPageSync();
    if (optimisticUsers.didUpdate) {
      persistTeamUsers(selectedTeam, optimisticUsers.users);
    }
    state.userDiscovery = { status: "ready", error: "" };
    render();
    await waitForNextPaint();

    if (shouldBeAdmin) {
      await invoke("add_organization_admin_for_installation", {
        installationId: selectedTeam.installationId,
        orgLogin: selectedTeam.githubOrg,
        username,
        sessionToken: requireBrokerSession(),
      });
    } else {
      await invoke("revoke_organization_admin_for_installation", {
        installationId: selectedTeam.installationId,
        orgLogin: selectedTeam.githubOrg,
        username,
        sessionToken: requireBrokerSession(),
      });
    }

    await loadTeamUsers(render, selectedTeam.id);
  } catch (error) {
    persistTeamUsers(selectedTeam, previousUsers);
    if (await handleSyncFailure(classifySyncError(error), { render })) {
      return;
    }
    try {
      await loadTeamUsers(render, selectedTeam.id);
      showNoticeBadge(
        shouldBeAdmin
          ? `Could not make @${username} an admin.`
          : `Could not revoke admin access for @${username}.`,
        render,
        2600,
      );
    } catch (reloadError) {
      if (
        await handleSyncFailure(classifySyncError(reloadError), {
          render,
          teamId: selectedTeam?.id ?? null,
          currentResource: true,
        })
      ) {
        return;
      }
      state.userDiscovery = {
        status: "error",
        error: reloadError?.message ?? String(reloadError),
      };
      failPageSync();
      render();
    }
  } finally {
    inflightAdminMembershipUsernames.delete(username);
  }
}

export async function loadTeamUsers(render, teamId = state.selectedTeamId) {
  const selectedTeam = getSelectedTeam(teamId);
  const cachedMembers = initializeUsersFromCachedState(selectedTeam);
  const shouldSync = teamHasInstallation(selectedTeam) && !state.offline.isEnabled;
  if (shouldSync) {
    beginPageSync();
  }
  render();

  if (!shouldSync) {
    return;
  }

  try {
    const users = await invoke("list_organization_members_for_installation", {
      installationId: selectedTeam.installationId,
      orgLogin: selectedTeam.githubOrg,
      sessionToken: requireBrokerSession(),
    });
    persistTeamUsers(
      selectedTeam,
      users.map((user) => normalizeOrganizationMember(user)).filter(Boolean),
    );
    state.userDiscovery = { status: "ready", error: "" };
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
    failPageSync();
    render();
  }
}
