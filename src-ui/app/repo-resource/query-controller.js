import { queryClient, subscribeQueryObserver } from "../query-client.js";
import { showNoticeBadge } from "../status-feedback.js";
import { teamCacheKey } from "../team-cache.js";

function collectionItems(snapshot, collectionField) {
  return Array.isArray(snapshot?.[collectionField]) ? snapshot[collectionField] : [];
}

function resourceId(resource, config) {
  return config.resourceId?.(resource) ?? resource?.id ?? null;
}

function removeResourceFromQueryData(queryData, config, id) {
  if (!queryData || typeof queryData !== "object") {
    return queryData;
  }
  const items = collectionItems(queryData, config.collectionField);
  const nextItems = items.filter((item) => resourceId(item, config) !== id);
  return nextItems.length === items.length
    ? queryData
    : {
      ...queryData,
      [config.collectionField]: nextItems,
    };
}

function createLifecycleMutationPayload(config, {
  team,
  resource,
  mutationType,
  optimisticData,
}) {
  const id = resourceId(resource, config);
  if (typeof config.createLifecycleMutationPayload === "function") {
    return config.createLifecycleMutationPayload({
      team,
      resource,
      mutationType,
      optimisticData,
      resourceId: id,
    });
  }
  const payload = {
    type: mutationType,
    resourceId: id,
    [config.resourceIdField ?? "resourceId"]: id,
  };
  if (mutationType === "rename") {
    payload.title = optimisticData.title;
    payload.previousTitle = resource?.title;
  }
  return payload;
}

