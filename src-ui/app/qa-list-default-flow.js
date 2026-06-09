import { state } from "./state.js";
import { selectedTeam } from "./qa-list-shared.js";
import {
  loadStoredDefaultQaListIdsForTeam,
  removeStoredDefaultQaListIdForTeamLanguage,
  saveStoredDefaultQaListIdForTeamLanguage,
} from "./qa-list-default-cache.js";
import { saveStoredQaListsForTeam } from "./qa-list-cache.js";

export const DEFAULT_QA_LIST_TOOLTIP =
  "New files opened in the editor will automatically use this QA list for this language.";

export function activeDefaultQaListIdsForTeam(team = selectedTeam()) {
  const storedDefaults = loadStoredDefaultQaListIdsForTeam(team);
  const activeByLanguage = {};
  const activeLists = (state.qaLists ?? []).filter((qaList) => qaList.lifecycleState === "active");

  for (const qaList of activeLists) {
    const languageCode = qaList.language?.code ?? "";
    if (!languageCode) {
      continue;
    }

    if (storedDefaults[languageCode] === qaList.id) {
      activeByLanguage[languageCode] = qaList.id;
    }
  }

  for (const qaList of activeLists) {
    const languageCode = qaList.language?.code ?? "";
    if (!languageCode || activeByLanguage[languageCode]) {
      continue;
    }

    const languageListCount = activeLists.filter((item) => item.language?.code === languageCode).length;
    if (languageListCount === 1) {
      activeByLanguage[languageCode] = qaList.id;
    }
  }

  return activeByLanguage;
}

export function makeQaListDefault(render, qaListId) {
  const team = selectedTeam();
  const qaList = state.qaLists.find((item) => item.id === qaListId);
  if (!team || !qaList?.language?.code) {
    return;
  }

  saveStoredDefaultQaListIdForTeamLanguage(team, qaList.language.code, qaList.id);
  saveStoredQaListsForTeam(team, state.qaLists);
  render();
}

export function makeQaListDefaultIfFirst(team, qaList) {
  if (!team || !qaList?.id || !qaList?.language?.code) {
    return;
  }

  const activeSameLanguageCount = (state.qaLists ?? []).filter(
    (item) => item.lifecycleState === "active" && item.language?.code === qaList.language.code,
  ).length;
  if (activeSameLanguageCount === 1) {
    saveStoredDefaultQaListIdForTeamLanguage(team, qaList.language.code, qaList.id);
  }
}

export function updateDefaultQaListAfterDeletion(team, deletedQaList) {
  if (!team || !deletedQaList?.language?.code) {
    return;
  }

  const storedDefaults = loadStoredDefaultQaListIdsForTeam(team);
  const currentDefaults = {
    ...activeDefaultQaListIdsForTeam(team),
    ...storedDefaults,
  };
  if (currentDefaults[deletedQaList.language.code] !== deletedQaList.id) {
    return;
  }

  const replacement = (state.qaLists ?? [])
    .filter((qaList) =>
      qaList.id !== deletedQaList.id
      && qaList.lifecycleState === "active"
      && qaList.language?.code === deletedQaList.language.code,
    )
    .sort((left, right) =>
      (right.termCount ?? 0) - (left.termCount ?? 0)
      || String(left.title ?? "").localeCompare(String(right.title ?? "")),
    )[0];

  if (replacement) {
    saveStoredDefaultQaListIdForTeamLanguage(team, deletedQaList.language.code, replacement.id);
  } else {
    removeStoredDefaultQaListIdForTeamLanguage(team, deletedQaList.language.code);
  }
}
