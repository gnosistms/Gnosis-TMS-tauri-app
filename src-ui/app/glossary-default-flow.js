import { state } from "./state.js";
import {
  loadStoredDefaultGlossaryIdForTeam,
  removeStoredDefaultGlossaryIdForTeam,
  saveStoredDefaultGlossaryIdForTeam,
} from "./glossary-default-cache.js";
import { selectedTeam } from "./glossary-shared.js";
import { showNoticeBadge } from "./status-feedback.js";

export const DEFAULT_GLOSSARY_TOOLTIP =
  "The default glossary is assigned automatically to new files that you upload to projects.";

function activeGlossariesExcept(glossaryId = null) {
  return (Array.isArray(state.glossaries) ? state.glossaries : []).filter((glossary) =>
    glossary?.lifecycleState !== "deleted" && glossary.id !== glossaryId
  );
}

function compareDefaultCandidates(left, right) {
  const leftTermCount = Number.isFinite(left?.termCount) ? left.termCount : 0;
  const rightTermCount = Number.isFinite(right?.termCount) ? right.termCount : 0;
  return (
    rightTermCount - leftTermCount
    || String(left?.title ?? "").localeCompare(String(right?.title ?? ""), undefined, {
      sensitivity: "base",
      numeric: true,
    })
    || String(left?.id ?? "").localeCompare(String(right?.id ?? ""), undefined, {
      sensitivity: "base",
      numeric: true,
    })
  );
}

export function defaultGlossaryCandidateAfterDeletion(glossaryId) {
  return [...activeGlossariesExcept(glossaryId)].sort(compareDefaultCandidates)[0] ?? null;
}

export function activeDefaultGlossaryIdForTeam(team = selectedTeam()) {
  const defaultGlossaryId = loadStoredDefaultGlossaryIdForTeam(team);
  if (!defaultGlossaryId) {
    return null;
  }

  const glossary = state.glossaries.find((item) =>
    item?.id === defaultGlossaryId && item.lifecycleState !== "deleted"
  );
  return glossary ? defaultGlossaryId : null;
}

export function defaultGlossaryForTeam(team = selectedTeam()) {
  const defaultGlossaryId = activeDefaultGlossaryIdForTeam(team);
  if (!defaultGlossaryId) {
    return null;
  }

  return state.glossaries.find((item) => item?.id === defaultGlossaryId) ?? null;
}

export function makeGlossaryDefault(render, glossaryId) {
  const glossary = state.glossaries.find((item) =>
    item?.id === glossaryId && item.lifecycleState !== "deleted"
  );
  if (!glossary) {
    showNoticeBadge("Could not find the selected glossary.", render);
    return;
  }

  const team = selectedTeam();
  if (!team) {
    showNoticeBadge("Could not determine the selected team.", render);
    return;
  }

  saveStoredDefaultGlossaryIdForTeam(team, glossary.id);
  showNoticeBadge(`${glossary.title ?? "Glossary"} is now the default glossary.`, render);
}

export function makeGlossaryDefaultIfFirst(team, glossaryId) {
  const activeGlossaries = activeGlossariesExcept();
  const onlyGlossary = activeGlossaries[0] ?? null;
  if (activeGlossaries.length !== 1 || onlyGlossary?.id !== glossaryId) {
    return false;
  }

  saveStoredDefaultGlossaryIdForTeam(team, glossaryId);
  return true;
}

export function updateDefaultGlossaryAfterDeletion(team, deletedGlossaryId) {
  const currentDefaultGlossaryId = loadStoredDefaultGlossaryIdForTeam(team);
  if (currentDefaultGlossaryId !== deletedGlossaryId) {
    return null;
  }

  const nextDefault = defaultGlossaryCandidateAfterDeletion(deletedGlossaryId);
  if (!nextDefault) {
    removeStoredDefaultGlossaryIdForTeam(team);
    return null;
  }

  saveStoredDefaultGlossaryIdForTeam(team, nextDefault.id);
  return nextDefault;
}
