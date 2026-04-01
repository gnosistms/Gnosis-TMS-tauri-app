import { invoke } from "./runtime.js";
import { requireBrokerSession } from "./auth-flow.js";
import { loadStoredMembersForTeam, saveStoredMembersForTeam } from "./member-cache.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import { resetInviteUser, state } from "./state.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";
let inviteUserSearchTimeout = null;
let inviteUserSearchVersion = 0;

function normalizeOrganizationMember(member, selectedTeam) {
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

function buildFallbackUsers(selectedTeam) {
  const currentSession = state.auth.session;
  if (!currentSession?.login) {
    return [];
  }

  const currentUser = normalizeOrganizationMember(
    {
      login: currentSession.login,
      name: currentSession.name ?? currentSession.login,
      avatarUrl: currentSession.avatarUrl ?? null,
      htmlUrl: currentSession.login ? `https://github.com/${currentSession.login}` : null,
    },
    selectedTeam,
  );

  return currentUser ? [currentUser] : [];
}

export function primeUsersForTeam(teamId = state.selectedTeamId) {
  const selectedTeam = state.teams.find((team) => team.id === teamId);

  if (state.offline.isEnabled) {
    state.users = [];
    state.userDiscovery = {
      status: "error",
      error: "Members are unavailable in offline mode.",
    };
    return;
  }

  if (!selectedTeam?.installationId) {
    state.users = [];
    state.userDiscovery = { status: "ready", error: "" };
    return;
  }

  const cachedMembers = loadStoredMembersForTeam(selectedTeam);
  if (cachedMembers.exists) {
    state.users = cachedMembers.members;
    state.userDiscovery = { status: "ready", error: "" };
    return;
  }

  state.users = buildFallbackUsers(selectedTeam);
  state.userDiscovery = { status: "loading", error: "" };
}

export function openInviteUser(render) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  if (selectedTeam?.canManageMembers !== true) {
    return;
  }
  resetInviteUser();
  state.inviteUser.isOpen = true;
  render();
}

export function cancelInviteUser(render) {
  if (inviteUserSearchTimeout) {
    clearTimeout(inviteUserSearchTimeout);
    inviteUserSearchTimeout = null;
  }
  inviteUserSearchVersion += 1;
  resetInviteUser();
  render();
}

function clearInviteUserSuggestions() {
  state.inviteUser.selectedUserId = null;
  state.inviteUser.suggestions = [];
  state.inviteUser.suggestionsStatus = "idle";
}

async function searchInviteUserSuggestions(render, query, searchVersion) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  if (!selectedTeam?.installationId) {
    clearInviteUserSuggestions();
    render();
    return;
  }

  state.inviteUser.suggestionsStatus = "loading";
  render();

  try {
    const suggestions = await invoke("search_github_users_for_installation", {
      installationId: selectedTeam.installationId,
      query,
      sessionToken: requireBrokerSession(),
    });

    if (searchVersion !== inviteUserSearchVersion || state.inviteUser.query.trim() !== query) {
      return;
    }

    state.inviteUser.suggestions = suggestions;
    state.inviteUser.suggestionsStatus = "ready";

    if (!suggestions.some((suggestion) => String(suggestion.id) === state.inviteUser.selectedUserId)) {
      state.inviteUser.selectedUserId = null;
    }

    render();
  } catch (error) {
    if (searchVersion !== inviteUserSearchVersion) {
      return;
    }

    clearInviteUserSuggestions();
    state.inviteUser.error = error?.message ?? String(error);
    render();
  }
}

export function updateInviteUserQuery(render, query) {
  state.inviteUser.query = query;
  state.inviteUser.error = "";
  state.inviteUser.selectedUserId = null;
  state.inviteUser.selectedSuggestion = null;

  if (inviteUserSearchTimeout) {
    clearTimeout(inviteUserSearchTimeout);
    inviteUserSearchTimeout = null;
  }

  const nextQuery = query.trim();
  if (nextQuery.length < 4 || nextQuery.includes("@") || /\s/.test(nextQuery)) {
    clearInviteUserSuggestions();
    render();
    return;
  }

  render();

  const searchVersion = ++inviteUserSearchVersion;
  inviteUserSearchTimeout = window.setTimeout(() => {
    inviteUserSearchTimeout = null;
    void searchInviteUserSuggestions(render, nextQuery, searchVersion);
  }, 200);
}

