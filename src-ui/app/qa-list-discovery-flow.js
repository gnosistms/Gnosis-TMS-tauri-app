import { createQaListDiscoveryState } from "./state.js";
import { createRepoResourceDiscoveryFlow } from "./repo-resource/discovery-flow.js";
import {
  applyQaListsQueryDataForTeam,
  currentQaListTeam,
  selectedQaListTeamMatches,
} from "./qa-list-top-level-state.js";
import {
  createQaListsQueryOptions,
  ensureQaListsQueryObserver,
  seedQaListsQueryFromCache,
  seedQaListsQueryFromLocal,
} from "./qa-list-query.js";

const qaListDiscoveryFlow = createRepoResourceDiscoveryFlow({
  collectionField: "qaLists",
  selectedIdField: "selectedQaListId",
  pageField: "qaListsPage",
  discoveryField: "qaListDiscovery",
  createDiscoveryState: createQaListDiscoveryState,
  badgeScope: "qa",
  pluralNoun: "QA lists",
  // QA does not track per-repo sync status in discovery (R4 residue — glossary-only).
  resetRepoSyncState: () => {},
  currentTeam: currentQaListTeam,
  selectedTeamMatches: selectedQaListTeamMatches,
  applyQueryDataForTeam: applyQaListsQueryDataForTeam,
  createQueryOptions: createQaListsQueryOptions,
  ensureQueryObserver: ensureQaListsQueryObserver,
  seedQueryFromCache: seedQaListsQueryFromCache,
  seedQueryFromLocal: seedQaListsQueryFromLocal,
});

export const primeQaListsLoadingState = qaListDiscoveryFlow.primeLoadingState;
export const loadTeamQaLists = qaListDiscoveryFlow.loadTeam;
