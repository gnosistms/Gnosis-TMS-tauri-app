import { invoke } from "./runtime.js";
import { requireBrokerSession } from "./auth-flow.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import { resetInviteUser, state } from "./state.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";
import { showScopedSyncBadge } from "./status-feedback.js";

let inviteUserSearchTimeout = null;
let inviteUserSearchVersion = 0;

function deriveUserRole(memberLogin, selectedTeam) {
  if (memberLogin === state.auth.session?.login && selectedTeam?.canDelete) {
    return "Owner";
  }

  return "Translator";
}

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
    role: deriveUserRole(username, selectedTeam),
    avatarUrl: member?.avatarUrl ?? null,
    htmlUrl: member?.htmlUrl ?? null,
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
      error: "Users are unavailable in offline mode.",
    };
    return;
  }

  if (!selectedTeam?.installationId) {
    state.users = [];
    state.userDiscovery = { status: "ready", error: "" };
    return;
  }

  state.users = buildFallbackUsers(selectedTeam);
  state.userDiscovery = { status: "loading", error: "" };
}

export function openInviteUser(render) {
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

  if (inviteUserSearchTimeout) {
    clearTimeout(inviteUserSearchTimeout);
    inviteUserSearchTimeout = null;
  }

  const nextQuery = query.trim();
  if (nextQuery.length < 2 || nextQuery.includes("@")) {
    clearInviteUserSuggestions();
    render();
    return;
  }

  render();

  const searchVersion = ++inviteUserSearchVersion;
  inviteUserSearchTimeout = window.setTimeout(() => {
    inviteUserSearchTimeout = null;
    void searchInviteUserSuggestions(render, nextQuery, searchVersion);
  }, 350);
}

export function selectInviteUserSuggestion(render, suggestionId) {
  const suggestion = state.inviteUser.suggestions.find(
    (item) => String(item.id) === String(suggestionId),
  );
  if (!suggestion) {
    return;
  }

  state.inviteUser.selectedUserId = String(suggestion.id);
  state.inviteUser.query = suggestion.login;
  state.inviteUser.error = "";
  render();
}

export async function submitInviteUser(render) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  if (!selectedTeam?.installationId) {
    state.inviteUser.error = "Inviting users requires a GitHub App-connected team.";
    render();
    return;
  }

  const invitee = state.inviteUser.query.trim();
  if (!invitee) {
    state.inviteUser.error = "Enter a GitHub username or email.";
    render();
    return;
  }

  state.inviteUser.status = "loading";
  state.inviteUser.error = "";
  render();

  try {
    const selectedSuggestion = state.inviteUser.suggestions.find(
      (item) => String(item.id) === state.inviteUser.selectedUserId,
    );

    await invoke("invite_user_to_organization_for_installation", {
      installationId: selectedTeam.installationId,
      orgLogin: selectedTeam.githubOrg,
      inviteeId: selectedSuggestion?.id ?? null,
      inviteeLogin: selectedSuggestion ? selectedSuggestion.login : invitee.includes("@") ? null : invitee,
      inviteeEmail: invitee.includes("@") ? invitee : null,
      sessionToken: requireBrokerSession(),
    });

    showScopedSyncBadge(
      "users",
      `Invitation sent to ${invitee.includes("@") ? invitee : `@${invitee}`}`,
      render,
    );
    resetInviteUser();
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

export async function loadTeamUsers(render, teamId = state.selectedTeamId) {
  const selectedTeam = state.teams.find((team) => team.id === teamId);

  if (state.offline.isEnabled) {
    state.users = [];
    state.userDiscovery = {
      status: "error",
      error: "Users are unavailable in offline mode.",
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

  state.userDiscovery = { status: "loading", error: "" };
  beginPageSync();
  render();

  try {
    const users = await invoke("list_organization_members_for_installation", {
      installationId: selectedTeam.installationId,
      orgLogin: selectedTeam.githubOrg,
      sessionToken: requireBrokerSession(),
    });
    state.users = users.map((user) => normalizeOrganizationMember(user, selectedTeam)).filter(Boolean);
    state.userDiscovery = { status: "ready", error: "" };
    completePageSync(render);
    render();
  } catch (error) {
    const errorMessage = error?.message ?? String(error);
    if (errorMessage.includes("/members") && errorMessage.includes("404")) {
      state.users = buildFallbackUsers(selectedTeam);
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
    state.users = [];
    state.userDiscovery = {
      status: "error",
      error: errorMessage,
    };
    failPageSync();
    render();
  }
}