export function selectInviteUserSuggestion(render, suggestionId) {
  const suggestion = state.inviteUser.suggestions.find(
    (item) => String(item.id) === String(suggestionId),
  );
  if (!suggestion) {
    return;
  }

  state.inviteUser.selectedUserId = String(suggestion.id);
  state.inviteUser.selectedSuggestion = suggestion;
  state.inviteUser.query = suggestion.login;
  state.inviteUser.suggestions = [];
  state.inviteUser.suggestionsStatus = "idle";
  state.inviteUser.error = "";
  render();
}

export function editInviteUserSelection(render) {
  state.inviteUser.selectedUserId = null;
  state.inviteUser.selectedSuggestion = null;
  state.inviteUser.suggestions = [];
  state.inviteUser.suggestionsStatus = "idle";
  state.inviteUser.error = "";
  render();
}

export function acknowledgeInviteUserSuccess(render) {
  resetInviteUser();
  render();
}

export async function submitInviteUser(render) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  if (!selectedTeam?.installationId) {
    state.inviteUser.error = "Inviting members requires a GitHub App-connected team.";
    render();
    return;
  }

  if (selectedTeam.canManageMembers !== true) {
    state.inviteUser.error = "Only the team owner can invite members.";
    render();
    return;
  }

  const invitee = state.inviteUser.query.trim();
  if (!invitee) {
    state.inviteUser.error = "Enter a GitHub username.";
    render();
    return;
  }

  if (invitee.includes("@") || /\s/.test(invitee)) {
    state.inviteUser.error = "Invitations must use a GitHub username.";
    render();
    return;
  }

  state.inviteUser.status = "loading";
  state.inviteUser.error = "";
  render();

  try {
    const selectedSuggestion =
      state.inviteUser.selectedSuggestion
      ?? state.inviteUser.suggestions.find(
        (item) => String(item.id) === state.inviteUser.selectedUserId,
      );

    await invoke("invite_user_to_organization_for_installation", {
      installationId: selectedTeam.installationId,
      orgLogin: selectedTeam.githubOrg,
      inviteeId: selectedSuggestion?.id ?? null,
      inviteeLogin: selectedSuggestion ? selectedSuggestion.login : invitee,
      inviteeEmail: null,
      sessionToken: requireBrokerSession(),
    });

    state.inviteUser.status = "idle";
    state.inviteUser.step = "success";
    render();
  } catch (error) {
    if (await handleSyncFailure(classifySyncError(error), { render })) {
      return;
    }
    state.inviteUser.status = "idle";
    state.inviteUser.error = error?.message ?? String(error);
    render();
  }
}

async function updateOrganizationAdminMembership(render, username, shouldBeAdmin) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
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

  try {
    beginPageSync();
    state.userDiscovery = { status: "loading", error: "" };
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

export async function makeOrganizationAdmin(render, username) {
  await updateOrganizationAdminMembership(render, username, true);
}

export async function revokeOrganizationAdmin(render, username) {
  await updateOrganizationAdminMembership(render, username, false);
}

export async function loadTeamUsers(render, teamId = state.selectedTeamId) {
  const selectedTeam = state.teams.find((team) => team.id === teamId);

  if (state.offline.isEnabled) {
    state.users = [];
    state.userDiscovery = {
      status: "error",
      error: "Members are unavailable in offline mode.",
    };
    render();
    return;
  }

  if (!selectedTeam?.installationId) {
    state.users = [];
    state.userDiscovery = { status: "ready", error: "" };
    render();
    return;
  }

  const cachedMembers = loadStoredMembersForTeam(selectedTeam);
  if (cachedMembers.exists) {
    state.users = cachedMembers.members;
    state.userDiscovery = { status: "ready", error: "" };
  } else {
    state.userDiscovery = { status: "loading", error: "" };
  }
  beginPageSync();
  render();

  try {
    const users = await invoke("list_organization_members_for_installation", {
      installationId: selectedTeam.installationId,
      orgLogin: selectedTeam.githubOrg,
      sessionToken: requireBrokerSession(),
    });
    state.users = users.map((user) => normalizeOrganizationMember(user, selectedTeam)).filter(Boolean);
    saveStoredMembersForTeam(selectedTeam, state.users);
    state.userDiscovery = { status: "ready", error: "" };
    completePageSync(render);
    render();
  } catch (error) {
    const errorMessage = error?.message ?? String(error);
    if (errorMessage.includes("/members") && errorMessage.includes("404")) {
      state.users = buildFallbackUsers(selectedTeam);
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
    if (!cachedMembers.exists) {
      state.users = [];
      state.userDiscovery = {
        status: "error",
        error: errorMessage,
      };
    } else {
      state.userDiscovery = { status: "ready", error: "" };
    }
    failPageSync();
    render();
  }
}
