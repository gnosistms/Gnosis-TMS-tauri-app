import { invoke } from "./runtime.js";
import { requireBrokerSession } from "./auth-flow.js";
import { resetInviteUser, state } from "./state.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";
import { invalidateMembersQueryAfterMutation } from "./member-query.js";
import { clearMembersStatus, showMembersNotice, showMembersStatus } from "./team-members-flow.js";

let inviteUserSearchTimeout = null;
let inviteUserSearchVersion = 0;

function getSelectedTeam() {
  return state.teams.find((team) => team.id === state.selectedTeamId);
}

function clearInviteUserSuggestions() {
  state.inviteUser.selectedUserId = null;
  state.inviteUser.suggestions = [];
  state.inviteUser.suggestionsStatus = "idle";
}

export function openInviteUser(render) {
  const selectedTeam = getSelectedTeam();
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

async function searchInviteUserSuggestions(render, query, searchVersion) {
  const selectedTeam = getSelectedTeam();
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
  const selectedTeam = getSelectedTeam();
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
  showMembersStatus(render, "Sending invitation...");
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
    showMembersStatus(render, "Refreshing member list...");
    await invalidateMembersQueryAfterMutation(selectedTeam, {
      teamId: selectedTeam.id,
      render,
    });
    clearMembersStatus(render);
    showMembersNotice(render, "Invitation sent.");
    render();
  } catch (error) {
    clearMembersStatus(render);
    if (await handleSyncFailure(classifySyncError(error), { render })) {
      return;
    }
    state.inviteUser.status = "idle";
    state.inviteUser.error = error?.message ?? String(error);
    render();
  }
}
