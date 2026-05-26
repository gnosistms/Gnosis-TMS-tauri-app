import { state } from "./state.js";

export const MEMBER_ROLE_OPTIONS = ["Viewer", "Translator", "Admin", "Owner"];
export const OWNER_SELF_ROLE_CHANGE_MESSAGE =
  "You cannot change your own Owner role. Ask another Owner to make this change.";
export const OWNER_SELF_ROLE_CHANGE_TOOLTIP =
  "Team owners can not change their own account type. If you need to change this, ask another owner to do it for you.";
export const MIN_OWNER_COUNT_MESSAGE =
  "This team needs at least one Owner. Add another Owner before continuing.";

export function normalizeOrganizationMemberRole(role) {
  const normalizedRole = typeof role === "string" ? role.trim().toLowerCase() : "";
  if (normalizedRole === "owner") {
    return "Owner";
  }
  if (normalizedRole === "admin") {
    return "Admin";
  }
  if (
    normalizedRole === "viewer"
    || normalizedRole === "read_only"
    || normalizedRole === "read-only"
    || normalizedRole === "readonly"
  ) {
    return "Viewer";
  }
  return "Translator";
}

export function memberRoleToWireRole(role) {
  return normalizeOrganizationMemberRole(role).toLowerCase();
}

export function ownerCountAfterRoleChange(users = [], username, nextRole) {
  const targetUsername = String(username ?? "").trim();
  const targetRole = normalizeOrganizationMemberRole(nextRole);
  return users.filter((user) => {
    if (String(user?.username ?? "").trim() === targetUsername) {
      return targetRole === "Owner";
    }
    return normalizeOrganizationMemberRole(user?.role) === "Owner";
  }).length;
}

export function isViewerRole(user) {
  return normalizeOrganizationMemberRole(user?.role) === "Viewer";
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
