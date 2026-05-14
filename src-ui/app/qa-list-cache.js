import {
  loadTeamScopedCacheMap,
  saveTeamScopedCacheMap,
  teamCacheKey,
} from "./team-cache.js";
import { normalizeQaList, sortQaLists } from "./qa-list-shared.js";

const QA_LIST_CACHE_STORAGE_KEY = "gnosis-tms-qa-list-cache";

export function loadStoredQaListsForTeam(team) {
  const cacheKey = teamCacheKey(team);
  if (!cacheKey) {
    return {
      exists: false,
      cacheKey: null,
      updatedAt: null,
      qaLists: [],
    };
  }

  const cacheMap = loadTeamScopedCacheMap(QA_LIST_CACHE_STORAGE_KEY);
  const entry = cacheMap[cacheKey];
  if (!entry || typeof entry !== "object") {
    return {
      exists: false,
      cacheKey,
      updatedAt: null,
      qaLists: [],
    };
  }

  return {
    exists: true,
    cacheKey,
    updatedAt: typeof entry.updatedAt === "string" && entry.updatedAt.trim() ? entry.updatedAt.trim() : null,
    qaLists: sortQaLists(
      (Array.isArray(entry.qaLists) ? entry.qaLists : [])
        .map(normalizeQaList)
        .filter(Boolean),
    ),
  };
}

export function saveStoredQaListsForTeam(team, qaLists = []) {
  const cacheKey = teamCacheKey(team);
  if (!cacheKey) {
    return;
  }

  const cacheMap = loadTeamScopedCacheMap(QA_LIST_CACHE_STORAGE_KEY);
  cacheMap[cacheKey] = {
    qaLists: sortQaLists(
      (Array.isArray(qaLists) ? qaLists : [])
        .map(normalizeQaList)
        .filter(Boolean),
    ),
    updatedAt: new Date().toISOString(),
  };
  saveTeamScopedCacheMap(QA_LIST_CACHE_STORAGE_KEY, cacheMap);
}
