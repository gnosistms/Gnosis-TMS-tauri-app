import { getActiveStorageLogin } from "./team-storage.js";
import { readPersistentValue, writePersistentValue } from "./persistent-store.js";

export function scopedTeamStorageKey(baseKey, login = getActiveStorageLogin()) {
  return login ? `${baseKey}:${login}` : null;
}

export function teamCacheKey(team) {
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

export function loadTeamScopedCacheMap(storageKey, login = getActiveStorageLogin()) {
  try {
    const scopedKey = scopedTeamStorageKey(storageKey, login);
    const storedValue = scopedKey ? readPersistentValue(scopedKey, null) : null;
    if (!storedValue) {
      return {};
    }

    const parsed = storedValue;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveTeamScopedCacheMap(storageKey, cacheMap, login = getActiveStorageLogin()) {
  try {
    const scopedKey = scopedTeamStorageKey(storageKey, login);
    if (!scopedKey) {
      return;
    }

    writePersistentValue(scopedKey, cacheMap);
  } catch {}
}
