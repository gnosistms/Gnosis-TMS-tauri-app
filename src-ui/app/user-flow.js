import { invoke } from "./runtime.js";
import { requireBrokerSession } from "./auth-flow.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import { state } from "./state.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";

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
