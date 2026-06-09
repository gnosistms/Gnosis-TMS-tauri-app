import {
  loadTeamScopedCacheMap,
  saveTeamScopedCacheMap,
  teamCacheKey,
} from "../team-cache.js";

function normalizeItems(items, { normalizeItem, sortItems } = {}) {
  const normalized = (Array.isArray(items) ? items : [])
    .map((item) => (normalizeItem ? normalizeItem(item) : item))
    .filter(Boolean);
  return sortItems ? sortItems(normalized) : normalized;
}

export function loadStoredResourceCollectionForTeam(team, {
  storageKey,
  collectionField,
  normalizeItem,
  sortItems,
}) {
  const cacheKey = teamCacheKey(team);
  if (!cacheKey) {
    return {
      exists: false,
      cacheKey: null,
      updatedAt: null,
      [collectionField]: [],
    };
  }

  const cacheMap = loadTeamScopedCacheMap(storageKey);
  const entry = cacheMap[cacheKey];
  if (!entry || typeof entry !== "object") {
    return {
      exists: false,
      cacheKey,
      updatedAt: null,
      [collectionField]: [],
    };
  }

  return {
    exists: true,
    cacheKey,
    updatedAt:
      typeof entry.updatedAt === "string" && entry.updatedAt.trim()
        ? entry.updatedAt.trim()
        : null,
    [collectionField]: normalizeItems(entry[collectionField], {
      normalizeItem,
      sortItems,
    }),
  };
}

export function saveStoredResourceCollectionForTeam(team, items = [], {
  storageKey,
  collectionField,
  normalizeItem,
  sortItems,
}) {
  const cacheKey = teamCacheKey(team);
  if (!cacheKey) {
    return;
  }

  const cacheMap = loadTeamScopedCacheMap(storageKey);
  cacheMap[cacheKey] = {
    [collectionField]: normalizeItems(items, {
      normalizeItem,
      sortItems,
    }),
    updatedAt: new Date().toISOString(),
  };
  saveTeamScopedCacheMap(storageKey, cacheMap);
}

export function removeStoredResourceCollectionForTeam(team, { storageKey }) {
  const cacheKey = teamCacheKey(team);
  if (!cacheKey) {
    return;
  }

  const cacheMap = loadTeamScopedCacheMap(storageKey);
  delete cacheMap[cacheKey];
  saveTeamScopedCacheMap(storageKey, cacheMap);
}

// Bind a per-domain cache descriptor (storage key + collection field + normalizer/sort) once,
// so glossary/QA cache modules are pure descriptor adapters instead of repeating the config.
export function createRepoResourceCache({ storageKey, collectionField, normalizeItem, sortItems }) {
  const config = { storageKey, collectionField, normalizeItem, sortItems };
  return {
    loadForTeam: (team) => loadStoredResourceCollectionForTeam(team, config),
    saveForTeam: (team, items = []) =>
      saveStoredResourceCollectionForTeam(team, items, config),
    removeForTeam: (team) => removeStoredResourceCollectionForTeam(team, { storageKey }),
  };
}
