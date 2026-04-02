import {
  readPersistentValue,
  removePersistentValue,
  writePersistentValue,
} from "./persistent-store.js";

const TEAM_RECORDS_STORAGE_KEY = "gnosis-tms-team-records";
const TEAM_PENDING_MUTATIONS_STORAGE_KEY = "gnosis-tms-team-pending-mutations";
const ACTIVE_STORAGE_LOGIN_KEY = "gnosis-tms-active-storage-login";

function normalizeStorageLogin(login) {
  return typeof login === "string" && login.trim() ? login.trim().toLowerCase() : null;
}

function scopedStorageKey(baseKey, login = getActiveStorageLogin()) {
  const normalizedLogin = normalizeStorageLogin(login);
  return normalizedLogin ? `${baseKey}:${normalizedLogin}` : null;
}

export function getActiveStorageLogin() {
  try {
    return normalizeStorageLogin(readPersistentValue(ACTIVE_STORAGE_LOGIN_KEY, null));
  } catch {
    return null;
  }
}

export function setActiveStorageLogin(login) {
  const normalizedLogin = normalizeStorageLogin(login);
  try {
    if (!normalizedLogin) {
      removePersistentValue(ACTIVE_STORAGE_LOGIN_KEY);
      return;
    }
    writePersistentValue(ACTIVE_STORAGE_LOGIN_KEY, normalizedLogin);
  } catch {}
}

export function clearActiveStorageLogin() {
  setActiveStorageLogin(null);
}

function normalizeTeamRecord(team) {
  if (!team || typeof team !== "object") {
    return null;
  }

  const githubOrg =
    typeof team.githubOrg === "string" && team.githubOrg.trim()
      ? team.githubOrg.trim()
      : null;
  if (!githubOrg) {
    return null;
  }

  const membershipRole =
    typeof team.membershipRole === "string" && team.membershipRole.trim()
      ? team.membershipRole.trim()
      : "member";

  return {
    id:
      typeof team.id === "string" && team.id.trim()
        ? team.id.trim()
        : githubOrg,
    name:
      typeof team.name === "string" && team.name.trim()
        ? team.name.trim()
        : githubOrg,
    githubOrg,
    ownerLogin:
      typeof team.ownerLogin === "string" && team.ownerLogin.trim()
        ? team.ownerLogin.trim()
        : githubOrg,
    description:
      typeof team.description === "string" ? team.description : null,
    membershipRole,
    canDelete: team.canDelete === true,
    canManageMembers: team.canManageMembers === true || team.canDelete === true,
    canManageProjects: team.canManageProjects === true || team.canDelete === true,
    canLeave: team.canLeave !== false,
    needsAppApproval: team.needsAppApproval === true,
    appApprovalUrl:
      typeof team.appApprovalUrl === "string" && team.appApprovalUrl.trim()
        ? team.appApprovalUrl.trim()
        : null,
    appRequestUrl:
      typeof team.appRequestUrl === "string" && team.appRequestUrl.trim()
        ? team.appRequestUrl.trim()
        : null,
    missingAppPermissions: Array.isArray(team.missingAppPermissions)
      ? team.missingAppPermissions
          .map((permission) => (typeof permission === "string" ? permission.trim() : ""))
          .filter(Boolean)
      : [],
    installationId:
      Number.isFinite(team.installationId) ? team.installationId : null,
    orgCreatedAt:
      typeof team.orgCreatedAt === "string" && team.orgCreatedAt.trim()
        ? team.orgCreatedAt
        : null,
    isDeleted: team.isDeleted === true,
    deletedAt:
      typeof team.deletedAt === "string" && team.deletedAt.trim()
        ? team.deletedAt
        : null,
    syncState:
      typeof team.syncState === "string" && team.syncState.trim()
        ? team.syncState
        : "active",
    statusLabel:
      typeof team.statusLabel === "string" ? team.statusLabel : "",
    lastSeenAt:
      typeof team.lastSeenAt === "string" && team.lastSeenAt.trim()
        ? team.lastSeenAt
        : null,
  };
}

function teamIdentityKey(team) {
  return team.githubOrg.toLowerCase();
}