export function createRepoResourceQueryController(config) {
  let activeQuerySubscription = null;

  function selectedTeamId() {
    return config.getSelectedTeamId?.() ?? null;
  }

  function queryKeyForTeam(teamId) {
    return config.queryKeyForTeam(teamId);
  }

  function prepareSnapshot(snapshot, previousQueryData) {
    const overlaidSnapshot = config.applyWriteIntentOverlay
      ? config.applyWriteIntentOverlay(snapshot)
      : snapshot;
    return config.preserveSnapshot
      ? config.preserveSnapshot(overlaidSnapshot, previousQueryData)
      : overlaidSnapshot;
  }

  function applySnapshot(snapshot, options = {}) {
    return config.applySnapshotToState(snapshot, options);
  }

  function setRefreshing(isRefreshing) {
    config.setRefreshing?.(isRefreshing === true);
  }

  function resetObserver() {
    activeQuerySubscription?.unsubscribe?.();
    activeQuerySubscription?.observer?.destroy?.();
    activeQuerySubscription = null;
  }

  function seedFromCache(team, {
    teamId = team?.id,
    render,
    loadCacheEntry,
  } = {}) {
    const expectedCacheKey = (config.cacheKeyForTeam ?? teamCacheKey)(team);
    const cacheEntry = (loadCacheEntry ?? config.loadCacheEntry)?.(team);
    if (
      selectedTeamId() !== teamId
      || !cacheEntry?.exists
      || cacheEntry.cacheKey !== expectedCacheKey
    ) {
      return null;
    }

    const queryKey = queryKeyForTeam(teamId);
    const previousQueryData = queryClient.getQueryData(queryKey);
    const items = config.cacheEntryItems
      ? config.cacheEntryItems(cacheEntry)
      : collectionItems(cacheEntry, config.collectionField);
    const snapshot = prepareSnapshot(config.createSnapshot({
      [config.collectionField]: items,
      ...(config.cacheSnapshotInput?.(cacheEntry) ?? { status: "ready" }),
    }), previousQueryData);

    queryClient.setQueryData(queryKey, snapshot);
    applySnapshot(snapshot, {
      teamId,
      isFetching: true,
      cacheKey: expectedCacheKey,
      cacheUpdatedAt: cacheEntry.updatedAt ?? null,
    });
    render?.();
    return snapshot;
  }

  async function seedFromLocal(team, {
    teamId = team?.id,
    render,
    persist = true,
  } = {}) {
    if (config.canSeedFromLocal && !config.canSeedFromLocal(team, { teamId })) {
      return null;
    }
    if (selectedTeamId() !== teamId) {
      return null;
    }

    const localItems = await config.loadLocalItems(team);
    if (!Array.isArray(localItems) || localItems.length === 0 || selectedTeamId() !== teamId) {
      return null;
    }

    const queryKey = queryKeyForTeam(teamId);
    const previousQueryData = queryClient.getQueryData(queryKey);
    const snapshot = prepareSnapshot(config.createSnapshot({
      [config.collectionField]: localItems,
      ...(config.localSnapshotInput?.(localItems) ?? { status: "ready" }),
    }), previousQueryData);

    queryClient.setQueryData(queryKey, snapshot);
    applySnapshot(snapshot, {
      teamId,
      isFetching: true,
      cacheKey: (config.cacheKeyForTeam ?? teamCacheKey)(team),
    });
    if (persist) {
      config.persistSnapshot?.(team, snapshot);
    }
    render?.();
    return snapshot;
  }

  function createQueryOptions(team, options = {}) {
    const teamId = options.teamId ?? team?.id ?? null;
    const queryKey = queryKeyForTeam(teamId);
    return {
      queryKey,
      queryFn: async () => {
        const nextSnapshot = await config.loadRemoteSnapshot(team, {
          ...options,
          teamId,
          queryClient,
          queryKey,
        });
        return prepareSnapshot(nextSnapshot, queryClient.getQueryData(queryKey));
      },
    };
  }

  function ensureObserver(render, team, options = {}) {
    const teamId = options.teamId ?? team?.id ?? null;
    const queryKey = queryKeyForTeam(teamId);
    const currentKey = JSON.stringify(queryKey);
    if (activeQuerySubscription?.key === currentKey) {
      activeQuerySubscription.observer?.setOptions?.(
        createQueryOptions(team, {
          ...options,
          teamId,
          render,
        }),
      );
      return activeQuerySubscription;
    }

    activeQuerySubscription?.unsubscribe?.();
    const subscription = subscribeQueryObserver(
      createQueryOptions(team, {
        ...options,
        teamId,
        render,
      }),
      (result) => {
        if (result.data) {
          applySnapshot(result.data, {
            teamId,
            isFetching: result.isFetching,
          });
        } else if (result.error && selectedTeamId() === teamId) {
          if (typeof config.applyObserverError === "function") {
            config.applyObserverError(result.error, {
              teamId,
              isFetching: result.isFetching,
            });
          } else {
            setRefreshing(result.isFetching);
          }
        } else if (selectedTeamId() === teamId) {
          setRefreshing(result.isFetching);
        }
        render?.();
      },
    );

    activeQuerySubscription = {
      ...subscription,
      key: currentKey,
      teamId,
    };
    return activeQuerySubscription;
  }

  async function invalidateAfterMutation(team, options = {}) {
    const teamId = options.teamId ?? team?.id ?? null;
    const queryKey = queryKeyForTeam(teamId);
    const query = queryClient.getQueryCache().find({ queryKey });
    const hasActiveObserver = typeof query?.getObserversCount === "function"
      ? query.getObserversCount() > 0
      : false;

    await queryClient.invalidateQueries({
      queryKey,
      refetchType: hasActiveObserver ? "active" : "none",
    });

    if (!hasActiveObserver && options.refetchIfInactive !== false) {
      await queryClient.fetchQuery(createQueryOptions(team, {
        ...options,
        teamId,
      }));
    }
  }

  function patchOrMove(queryData, id, patch, lifecycleState = null) {
    return config.patchQueryData(queryData, id, {
      ...patch,
      ...(lifecycleState ? { lifecycleState } : {}),
    });
  }

  function createLifecycleMutationOptions({
    team,
    resource,
    mutationType,
    optimisticData = {},
    settledData = {},
    commitMutation,
    onOptimisticApplied,
    onSuccessApplied,
    onErrorApplied,
    render,
  } = {}) {
    const teamId = team?.id ?? null;
    const id = resourceId(resource, config);
    const queryKey = queryKeyForTeam(teamId);
    return {
      mutationKey: [config.kind, mutationType, id],
      scope: { id: config.mutationScope?.(team) ?? `team-metadata:${team?.installationId ?? "unknown"}` },
      mutationFn: async () => {
        if (typeof commitMutation !== "function") {
          return null;
        }
        return commitMutation(team, createLifecycleMutationPayload(config, {
          team,
          resource,
          mutationType,
          optimisticData,
        }));
      },
      onMutate: async () => {
        await queryClient.cancelQueries({ queryKey });
        const previousQueryData = queryClient.getQueryData(queryKey);
        let optimisticQueryData = previousQueryData;
        if (mutationType === "softDelete") {
          optimisticQueryData = patchOrMove(previousQueryData, id, optimisticData, "deleted");
        } else if (mutationType === "restore") {
          optimisticQueryData = patchOrMove(previousQueryData, id, optimisticData, "active");
        } else if (mutationType === "permanentDelete") {
          optimisticQueryData = removeResourceFromQueryData(previousQueryData, config, id);
        } else {
          optimisticQueryData = config.patchQueryData(previousQueryData, id, optimisticData);
        }
        if (optimisticQueryData) {
          queryClient.setQueryData(queryKey, optimisticQueryData);
          applySnapshot(optimisticQueryData, {
            teamId,
            isFetching: config.isRefreshing?.() === true,
          });
        }
        onOptimisticApplied?.(optimisticQueryData);
        render?.();
        return { previousQueryData };
      },
      onError: (error, _variables, context) => {
        if (context?.previousQueryData) {
          queryClient.setQueryData(queryKey, context.previousQueryData);
          applySnapshot(context.previousQueryData, {
            teamId,
            isFetching: config.isRefreshing?.() === true,
          });
        }
        onErrorApplied?.(error, context);
        if (typeof render === "function") {
          (config.showNoticeBadge ?? showNoticeBadge)(error?.message ?? String(error), render);
        }
        render?.();
      },
      onSuccess: (result) => {
        const currentQueryData = queryClient.getQueryData(queryKey);
        const resultPatch = config.normalizeMutationResultPatch?.(resource, result);
        let settledQueryData = currentQueryData;
        if (mutationType === "softDelete") {
          settledQueryData = patchOrMove(currentQueryData, id, {
            ...settledData,
            ...(resultPatch ?? {}),
            lifecycleState: "deleted",
          }, "deleted");
        } else if (mutationType === "restore") {
          settledQueryData = patchOrMove(currentQueryData, id, {
            ...settledData,
            ...(resultPatch ?? {}),
            lifecycleState: "active",
          }, "active");
        } else if (mutationType === "permanentDelete") {
          settledQueryData = removeResourceFromQueryData(currentQueryData, config, id);
        } else {
          settledQueryData = config.patchQueryData(currentQueryData, id, {
            ...settledData,
            ...(resultPatch ?? {}),
          });
        }
        if (settledQueryData) {
          queryClient.setQueryData(queryKey, settledQueryData);
          applySnapshot(settledQueryData, {
            teamId,
            isFetching: config.isRefreshing?.() === true,
          });
        }
        onSuccessApplied?.(settledQueryData, result);
        render?.();
      },
      onSettled: async () => {
        await invalidateAfterMutation(team, {
          teamId,
          render,
          refetchIfInactive: false,
        });
      },
    };
  }

  return {
    resetObserver,
    seedFromCache,
    seedFromLocal,
    createQueryOptions,
    ensureObserver,
    invalidateAfterMutation,
    createLifecycleMutationOptions,
  };
}
