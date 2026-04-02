import { invoke } from "./runtime.js";
import { requireBrokerSession } from "./auth-flow.js";
import { loadStoredMembersForTeam, saveStoredMembersForTeam } from "./member-cache.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import { state } from "./state.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";

function getSelectedTeam(teamId = state.selectedTeamId) {
  return state.teams.find((team) => team.id === teamId);
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

function updateLocalAdminRole(users = [], username, shouldBeAdmin, options = {}) {
  const nextRole = shouldBeAdmin ? "Admin" : "Translator";
  const roleSyncPending = options.roleSyncPending === true;
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
    };
  });

  return {
    didUpdate,
    users: nextUsers,
  };
}

function initializeUsersFromCachedState(selectedTeam) {
  if (state.offline.isEnabled) {
    setUsersUnavailable("Members are unavailable in offline mode.");
    return { selectedTeam: null, cachedMembers: null };
  }

  if (!selectedTeam?.installationId) {
    state.users = [];
    state.userDiscovery = { status: "ready", error: "" };
    return { selectedTeam: null, cachedMembers: null };
  }

  const cachedMembers = loadStoredMembersForTeam(selectedTeam);
  if (cachedMembers.exists) {
    state.users = cachedMembers.members;
    state.userDiscovery = { status: "ready", error: "" };
  } else {
    state.users = buildFallbackUsers();
    state.userDiscovery = { status: "loading", error: "" };
  }

  return { selectedTeam, cachedMembers };
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

async function updateOrganizationAdminMembership(render, username, shouldBeAdmin) {
  const selectedTeam = getSelectedTeam();
  if (!selectedTeam?.installationId) {
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

  try {
    const optimisticUsers = updateLocalAdminRole(previousUsers, username, shouldBeAdmin, {
      roleSyncPending: true,
    });
    beginPageSync();
    if (optimisticUsers.didUpdate) {
      state.users = optimisticUsers.users;
      saveStoredMembersForTeam(selectedTeam, state.users);
    }
    state.userDiscovery = { status: "ready", error: "" };
    render();

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
    if (previousUsers.length > 0) {
      state.users = previousUsers;
      saveStoredMembersForTeam(selectedTeam, state.users);
    }
    if (await handleSyncFailure(classifySyncError(error), { render })) {
      return;
    }
    state.userDiscovery = {
      status: "error",
      error: error?.message ?? String(error),
    };
    failPageSync();
    render();
  }
}

export async function loadTeamUsers(render, teamId = state.selectedTeamId) {
  const selectedTeam = getSelectedTeam(teamId);
  const { cachedMembers } = initializeUsersFromCachedState(selectedTeam);
  render();

  if (!selectedTeam?.installationId || state.offline.isEnabled) {
    return;
  }

  beginPageSync();
  render();

  try {
    const users = await invoke("list_organization_members_for_installation", {
      installationId: selectedTeam.installationId,
      orgLogin: selectedTeam.githubOrg,
      sessionToken: requireBrokerSession(),
    });
    state.users = users.map((user) => normalizeOrganizationMember(user)).filter(Boolean);
    saveStoredMembersForTeam(selectedTeam, state.users);
    state.userDiscovery = { status: "ready", error: "" };
    completePageSync(render);
    render();
  } catch (error) {
    const errorMessage = error?.message ?? String(error);
    if (errorMessage.includes("/members") && errorMessage.includes("404")) {
      state.users = buildFallbackUsers();
      saveStoredMembersForTeam(selectedTeam, state.users);
      state.userDiscovery = { status: "ready", error: "" };
      completePageSync(render);
      render();
      return;
    }

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
