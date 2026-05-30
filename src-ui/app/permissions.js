const VIEWER_ROLES = new Set(["viewer", "read_only", "read-only", "readonly"]);
const TRANSLATOR_ROLES = new Set(["translator", "member"]);
const ADMIN_ROLES = new Set(["admin"]);
const OWNER_ROLES = new Set(["owner"]);

function normalizedText(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeAccountRole(value) {
  const role = normalizedText(value);
  if (VIEWER_ROLES.has(role)) {
    return "viewer";
  }
  if (OWNER_ROLES.has(role)) {
    return "owner";
  }
  if (ADMIN_ROLES.has(role)) {
    return "admin";
  }
  if (TRANSLATOR_ROLES.has(role)) {
    return "translator";
  }
  return role ? "unknown" : "";
}

export function isReadOnlyViewerRole(value) {
  return normalizeAccountRole(value) === "viewer";
}

function legacyRoleForTeam(team) {
  if (!team || typeof team !== "object") {
    return "";
  }
  if (team.canDelete === true || team.canManageTeam === true) {
    return "owner";
  }
  if (team.canManageProjects === true) {
    return "admin";
  }
  if (Number.isFinite(team.installationId) || team.canLeave === true) {
    return "translator";
  }
  return "";
}

export function roleForTeam(team) {
  const role = normalizeAccountRole(team?.membershipRole ?? team?.role);
  if (role) {
    return role;
  }
  return legacyRoleForTeam(team);
}

export function deriveTeamCapabilities(team) {
  const role = roleForTeam(team);
  const hasTeam = Boolean(team);
  const isViewer = role === "viewer";
  const isTranslator = role === "translator";
  const isAdmin = role === "admin";
  const isOwner = role === "owner";
  const canWriteContent = isTranslator || isAdmin || isOwner;
  const canManageResources = isAdmin || isOwner;

  return {
    canDownload: hasTeam,
    canWriteChapters: canWriteContent,
    canWriteGlossaries: canWriteContent,
    canWriteQaLists: canWriteContent,
    canManageProjects: canManageResources,
    canManageGlossaryResources: canManageResources,
    canManageQaListResources: canManageResources,
    canManageMembers: isOwner,
    canManageTeam: isOwner,
    canLocalHardDelete: hasTeam,
    isViewer,
  };
}

export function withDerivedTeamCapabilities(team) {
  if (!team || typeof team !== "object") {
    return team;
  }
  const capabilities = deriveTeamCapabilities(team);
  return {
    ...team,
    ...capabilities,
    canDelete: capabilities.canManageTeam,
  };
}

export function canDownload(team) {
  return deriveTeamCapabilities(team).canDownload;
}

export function canWriteChapters(team) {
  return deriveTeamCapabilities(team).canWriteChapters;
}

export function canWriteGlossaries(team) {
  return deriveTeamCapabilities(team).canWriteGlossaries;
}

export function canWriteQaLists(team) {
  return deriveTeamCapabilities(team).canWriteQaLists;
}

export function canManageProjects(team) {
  return deriveTeamCapabilities(team).canManageProjects;
}

export function canManageGlossaryResources(team) {
  return deriveTeamCapabilities(team).canManageGlossaryResources;
}

export function canManageQaListResources(team) {
  return deriveTeamCapabilities(team).canManageQaListResources;
}

export function canManageMembers(team) {
  return deriveTeamCapabilities(team).canManageMembers;
}

export function canManageTeam(team) {
  return deriveTeamCapabilities(team).canManageTeam;
}

export function canLocalHardDelete(team) {
  return deriveTeamCapabilities(team).canLocalHardDelete;
}
