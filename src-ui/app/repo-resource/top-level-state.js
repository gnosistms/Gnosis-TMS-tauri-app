import { queryClient } from "../query-client.js";
import { setResourcePageDataOwner } from "../resource-page-controller.js";
import { state } from "../state.js";
import { teamCacheKey } from "../team-cache.js";

function capitalize(value) {
  const text = String(value ?? "");
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "";
}

function resourceIdFieldFromSelectedIdField(selectedIdField) {
  const text = String(selectedIdField ?? "");
  const withoutPrefix = text.startsWith("selected") ? text.slice("selected".length) : text;
  return withoutPrefix ? `${withoutPrefix.charAt(0).toLowerCase()}${withoutPrefix.slice(1)}` : "";
}

function pageFieldFromCollectionField(collectionField) {
  return `${collectionField}Page`;
}

function showDeletedFieldFromCollectionField(collectionField) {
  return `showDeleted${capitalize(collectionField)}`;
}

export function createRepoResourceTopLevelState(descriptor) {
  const {
    identity,
    normalizeSummary,
    sortSummaries,
    createQuerySnapshot,
    selectedTeam,
    saveStoredForTeam,
    applyQuerySnapshotToState,
    persistQueryDataForTeam,
    preserveLifecyclePatchesInSnapshot,
    upsertQueryData,
    teamSupportsRepos,
    syncReposForTeam,
  } = descriptor;
  const {
    collectionField,
    selectedIdField,
    editorField,
    queryKeys,
  } = identity;
  const pageField = pageFieldFromCollectionField(collectionField);
  const showDeletedField = showDeletedFieldFromCollectionField(collectionField);
  const resourceIdField = resourceIdFieldFromSelectedIdField(selectedIdField);

  function currentTeam() {
    return selectedTeam();
  }

  function selectedTeamMatches(team) {
    const selected = currentTeam();
    return Boolean(
      team
        && selected
        && selected.id === team.id
        && selected.installationId === team.installationId,
    );
  }

  function snapshotFromList(resources = []) {
    const normalized = sortSummaries(
      (Array.isArray(resources) ? resources : [])
        .map(normalizeSummary)
        .filter(Boolean),
    );
    return {
      items: normalized.filter((resource) => resource.lifecycleState !== "deleted"),
      deletedItems: normalized.filter((resource) => resource.lifecycleState === "deleted"),
    };
  }

  function applySnapshotToState(
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

    const nextResources = sortSummaries([
      ...(Array.isArray(snapshot?.items) ? snapshot.items : []),
      ...(Array.isArray(snapshot?.deletedItems) ? snapshot.deletedItems : []),
    ]);
    const normalizedResources = nextResources
      .map(normalizeSummary)
      .filter(Boolean);
    state[collectionField] = normalizedResources;
    const team = state.teams.find((item) => item?.id === teamId);
    setResourcePageDataOwner(state[pageField], {
      teamId,
      cacheKey: cacheKey ?? teamCacheKey(team),
      cacheUpdatedAt,
    });
    if (
      fallbackToFirstActive
      && !normalizedResources.some(
        (resource) => resource.lifecycleState !== "deleted" && resource.id === state[selectedIdField],
      )
    ) {
      state[selectedIdField] =
        normalizedResources.find((resource) => resource.lifecycleState !== "deleted")?.id ?? null;
    }
    if (!normalizedResources.some((resource) => resource.lifecycleState === "deleted")) {
      state[showDeletedField] = false;
    }
  }

  function persistForTeam(team) {
    saveStoredForTeam(team, state[collectionField]);
  }

  function removeFromState(resourceId, repoName) {
    state[collectionField] = (Array.isArray(state[collectionField]) ? state[collectionField] : [])
      .filter((resource) => resource?.id !== resourceId && resource?.repoName !== repoName);
    if (state[selectedIdField] === resourceId) {
      state[selectedIdField] = null;
    }
    if (state[editorField]?.[resourceIdField] === resourceId || state[editorField]?.repoName === repoName) {
      state[editorField] = {
        ...state[editorField],
        [resourceIdField]: null,
        repoName: "",
        status: "idle",
        error: "",
        terms: [],
      };
    }
  }

  function ensureQueryDataForTeam(team) {
    if (!team?.id) {
      return null;
    }
    const queryKey = queryKeys.byTeam(team.id);
    let queryData = queryClient.getQueryData(queryKey);
    if (!queryData) {
      queryData = createQuerySnapshot(state);
      queryClient.setQueryData(queryKey, queryData);
    }
    return queryData;
  }

  function applyQueryDataForTeam(team, queryData, render, { isFetching = false } = {}) {
    if (!team?.id || !queryData) {
      return null;
    }
    const queryKey = queryKeys.byTeam(team.id);
    const reconciledQueryData = preserveLifecyclePatchesInSnapshot(
      queryData,
      queryClient.getQueryData(queryKey),
    );
    queryClient.setQueryData(queryKey, reconciledQueryData);
    applyQuerySnapshotToState(reconciledQueryData, {
      teamId: team.id,
      isFetching,
    });
    persistQueryDataForTeam(team, reconciledQueryData);
    render?.();
    return reconciledQueryData;
  }

  function upsertForTeam(team, resource, render, options = {}) {
    const currentQueryData = ensureQueryDataForTeam(team);
    const existingResources = Array.isArray(currentQueryData?.[collectionField])
      ? currentQueryData[collectionField]
      : [];
    const normalizedResource = normalizeSummary(resource);
    const shouldPreserveCreate =
      options.preserveCreate === true
      && normalizedResource
      && !existingResources.some((item) => item?.id === normalizedResource.id);
    const nextQueryData = upsertQueryData(currentQueryData, {
      ...resource,
      ...(shouldPreserveCreate
        ? {
            localLifecycleIntent: "create",
            pendingMutation: null,
          }
        : {}),
    });
    return applyQueryDataForTeam(team, nextQueryData, render);
  }

  function repoBackedInput(team, resource) {
    return {
      installationId: team.installationId,
      repoName: resource.repoName,
      [resourceIdField]: resource.id,
    };
  }

  function triggerRepoSync(team, resourceOrRepo) {
    if (!teamSupportsRepos(team)) {
      return;
    }

    const repo = resourceOrRepo?.fullName
      ? {
          [resourceIdField]: resourceOrRepo.id ?? resourceOrRepo[resourceIdField] ?? null,
          name: resourceOrRepo.repoName ?? resourceOrRepo.name,
          fullName: resourceOrRepo.fullName,
          repoId: Number.isFinite(resourceOrRepo.repoId) ? resourceOrRepo.repoId : null,
          defaultBranchName: resourceOrRepo.defaultBranchName || "main",
          defaultBranchHeadOid: resourceOrRepo.defaultBranchHeadOid || null,
        }
      : null;
    if (!repo?.name || !repo.fullName) {
      return;
    }

    void syncReposForTeam(team, [repo]).catch(() => null);
  }

  return {
    currentTeam,
    selectedTeamMatches,
    snapshotFromList,
    applySnapshotToState,
    persistForTeam,
    removeFromState,
    ensureQueryDataForTeam,
    applyQueryDataForTeam,
    upsertForTeam,
    repoBackedInput,
    triggerRepoSync,
  };
}
