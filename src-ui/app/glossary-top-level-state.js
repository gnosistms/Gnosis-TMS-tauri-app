import { saveStoredGlossariesForTeam } from "./glossary-cache.js";
import {
  applyGlossariesQuerySnapshotToState,
  createGlossariesQuerySnapshot,
  persistGlossariesQueryDataForTeam,
  preserveGlossaryLifecyclePatchesInSnapshot,
  upsertGlossaryQueryData,
} from "./glossary-query.js";
import { syncGlossaryReposForTeam, teamSupportsGlossaryRepos } from "./glossary-repo-flow.js";
import { normalizeGlossarySummary, selectedTeam, sortGlossaries } from "./glossary-shared.js";
import { glossaryKeys } from "./query-client.js";
import { createRepoResourceTopLevelState } from "./repo-resource/top-level-state.js";

const glossaryTopLevelState = createRepoResourceTopLevelState({
  identity: {
    collectionField: "glossaries",
    selectedIdField: "selectedGlossaryId",
    editorField: "glossaryEditor",
    queryKeys: glossaryKeys,
  },
  normalizeSummary: normalizeGlossarySummary,
  sortSummaries: sortGlossaries,
  createQuerySnapshot(appState) {
    return createGlossariesQuerySnapshot({
      glossaries: appState.glossaries,
      status: appState.glossaryDiscovery?.status,
      brokerWarning: appState.glossaryDiscovery?.brokerWarning,
      recoveryMessage: appState.glossaryDiscovery?.recoveryMessage,
      error: appState.glossaryDiscovery?.error,
    });
  },
  selectedTeam,
  saveStoredForTeam: saveStoredGlossariesForTeam,
  applyQuerySnapshotToState: applyGlossariesQuerySnapshotToState,
  persistQueryDataForTeam: persistGlossariesQueryDataForTeam,
  preserveLifecyclePatchesInSnapshot: preserveGlossaryLifecyclePatchesInSnapshot,
  upsertQueryData: upsertGlossaryQueryData,
  teamSupportsRepos: teamSupportsGlossaryRepos,
  syncReposForTeam: syncGlossaryReposForTeam,
});

export function currentGlossaryTeam() {
  return glossaryTopLevelState.currentTeam();
}

export function selectedGlossaryTeamMatches(team) {
  return glossaryTopLevelState.selectedTeamMatches(team);
}

export function glossarySnapshotFromList(glossaries = []) {
  return glossaryTopLevelState.snapshotFromList(glossaries);
}

export function applyGlossarySnapshotToState(snapshot, options = {}) {
  return glossaryTopLevelState.applySnapshotToState(snapshot, options);
}

export function persistGlossariesForTeam(team) {
  return glossaryTopLevelState.persistForTeam(team);
}

export function ensureGlossariesQueryDataForTeam(team) {
  return glossaryTopLevelState.ensureQueryDataForTeam(team);
}

export function applyGlossariesQueryDataForTeam(team, queryData, render, options = {}) {
  return glossaryTopLevelState.applyQueryDataForTeam(team, queryData, render, options);
}

export function upsertGlossaryForTeam(team, glossary, render, options = {}) {
  return glossaryTopLevelState.upsertForTeam(team, glossary, render, options);
}

export function removeGlossaryFromState(glossaryId, repoName) {
  return glossaryTopLevelState.removeFromState(glossaryId, repoName);
}

export function repoBackedGlossaryInput(team, glossary) {
  return glossaryTopLevelState.repoBackedInput(team, glossary);
}

export function triggerGlossaryRepoSync(team, glossaryOrRepo) {
  return glossaryTopLevelState.triggerRepoSync(team, glossaryOrRepo);
}
