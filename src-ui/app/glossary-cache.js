import { normalizeGlossarySummary, sortGlossaries } from "./glossary-shared.js";
import { createRepoResourceCache } from "./repo-resource/cache.js";

const glossaryCache = createRepoResourceCache({
  storageKey: "gnosis-tms-glossary-cache",
  collectionField: "glossaries",
  normalizeItem: normalizeGlossarySummary,
  sortItems: sortGlossaries,
});

export const loadStoredGlossariesForTeam = glossaryCache.loadForTeam;
export const saveStoredGlossariesForTeam = glossaryCache.saveForTeam;
export const removeStoredGlossariesForTeam = glossaryCache.removeForTeam;
