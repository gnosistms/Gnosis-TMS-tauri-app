import { state } from "./state.js";

export function normalizeOrganizationMemberRole(role) {
  const normalizedRole = typeof role === "string" ? role.trim().toLowerCase() : "";
  if (normalizedRole === "owner") {
    return "Owner";
  }
  if (normalizedRole === "admin") {
    return "Admin";
  }
  return "Translator";
}

export function normalizeOrganizationMember(member, options = {}) {
  const username = typeof member?.login === "string" && member.login.trim()
    ? member.login.trim()
    : typeof member?.username === "string" && member.username.trim()
      ? member.username.trim()
      : "";
  if (!username) {
    return null;
  }

  const currentSession = options.session ?? state.auth.session ?? {};
  const isCurrentUser = currentSession.login === username;
  const name =
    (isCurrentUser && typeof currentSession.name === "string" && currentSession.name.trim()) ||
    (typeof member?.name === "string" && member.name.trim()) ||
    username;
  const role = normalizeOrganizationMemberRole(member?.role);

  return {
    ...member,
    id: username,
    name,
    username,
    role,
    avatarUrl: member?.avatarUrl ?? null,
    htmlUrl: member?.htmlUrl ?? null,
    isCurrentUser,
  };
}

export function buildFallbackMembers(options = {}) {
  const currentSession = options.session ?? state.auth.session;
  if (!currentSession?.login) {
    return [];
  }

  const currentUser = normalizeOrganizationMember({
    login: currentSession.login,
    name: currentSession.name ?? currentSession.login,
    avatarUrl: currentSession.avatarUrl ?? null,
    htmlUrl: currentSession.login ? `https://github.com/${currentSession.login}` : null,
  }, { session: currentSession });

  return currentUser ? [currentUser] : [];
}
