import {
  loadTeamScopedCacheMap,
  saveTeamScopedCacheMap,
  teamCacheKey,
} from "./team-cache.js";

const GLOSSARY_DEFAULT_STORAGE_KEY = "gnosis-tms-default-glossary";

function normalizeGlossaryId(glossaryId) {
  return typeof glossaryId === "string" && glossaryId.trim()
    ? glossaryId.trim()
    : null;
}

export function loadStoredDefaultGlossaryIdForTeam(team) {
  const cacheKey = teamCacheKey(team);
  if (!cacheKey) {
    return null;
  }

  const cacheMap = loadTeamScopedCacheMap(GLOSSARY_DEFAULT_STORAGE_KEY);
  const entry = cacheMap[cacheKey];
  if (!entry || typeof entry !== "object") {
    return null;
  }

  return normalizeGlossaryId(entry.glossaryId);
}

export function saveStoredDefaultGlossaryIdForTeam(team, glossaryId) {
  const cacheKey = teamCacheKey(team);
  const normalizedGlossaryId = normalizeGlossaryId(glossaryId);
  if (!cacheKey || !normalizedGlossaryId) {
    return;
  }

  const cacheMap = loadTeamScopedCacheMap(GLOSSARY_DEFAULT_STORAGE_KEY);
  cacheMap[cacheKey] = {
    glossaryId: normalizedGlossaryId,
    updatedAt: new Date().toISOString(),
  };
  saveTeamScopedCacheMap(GLOSSARY_DEFAULT_STORAGE_KEY, cacheMap);
}
