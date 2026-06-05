import { saveStoredGlossariesForTeam } from "./glossary-cache.js";
import {
  applyGlossariesQuerySnapshotToState,
  createGlossariesQuerySnapshot,
  persistGlossariesQueryDataForTeam,
  preserveGlossaryLifecyclePatchesInSnapshot,
  upsertGlossaryQueryData,
} from "./glossary-query.js";
import { syncGlossaryReposForTeam, teamSupportsGlossaryRepos } from "./glossary-repo-flow.js";
import { glossaryKeys, queryClient } from "./query-client.js";
import { normalizeGlossarySummary, selectedTeam, sortGlossaries } from "./glossary-shared.js";
import { setResourcePageDataOwner } from "./resource-page-controller.js";
import { state } from "./state.js";
import { teamCacheKey } from "./team-cache.js";

export function currentGlossaryTeam() {
  return selectedTeam();
}

export function selectedGlossaryTeamMatches(team) {
  const selected = currentGlossaryTeam();
  return Boolean(
    team
      && selected
      && selected.id === team.id
      && selected.installationId === team.installationId,
  );
}

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
  {
    teamId = state.selectedTeamId,
    fallbackToFirstActive = true,
    cacheKey,
    cacheUpdatedAt = null,
  } = {},
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
  const team = state.teams.find((item) => item?.id === teamId);
  setResourcePageDataOwner(state.glossariesPage, {
    teamId,
    cacheKey: cacheKey ?? teamCacheKey(team),
    cacheUpdatedAt,
  });
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

export function ensureGlossariesQueryDataForTeam(team) {
  if (!team?.id) {
    return null;
  }
  const queryKey = glossaryKeys.byTeam(team.id);
  let queryData = queryClient.getQueryData(queryKey);
  if (!queryData) {
    queryData = createGlossariesQuerySnapshot({
      glossaries: state.glossaries,
      status: state.glossaryDiscovery?.status,
      brokerWarning: state.glossaryDiscovery?.brokerWarning,
      recoveryMessage: state.glossaryDiscovery?.recoveryMessage,
      error: state.glossaryDiscovery?.error,
    });
    queryClient.setQueryData(queryKey, queryData);
  }
  return queryData;
}

export function applyGlossariesQueryDataForTeam(team, queryData, render, { isFetching = false } = {}) {
  if (!team?.id || !queryData) {
    return null;
  }
  const queryKey = glossaryKeys.byTeam(team.id);
  const reconciledQueryData = preserveGlossaryLifecyclePatchesInSnapshot(
    queryData,
    queryClient.getQueryData(queryKey),
  );
  queryClient.setQueryData(queryKey, reconciledQueryData);
  applyGlossariesQuerySnapshotToState(reconciledQueryData, {
    teamId: team.id,
    isFetching,
  });
  persistGlossariesQueryDataForTeam(team, reconciledQueryData);
  render?.();
  return reconciledQueryData;
}

export function upsertGlossaryForTeam(team, glossary, render, options = {}) {
  const currentQueryData = ensureGlossariesQueryDataForTeam(team);
  const existingGlossaries = Array.isArray(currentQueryData?.glossaries) ? currentQueryData.glossaries : [];
  const normalizedGlossary = normalizeGlossarySummary(glossary);
  const shouldPreserveCreate =
    options.preserveCreate === true
    && normalizedGlossary
    && !existingGlossaries.some((item) => item?.id === normalizedGlossary.id);
  const nextQueryData = upsertGlossaryQueryData(currentQueryData, {
    ...glossary,
    ...(shouldPreserveCreate
      ? {
          localLifecycleIntent: "create",
          pendingMutation: null,
        }
      : {}),
  });
  return applyGlossariesQueryDataForTeam(team, nextQueryData, render);
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

export function repoBackedGlossaryInput(team, glossary) {
  return {
    installationId: team.installationId,
    repoName: glossary.repoName,
    glossaryId: glossary.id,
  };
}

export function triggerGlossaryRepoSync(team, glossaryOrRepo) {
  if (!teamSupportsGlossaryRepos(team)) {
    return;
  }

  const repo = glossaryOrRepo?.fullName
    ? {
        glossaryId: glossaryOrRepo.id ?? glossaryOrRepo.glossaryId ?? null,
        name: glossaryOrRepo.repoName ?? glossaryOrRepo.name,
        fullName: glossaryOrRepo.fullName,
        repoId: Number.isFinite(glossaryOrRepo.repoId) ? glossaryOrRepo.repoId : null,
        defaultBranchName: glossaryOrRepo.defaultBranchName || "main",
        defaultBranchHeadOid: glossaryOrRepo.defaultBranchHeadOid || null,
      }
    : null;
  if (!repo?.name || !repo.fullName) {
    return;
  }

  void syncGlossaryReposForTeam(team, [repo]).catch(() => null);
}
