import { saveStoredGlossariesForTeam } from "./glossary-cache.js";
import { normalizeGlossarySummary, sortGlossaries } from "./glossary-shared.js";
import { state } from "./state.js";
import {
  applyTopLevelResourceMutation,
  rollbackTopLevelResourceMutation,
} from "./resource-top-level-mutations.js";

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

export function glossarySnapshotFromState() {
  return glossarySnapshotFromList(state.glossaries);
}

function normalizeGlossarySnapshot(snapshot) {
  return glossarySnapshotFromList([
    ...(Array.isArray(snapshot?.items) ? snapshot.items : []),
    ...(Array.isArray(snapshot?.deletedItems) ? snapshot.deletedItems : []),
  ]);
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
}

function glossaryMutationResourceId(mutation) {
  if (typeof mutation?.resourceId === "string" && mutation.resourceId.trim()) {
    return mutation.resourceId.trim();
  }
  if (typeof mutation?.glossaryId === "string" && mutation.glossaryId.trim()) {
    return mutation.glossaryId.trim();
  }
  return "";
}

export function applyGlossaryPendingMutation(snapshot, mutation) {
  return applyTopLevelResourceMutation(snapshot, mutation, {
    getMutationResourceId: glossaryMutationResourceId,
    markDeleted: (glossary) => ({
      ...glossary,
      lifecycleState: "deleted",
    }),
    markActive: (glossary) => ({
      ...glossary,
      lifecycleState: "active",
    }),
    renameResource: (glossary, nextMutation) => ({
      ...glossary,
      title: nextMutation.title,
    }),
    normalizeSnapshot: normalizeGlossarySnapshot,
  });
}

export function rollbackVisibleGlossaryMutation(mutation) {
  const snapshot = rollbackTopLevelResourceMutation(
    glossarySnapshotFromState(),
    mutation,
    applyGlossaryPendingMutation,
    {
      getMutationResourceId: glossaryMutationResourceId,
    },
  );
  applyGlossarySnapshotToState(snapshot, { fallbackToFirstActive: false });
}
