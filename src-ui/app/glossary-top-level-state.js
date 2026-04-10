import { saveStoredGlossariesForTeam } from "./glossary-cache.js";
import { normalizeGlossarySummary, sortGlossaries } from "./glossary-shared.js";
import { state } from "./state.js";

export function glossarySnapshotFromList(glossaries = []) {
  const normalized = sortGlossaries(
    (Array.isArray(glossaries) ? glossaries : [])
      .map(normalizeGlossarySummary)
      .filter(Boolean),
  );
  return {
    items: normalized.filter((glossary) => glossary.lifecycleState !== "deleted"),
    deletedItems: normalized.filter((glossary) => glossary.lifecycleState === "deleted"),
  };
}

export function applyGlossarySnapshotToState(
  snapshot,
  { teamId = state.selectedTeamId, fallbackToFirstActive = true } = {},
) {
  if (state.selectedTeamId !== teamId) {
    return;
  }

  const nextGlossaries = sortGlossaries([
    ...(Array.isArray(snapshot?.items) ? snapshot.items : []),
    ...(Array.isArray(snapshot?.deletedItems) ? snapshot.deletedItems : []),
  ]);
  const normalizedGlossaries = nextGlossaries
    .map(normalizeGlossarySummary)
    .filter(Boolean);
  state.glossaries = normalizedGlossaries;
  if (
    fallbackToFirstActive
    && !normalizedGlossaries.some(
      (glossary) => glossary.lifecycleState !== "deleted" && glossary.id === state.selectedGlossaryId,
    )
  ) {
    state.selectedGlossaryId =
      normalizedGlossaries.find((glossary) => glossary.lifecycleState !== "deleted")?.id ?? null;
  }
  if (!normalizedGlossaries.some((glossary) => glossary.lifecycleState === "deleted")) {
    state.showDeletedGlossaries = false;
  }
}

export function persistGlossariesForTeam(team) {
  saveStoredGlossariesForTeam(team, state.glossaries);
}

export function removeGlossaryFromState(glossaryId, repoName) {
  state.glossaries = (Array.isArray(state.glossaries) ? state.glossaries : []).filter((glossary) =>
    glossary?.id !== glossaryId && glossary?.repoName !== repoName
  );
  if (state.selectedGlossaryId === glossaryId) {
    state.selectedGlossaryId = null;
  }
  if (state.glossaryEditor?.glossaryId === glossaryId || state.glossaryEditor?.repoName === repoName) {
    state.glossaryEditor = {
      ...state.glossaryEditor,
      glossaryId: null,
      repoName: "",
      status: "idle",
      error: "",
      terms: [],
    };
  }
}
