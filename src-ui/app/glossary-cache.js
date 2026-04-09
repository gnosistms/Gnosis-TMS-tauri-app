import { normalizeGlossarySummary, sortGlossaries } from "./glossary-shared.js";
import {
  loadTeamScopedCacheMap,
  saveTeamScopedCacheMap,
  teamCacheKey,
} from "./team-cache.js";

const GLOSSARY_CACHE_STORAGE_KEY = "gnosis-tms-glossary-cache";

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
