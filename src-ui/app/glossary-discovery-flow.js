import { createGlossaryDiscoveryState, state } from "./state.js";
import { createRepoResourceDiscoveryFlow } from "./repo-resource/discovery-flow.js";
import {
  applyGlossariesQueryDataForTeam,
  currentGlossaryTeam,
  selectedGlossaryTeamMatches,
} from "./glossary-top-level-state.js";
import {
  createGlossariesQueryOptions,
  ensureGlossariesQueryObserver,
  seedGlossariesQueryFromCache,
  seedGlossariesQueryFromLocal,
} from "./glossary-query.js";

const glossaryDiscoveryFlow = createRepoResourceDiscoveryFlow({
  collectionField: "glossaries",
  selectedIdField: "selectedGlossaryId",
  pageField: "glossariesPage",
  discoveryField: "glossaryDiscovery",
  createDiscoveryState: createGlossaryDiscoveryState,
  badgeScope: "glossaries",
  pluralNoun: "glossaries",
  resetRepoSyncState: () => {
    state.glossaryRepoSyncByRepoName = {};
  },
  currentTeam: currentGlossaryTeam,
  selectedTeamMatches: selectedGlossaryTeamMatches,
  applyQueryDataForTeam: applyGlossariesQueryDataForTeam,
  createQueryOptions: createGlossariesQueryOptions,
  ensureQueryObserver: ensureGlossariesQueryObserver,
  seedQueryFromCache: seedGlossariesQueryFromCache,
  seedQueryFromLocal: seedGlossariesQueryFromLocal,
});

export const primeGlossariesLoadingState = glossaryDiscoveryFlow.primeLoadingState;
export const loadTeamGlossaries = glossaryDiscoveryFlow.loadTeam;
