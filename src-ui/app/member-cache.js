import { getActiveStorageLogin } from "./team-storage.js";

const MEMBER_CACHE_STORAGE_KEY = "gnosis-tms-member-cache";

function scopedStorageKey(baseKey, login = getActiveStorageLogin()) {
  return login ? `${baseKey}:${login}` : null;
}

function memberCacheKey(team) {
  if (Number.isFinite(team?.installationId)) {
    return `installation:${team.installationId}`;
  }

  if (typeof team?.githubOrg === "string" && team.githubOrg.trim()) {
    return `org:${team.githubOrg.trim().toLowerCase()}`;
  }

  if (typeof team?.id === "string" && team.id.trim()) {
    return `team:${team.id.trim()}`;
  }

  return null;
}

function normalizeMember(member) {
  if (!member || typeof member !== "object") {
    return null;
  }

  const id =
    typeof member.id === "string" && member.id.trim()
      ? member.id.trim()
      : typeof member.username === "string" && member.username.trim()
        ? member.username.trim()
        : null;
  const username =
    typeof member.username === "string" && member.username.trim()
      ? member.username.trim()
      : typeof member.login === "string" && member.login.trim()
        ? member.login.trim()
        : null;

  if (!id || !username) {
    return null;
  }

  return {
    ...member,
    id,
    username,
    name:
      typeof member.name === "string" && member.name.trim()
        ? member.name.trim()
        : username,
    role:
      typeof member.role === "string" && member.role.trim()
        ? member.role.trim()
        : "Translator",
    avatarUrl:
      typeof member.avatarUrl === "string" && member.avatarUrl.trim()
        ? member.avatarUrl.trim()
        : null,
    htmlUrl:
      typeof member.htmlUrl === "string" && member.htmlUrl.trim()
        ? member.htmlUrl.trim()
        : null,
    isCurrentUser: member.isCurrentUser === true,
  };
}

function loadMemberCacheMap(login = getActiveStorageLogin()) {
  try {
    const scopedKey = scopedStorageKey(MEMBER_CACHE_STORAGE_KEY, login);
    const storedValue = scopedKey ? window.localStorage?.getItem(scopedKey) : null;
    if (!storedValue) {
      return {};
    }

    const parsed = JSON.parse(storedValue);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveMemberCacheMap(cacheMap, login = getActiveStorageLogin()) {
  try {
    const scopedKey = scopedStorageKey(MEMBER_CACHE_STORAGE_KEY, login);
    if (!scopedKey) {
      return;
    }

    window.localStorage?.setItem(scopedKey, JSON.stringify(cacheMap));
  } catch {}
}

export function loadStoredMembersForTeam(team) {
  const cacheKey = memberCacheKey(team);
  if (!cacheKey) {
    return { exists: false, members: [] };
  }

  const cacheMap = loadMemberCacheMap();
  const entry = cacheMap[cacheKey];
  if (!entry || typeof entry !== "object") {
    return { exists: false, members: [] };
  }

  return {
    exists: true,
    members: Array.isArray(entry.members)
      ? entry.members.map(normalizeMember).filter(Boolean)
      : [],
  };
}

export function saveStoredMembersForTeam(team, members = []) {
  const cacheKey = memberCacheKey(team);
  if (!cacheKey) {
    return;
  }

  const cacheMap = loadMemberCacheMap();
  cacheMap[cacheKey] = {
    members: members.map(normalizeMember).filter(Boolean),
    updatedAt: new Date().toISOString(),
  };
  saveMemberCacheMap(cacheMap);
}
