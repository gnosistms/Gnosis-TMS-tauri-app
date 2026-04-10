import { readPersistentValue, removePersistentValue, writePersistentValue } from "./persistent-store.js";
import { normalizeGlossarySummary, sortGlossaries } from "./glossary-shared.js";
import {
  loadTeamScopedCacheMap,
  saveTeamScopedCacheMap,
  scopedTeamStorageKey,
  teamCacheKey,
} from "./team-cache.js";

const GLOSSARY_CACHE_STORAGE_KEY = "gnosis-tms-glossary-cache";
const GLOSSARY_PENDING_MUTATIONS_STORAGE_KEY = "gnosis-tms-glossary-pending-mutations";

function removeScopedMutationEntry(storageKey, cacheKey) {
  try {
    const scopedKey = scopedTeamStorageKey(storageKey);
    if (!scopedKey) {
      return;
    }

    const storedValue = readPersistentValue(scopedKey, {});
    const parsed = storedValue ?? {};
    if (!parsed || typeof parsed !== "object" || !Object.prototype.hasOwnProperty.call(parsed, cacheKey)) {
      return;
    }

    delete parsed[cacheKey];
    if (Object.keys(parsed).length === 0) {
      removePersistentValue(scopedKey);
      return;
    }

    writePersistentValue(scopedKey, parsed);
  } catch {}
}

export function loadStoredGlossariesForTeam(team) {
  const cacheKey = teamCacheKey(team);
  if (!cacheKey) {
    return { exists: false, glossaries: [] };
  }

  const cacheMap = loadTeamScopedCacheMap(GLOSSARY_CACHE_STORAGE_KEY);
  const entry = cacheMap[cacheKey];
  if (!entry || typeof entry !== "object") {
    return { exists: false, glossaries: [] };
  }

  return {
    exists: true,
    glossaries: sortGlossaries(
      (Array.isArray(entry.glossaries) ? entry.glossaries : [])
        .map(normalizeGlossarySummary)
        .filter(Boolean),
    ),
  };
}

export function saveStoredGlossariesForTeam(team, glossaries = []) {
  const cacheKey = teamCacheKey(team);
  if (!cacheKey) {
    return;
  }

  const cacheMap = loadTeamScopedCacheMap(GLOSSARY_CACHE_STORAGE_KEY);
  cacheMap[cacheKey] = {
    glossaries: sortGlossaries(
      (Array.isArray(glossaries) ? glossaries : [])
        .map(normalizeGlossarySummary)
        .filter(Boolean),
    ),
    updatedAt: new Date().toISOString(),
  };
  saveTeamScopedCacheMap(GLOSSARY_CACHE_STORAGE_KEY, cacheMap);
}

export function removeStoredGlossariesForTeam(team) {
  const cacheKey = teamCacheKey(team);
  if (!cacheKey) {
    return;
  }

  const cacheMap = loadTeamScopedCacheMap(GLOSSARY_CACHE_STORAGE_KEY);
  delete cacheMap[cacheKey];
  saveTeamScopedCacheMap(GLOSSARY_CACHE_STORAGE_KEY, cacheMap);
  removeScopedMutationEntry(GLOSSARY_PENDING_MUTATIONS_STORAGE_KEY, cacheKey);
}

export function loadStoredGlossaryPendingMutations(team) {
  const cacheKey = teamCacheKey(team);
  if (!cacheKey) {
    return [];
  }

  try {
    const scopedKey = scopedTeamStorageKey(GLOSSARY_PENDING_MUTATIONS_STORAGE_KEY);
    const storedValue = scopedKey ? readPersistentValue(scopedKey, null) : null;
    if (!storedValue) {
      return [];
    }

    const parsed = storedValue;
    if (!parsed || typeof parsed !== "object") {
      return [];
    }

    return Array.isArray(parsed[cacheKey]) ? parsed[cacheKey] : [];
  } catch {
    return [];
  }
}

export function saveStoredGlossaryPendingMutations(team, mutations) {
  const cacheKey = teamCacheKey(team);
  if (!cacheKey) {
    return;
  }

  try {
    const scopedKey = scopedTeamStorageKey(GLOSSARY_PENDING_MUTATIONS_STORAGE_KEY);
    if (!scopedKey) {
      return;
    }
    const storedValue = readPersistentValue(scopedKey, {});
    const parsed = storedValue ?? {};
    const nextMap = parsed && typeof parsed === "object" ? parsed : {};
    nextMap[cacheKey] = Array.isArray(mutations) ? mutations : [];
    writePersistentValue(scopedKey, nextMap);
  } catch {}
}
