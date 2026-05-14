import { normalizeGlossarySummary, sortGlossaries } from "./glossary-shared.js";
import {
  loadStoredResourceCollectionForTeam,
  removeStoredResourceCollectionForTeam,
  saveStoredResourceCollectionForTeam,
} from "./repo-resource/cache.js";

const GLOSSARY_CACHE_STORAGE_KEY = "gnosis-tms-glossary-cache";

export function loadStoredGlossariesForTeam(team) {
  return loadStoredResourceCollectionForTeam(team, {
    storageKey: GLOSSARY_CACHE_STORAGE_KEY,
    collectionField: "glossaries",
    normalizeItem: normalizeGlossarySummary,
    sortItems: sortGlossaries,
  });
}

export function saveStoredGlossariesForTeam(team, glossaries = []) {
  saveStoredResourceCollectionForTeam(team, glossaries, {
    storageKey: GLOSSARY_CACHE_STORAGE_KEY,
    collectionField: "glossaries",
    normalizeItem: normalizeGlossarySummary,
    sortItems: sortGlossaries,
  });
}

export function removeStoredGlossariesForTeam(team) {
  removeStoredResourceCollectionForTeam(team, {
    storageKey: GLOSSARY_CACHE_STORAGE_KEY,
  });
}
