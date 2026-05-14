import {
  loadStoredResourceCollectionForTeam,
  removeStoredResourceCollectionForTeam,
  saveStoredResourceCollectionForTeam,
} from "./repo-resource/cache.js";
import { normalizeQaList, sortQaLists } from "./qa-list-shared.js";

const QA_LIST_CACHE_STORAGE_KEY = "gnosis-tms-qa-list-cache";

export function loadStoredQaListsForTeam(team) {
  return loadStoredResourceCollectionForTeam(team, {
    storageKey: QA_LIST_CACHE_STORAGE_KEY,
    collectionField: "qaLists",
    normalizeItem: normalizeQaList,
    sortItems: sortQaLists,
  });
}

export function saveStoredQaListsForTeam(team, qaLists = []) {
  saveStoredResourceCollectionForTeam(team, qaLists, {
    storageKey: QA_LIST_CACHE_STORAGE_KEY,
    collectionField: "qaLists",
    normalizeItem: normalizeQaList,
    sortItems: sortQaLists,
  });
}

export function removeStoredQaListsForTeam(team) {
  removeStoredResourceCollectionForTeam(team, {
    storageKey: QA_LIST_CACHE_STORAGE_KEY,
  });
}