export function loadStoredTeamRecords(login = getActiveStorageLogin()) {
  try {
    const scopedKey = scopedStorageKey(TEAM_RECORDS_STORAGE_KEY, login);
    const storedValue = scopedKey ? readPersistentValue(scopedKey, null) : null;
    if (!storedValue) {
      return [];
    }

    const teams = storedValue;
    if (!Array.isArray(teams)) {
      return [];
    }

    return teams
      .map(normalizeTeamRecord)
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function splitStoredTeamRecords(teams = loadStoredTeamRecords()) {
  return {
    activeTeams: teams.filter((team) => !team.isDeleted),
    deletedTeams: teams.filter((team) => team.isDeleted),
  };
}

export function saveStoredTeamRecords(teams, login = getActiveStorageLogin()) {
  try {
    const scopedKey = scopedStorageKey(TEAM_RECORDS_STORAGE_KEY, login);
    if (!scopedKey) {
      return;
    }
    const merged = new Map();
    teams
      .map(normalizeTeamRecord)
      .filter(Boolean)
      .forEach((team) => {
        const key = teamIdentityKey(team);
        const existing = merged.get(key);
        merged.set(key, existing ? { ...existing, ...team } : team);
      });
    writePersistentValue(scopedKey, [...merged.values()]);
  } catch {}
}

export function upsertStoredTeamRecords(teams, login = getActiveStorageLogin()) {
  const existingTeams = loadStoredTeamRecords(login);
  const merged = new Map(
    existingTeams.map((team) => [teamIdentityKey(team), team]),
  );

  teams
    .map(normalizeTeamRecord)
    .filter(Boolean)
    .forEach((team) => {
      const key = teamIdentityKey(team);
      const previous = merged.get(key);
      merged.set(key, previous ? { ...previous, ...team } : team);
    });

  const nextTeams = [...merged.values()];
  saveStoredTeamRecords(nextTeams, login);
  return nextTeams;
}

export function replaceStoredTeamRecords(teams, login = getActiveStorageLogin()) {
  const normalizedTeams = teams
    .map(normalizeTeamRecord)
    .filter(Boolean);
  saveStoredTeamRecords(normalizedTeams, login);
  return normalizedTeams;
}

export function updateStoredTeamRecord(teamId, updates, login = getActiveStorageLogin()) {
  const nextTeams = loadStoredTeamRecords(login).map((team) =>
    team.id === teamId ? normalizeTeamRecord({ ...team, ...updates }) : team,
  );
  saveStoredTeamRecords(nextTeams, login);
  return nextTeams;
}

export function removeStoredTeamRecord(teamId, login = getActiveStorageLogin()) {
  const nextTeams = loadStoredTeamRecords(login).filter((team) => team.id !== teamId);
  saveStoredTeamRecords(nextTeams, login);
  return nextTeams;
}

export function loadStoredGithubAppTeams() {
  return loadStoredTeamRecords();
}

export function saveStoredGithubAppTeams(teams) {
  saveStoredTeamRecords(teams);
}

export function updateStoredGithubAppTeam(teamId, updates) {
  return updateStoredTeamRecord(teamId, updates);
}

export function mergeTeams(primaryTeams, secondaryTeams = []) {
  const mergedTeams = new Map();
  [...secondaryTeams, ...primaryTeams]
    .map(normalizeTeamRecord)
    .filter(Boolean)
    .forEach((team) => {
      const key = teamIdentityKey(team);
      const existing = mergedTeams.get(key);
      mergedTeams.set(key, existing ? { ...existing, ...team } : team);
    });
  return [...mergedTeams.values()];
}

export function loadStoredTeamPendingMutations(login = getActiveStorageLogin()) {
  try {
    const scopedKey = scopedStorageKey(TEAM_PENDING_MUTATIONS_STORAGE_KEY, login);
    const storedValue = scopedKey ? readPersistentValue(scopedKey, null) : null;
    if (!storedValue) {
      return [];
    }

    const mutations = storedValue;
    return Array.isArray(mutations) ? mutations : [];
  } catch {
    return [];
  }
}

export function saveStoredTeamPendingMutations(mutations, login = getActiveStorageLogin()) {
  try {
    const scopedKey = scopedStorageKey(TEAM_PENDING_MUTATIONS_STORAGE_KEY, login);
    if (!scopedKey) {
      return;
    }
    writePersistentValue(scopedKey, Array.isArray(mutations) ? mutations : []);
  } catch {}
}
