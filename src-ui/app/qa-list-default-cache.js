import { readPersistentValue, writePersistentValue } from "./persistent-store.js";
import { teamCacheKey } from "./team-cache.js";

const QA_LIST_DEFAULT_STORAGE_KEY = "gnosis-tms-default-qa-lists";

function teamDefaultsKey(team) {
  return teamCacheKey(team);
}

export function loadStoredDefaultQaListIdsForTeam(team) {
  const key = teamDefaultsKey(team);
  if (!key) {
    return {};
  }

  const stored = readPersistentValue(QA_LIST_DEFAULT_STORAGE_KEY, {});
  const teamDefaults = stored?.[key];
  return teamDefaults && typeof teamDefaults === "object" ? { ...teamDefaults } : {};
}

export function saveStoredDefaultQaListIdForTeamLanguage(team, languageCode, qaListId) {
  const key = teamDefaultsKey(team);
  const canonicalLanguageCode = String(languageCode ?? "").trim();
  if (!key || !canonicalLanguageCode || !qaListId) {
    return;
  }

  const stored = readPersistentValue(QA_LIST_DEFAULT_STORAGE_KEY, {});
  stored[key] = {
    ...(stored[key] && typeof stored[key] === "object" ? stored[key] : {}),
    [canonicalLanguageCode]: qaListId,
  };
  writePersistentValue(QA_LIST_DEFAULT_STORAGE_KEY, stored);
}

export function removeStoredDefaultQaListIdForTeamLanguage(team, languageCode) {
  const key = teamDefaultsKey(team);
  const canonicalLanguageCode = String(languageCode ?? "").trim();
  if (!key || !canonicalLanguageCode) {
    return;
  }

  const stored = readPersistentValue(QA_LIST_DEFAULT_STORAGE_KEY, {});
  if (!stored[key] || typeof stored[key] !== "object") {
    return;
  }

  delete stored[key][canonicalLanguageCode];
  writePersistentValue(QA_LIST_DEFAULT_STORAGE_KEY, stored);
}

export function removeStoredDefaultQaListIdsForTeam(team) {
  const key = teamDefaultsKey(team);
  if (!key) {
    return;
  }

  const stored = readPersistentValue(QA_LIST_DEFAULT_STORAGE_KEY, {});
  delete stored[key];
  writePersistentValue(QA_LIST_DEFAULT_STORAGE_KEY, stored);
}
