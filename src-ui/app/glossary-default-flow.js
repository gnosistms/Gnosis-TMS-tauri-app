import {
  createGlossaryDefaultState,
  state,
} from "./state.js";
import {
  loadStoredDefaultGlossaryIdForTeam,
  saveStoredDefaultGlossaryIdForTeam,
} from "./glossary-default-cache.js";
import { selectedTeam } from "./glossary-shared.js";
import { showNoticeBadge } from "./status-feedback.js";

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

export function openGlossaryDefaultModal(render, glossaryId) {
  const glossary = state.glossaries.find((item) =>
    item?.id === glossaryId && item.lifecycleState !== "deleted"
  );
  if (!glossary) {
    showNoticeBadge("Could not find the selected glossary.", render);
    return;
  }

  state.glossaryDefault = {
    ...createGlossaryDefaultState(),
    isOpen: true,
    glossaryId: glossary.id,
    glossaryName: glossary.title ?? "",
  };
  render();
}

export function cancelGlossaryDefaultModal(render) {
  state.glossaryDefault = createGlossaryDefaultState();
  render();
}

export function confirmGlossaryDefault(render) {
  if (!state.glossaryDefault?.isOpen) {
    return;
  }

  const team = selectedTeam();
  const glossaryId = state.glossaryDefault.glossaryId;
  const glossary = state.glossaries.find((item) =>
    item?.id === glossaryId && item.lifecycleState !== "deleted"
  );
  if (!team || !glossary) {
    state.glossaryDefault = {
      ...state.glossaryDefault,
      status: "idle",
      error: "Could not find the selected glossary.",
    };
    render();
    return;
  }

  saveStoredDefaultGlossaryIdForTeam(team, glossary.id);
  state.glossaryDefault = createGlossaryDefaultState();
  showNoticeBadge(`${glossary.title ?? "Glossary"} is now the default glossary.`, render);
}
