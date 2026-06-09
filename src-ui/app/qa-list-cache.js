import { normalizeQaList, sortQaLists } from "./qa-list-shared.js";
import { createRepoResourceCache } from "./repo-resource/cache.js";

const qaListCache = createRepoResourceCache({
  storageKey: "gnosis-tms-qa-list-cache",
  collectionField: "qaLists",
  normalizeItem: normalizeQaList,
  sortItems: sortQaLists,
});

export const loadStoredQaListsForTeam = qaListCache.loadForTeam;
export const saveStoredQaListsForTeam = qaListCache.saveForTeam;
export const removeStoredQaListsForTeam = qaListCache.removeForTeam;
