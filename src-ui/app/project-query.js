import { applyPendingMutations } from "./optimistic-collection.js";
import { createMutationObserver, projectKeys, queryClient, subscribeQueryObserver } from "./query-client.js";
import { state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { applyProjectSnapshotToState } from "./project-top-level-state.js";
import {
  loadRepoBackedProjectsForTeam,
} from "./project-discovery-flow.js";

let activeProjectsQuerySubscription = null;

function createProjectDiscoverySnapshot(discovery = {}) {
  return {
    status:
      typeof discovery?.status === "string" && discovery.status.trim()
        ? discovery.status.trim()
        : "ready",
    error: typeof discovery?.error === "string" ? discovery.error : "",
    glossaryWarning:
      typeof discovery?.glossaryWarning === "string" ? discovery.glossaryWarning : "",
    recoveryMessage:
      typeof discovery?.recoveryMessage === "string" ? discovery.recoveryMessage : "",
  };
}

export function createProjectsQuerySnapshot({
  items = [],
  deletedItems = [],
  repoSyncByProjectId = {},
  glossaries = [],
  pendingChapterMutations = [],
  discovery = {},
} = {}) {
  return {
    snapshot: {
      items: Array.isArray(items) ? items : [],
      deletedItems: Array.isArray(deletedItems) ? deletedItems : [],
    },
    repoSyncByProjectId:
      repoSyncByProjectId && typeof repoSyncByProjectId === "object"
        ? repoSyncByProjectId
        : {},
    glossaries: Array.isArray(glossaries) ? glossaries : [],
    pendingChapterMutations: Array.isArray(pendingChapterMutations)
      ? pendingChapterMutations
      : [],
    discovery: createProjectDiscoverySnapshot(discovery),
  };
}

export function applyProjectsQuerySnapshotToState(snapshot, {
  teamId = state.selectedTeamId,
  isFetching = false,
  reconcileExpandedDeletedFiles,
} = {}) {
  if (state.selectedTeamId !== teamId) {
    return false;
  }

  if (snapshot) {
    applyProjectSnapshotToState(snapshot.snapshot, {
      reconcileExpandedDeletedFiles,
    });
    state.projectRepoSyncByProjectId =
      snapshot.repoSyncByProjectId && typeof snapshot.repoSyncByProjectId === "object"
        ? snapshot.repoSyncByProjectId
        : {};
    state.glossaries = Array.isArray(snapshot.glossaries) ? snapshot.glossaries : [];
    state.pendingChapterMutations = Array.isArray(snapshot.pendingChapterMutations)
      ? snapshot.pendingChapterMutations
      : [];
    state.projectDiscovery = createProjectDiscoverySnapshot(snapshot.discovery);
  }

  state.projectsPage.isRefreshing = isFetching === true;
  return true;
}

export function seedProjectsQueryFromCache(team, {
  teamId = team?.id,
  loadStoredProjectsForTeam,
  loadStoredChapterPendingMutations,
  applyChapterPendingMutation,
  reconcileExpandedDeletedFiles,
  render,
} = {}) {
  if (typeof loadStoredProjectsForTeam !== "function") {
    return null;
  }

  const cachedProjects = loadStoredProjectsForTeam(team);
  if (!cachedProjects?.exists) {
    return null;
  }

  const pendingChapterMutations =
    typeof loadStoredChapterPendingMutations === "function"
      ? loadStoredChapterPendingMutations(team)
      : [];
  const optimisticSnapshot =
    typeof applyChapterPendingMutation === "function"
      ? applyPendingMutations(
          {
            items: cachedProjects.projects,
            deletedItems: cachedProjects.deletedProjects,
          },
          pendingChapterMutations,
          applyChapterPendingMutation,
        )
      : {
          items: cachedProjects.projects,
          deletedItems: cachedProjects.deletedProjects,
        };

  const snapshot = createProjectsQuerySnapshot({
    ...optimisticSnapshot,
    pendingChapterMutations,
    discovery: {
      status: "ready",
      error: "",
      glossaryWarning: "",
      recoveryMessage: "",
    },
  });
  queryClient.setQueryData(projectKeys.byTeam(teamId), snapshot);
  applyProjectsQuerySnapshotToState(snapshot, {
    teamId,
    isFetching: true,
    reconcileExpandedDeletedFiles,
  });
  render?.();
  return snapshot;
}

function moveProjectToCollection(queryData, projectId, targetCollection, patch = {}) {
  if (!queryData || typeof queryData !== "object") {
    return queryData;
  }

  const items = Array.isArray(queryData.snapshot?.items) ? queryData.snapshot.items : [];
  const deletedItems = Array.isArray(queryData.snapshot?.deletedItems)
    ? queryData.snapshot.deletedItems
    : [];
  const allProjects = [...items, ...deletedItems];
  const project = allProjects.find((item) => item?.id === projectId);
  if (!project) {
    return queryData;
  }

  const patchedProject = {
    ...project,
    ...patch,
  };
  const nextItems = items.filter((item) => item?.id !== projectId);
  const nextDeletedItems = deletedItems.filter((item) => item?.id !== projectId);

  if (targetCollection === "deleted") {
    nextDeletedItems.push(patchedProject);
  } else {
    nextItems.push(patchedProject);
  }

  return {
    ...queryData,
    snapshot: {
      items: nextItems,
      deletedItems: nextDeletedItems,
    },
  };
}

function normalizeProjectSnapshotInput(snapshot) {
  const projectSnapshot = snapshot?.snapshot && typeof snapshot.snapshot === "object"
    ? snapshot.snapshot
    : snapshot;
  return {
    items: Array.isArray(projectSnapshot?.items) ? projectSnapshot.items : [],
    deletedItems: Array.isArray(projectSnapshot?.deletedItems) ? projectSnapshot.deletedItems : [],
  };
}

function projectLifecycleIntent(project) {
  if (typeof project?.pendingMutation === "string" && project.pendingMutation.trim()) {
    return project.pendingMutation.trim();
  }
  if (typeof project?.localLifecycleIntent === "string" && project.localLifecycleIntent.trim()) {
    return project.localLifecycleIntent.trim();
  }
  return "";
}

function moveProjectInPlainSnapshot(snapshot, projectId, targetCollection, patch = {}, fallbackProject = null) {
  const current = normalizeProjectSnapshotInput(snapshot);
  const project =
    [...current.items, ...current.deletedItems].find((item) => item?.id === projectId)
    ?? fallbackProject;
  if (!project) {
    return current;
  }

  const patchedProject = {
    ...project,
    ...patch,
  };
  const items = current.items.filter((item) => item?.id !== projectId);
  const deletedItems = current.deletedItems.filter((item) => item?.id !== projectId);

  if (targetCollection === "deleted") {
    deletedItems.push(patchedProject);
  } else {
    items.push(patchedProject);
  }

  return { items, deletedItems };
}

function patchProjectInPlainSnapshot(snapshot, projectId, patch) {
  const current = normalizeProjectSnapshotInput(snapshot);
  let changed = false;
  const patchProject = (project) => {
    if (project?.id !== projectId) {
      return project;
    }
    changed = true;
    return {
      ...project,
      ...patch,
    };
  };
  const items = current.items.map(patchProject);
  const deletedItems = current.deletedItems.map(patchProject);
  return changed ? { items, deletedItems } : current;
}

function projectLocation(snapshot, projectId) {
  const current = normalizeProjectSnapshotInput(snapshot);
  if (current.items.some((item) => item?.id === projectId)) {
    return "active";
  }
  if (current.deletedItems.some((item) => item?.id === projectId)) {
    return "deleted";
  }
  return "";
}

function projectTitleInSnapshot(snapshot, projectId) {
  const current = normalizeProjectSnapshotInput(snapshot);
  return [...current.items, ...current.deletedItems].find((item) => item?.id === projectId)?.title;
}

export function preserveProjectLifecyclePatchesInProjectSnapshot(nextSnapshot, previousSnapshot) {
  if (!nextSnapshot || typeof nextSnapshot !== "object") {
    return nextSnapshot;
  }

  const previousProjects = [
    ...normalizeProjectSnapshotInput(previousSnapshot).items,
    ...normalizeProjectSnapshotInput(previousSnapshot).deletedItems,
  ];
  const intentById = new Map(
    previousProjects
      .filter((project) => typeof project?.id === "string" && projectLifecycleIntent(project))
      .map((project) => [project.id, project]),
  );
  if (intentById.size === 0) {
    return normalizeProjectSnapshotInput(nextSnapshot);
  }

  let nextData = normalizeProjectSnapshotInput(nextSnapshot);
  for (const previousProject of intentById.values()) {
    const intent = projectLifecycleIntent(previousProject);
    const isPending = typeof previousProject?.pendingMutation === "string"
      && previousProject.pendingMutation.trim();

    if (intent === "softDelete") {
      if (!isPending && projectLocation(nextData, previousProject.id) === "deleted") {
        continue;
      }
      nextData = moveProjectInPlainSnapshot(nextData, previousProject.id, "deleted", {
        lifecycleState: previousProject.lifecycleState ?? "deleted",
        pendingMutation: isPending ? "softDelete" : null,
        localLifecycleIntent: "softDelete",
      }, previousProject);
      continue;
    }

    if (intent === "restore") {
      if (!isPending && projectLocation(nextData, previousProject.id) === "active") {
        continue;
      }
      nextData = moveProjectInPlainSnapshot(nextData, previousProject.id, "active", {
        lifecycleState: previousProject.lifecycleState ?? "active",
        pendingMutation: isPending ? "restore" : null,
        localLifecycleIntent: "restore",
      }, previousProject);
      continue;
    }

    if (intent === "rename") {
      if (!isPending && projectTitleInSnapshot(nextData, previousProject.id) === previousProject.title) {
        continue;
      }
      nextData = patchProjectInPlainSnapshot(nextData, previousProject.id, {
        title: previousProject.title,
        pendingMutation: isPending ? "rename" : null,
        localLifecycleIntent: "rename",
      });
    }
  }

  return nextData;
}

export function patchProjectQueryData(queryData, projectId, patch) {
  if (!queryData || typeof queryData !== "object") {
    return queryData;
  }

  let changed = false;
  const patchProject = (project) => {
    if (project?.id !== projectId) {
      return project;
    }
    changed = true;
    return {
      ...project,
      ...patch,
    };
  };
  const items = (Array.isArray(queryData.snapshot?.items) ? queryData.snapshot.items : [])
    .map(patchProject);
  const deletedItems = (Array.isArray(queryData.snapshot?.deletedItems) ? queryData.snapshot.deletedItems : [])
    .map(patchProject);

  return changed
    ? {
        ...queryData,
        snapshot: {
          items,
          deletedItems,
        },
      }
    : queryData;
}

export function preservePendingProjectLifecyclePatches(nextSnapshot, previousSnapshot) {
  if (!nextSnapshot || typeof nextSnapshot !== "object") {
    return nextSnapshot;
  }

  const preservedSnapshot = preserveProjectLifecyclePatchesInProjectSnapshot(
    nextSnapshot.snapshot,
    previousSnapshot,
  );
  return {
    ...nextSnapshot,
    snapshot: preservedSnapshot,
  };
}

export function createProjectsQueryOptions(team, options = {}) {
  const teamId = options.teamId ?? team?.id ?? null;
  return {
    queryKey: projectKeys.byTeam(teamId),
    queryFn: async () => {
      const result = await loadRepoBackedProjectsForTeam(team, {
        ...options,
        teamId,
        preserveProjectLifecyclePatches: (snapshot) => {
          const snapshotWithPagePatches =
            typeof options.preserveProjectLifecyclePatches === "function"
              ? options.preserveProjectLifecyclePatches(snapshot)
              : snapshot;
          return preserveProjectLifecyclePatchesInProjectSnapshot(
            snapshotWithPagePatches,
            queryClient.getQueryData(projectKeys.byTeam(teamId)),
          );
        },
      });
      const nextSnapshot = createProjectsQuerySnapshot(result);
      return preservePendingProjectLifecyclePatches(
        nextSnapshot,
        queryClient.getQueryData(projectKeys.byTeam(teamId)),
      );
    },
  };
}

export function ensureProjectsQueryObserver(render, team, options = {}) {
  const teamId = options.teamId ?? team?.id ?? null;
  const queryKey = projectKeys.byTeam(teamId);
  const currentKey = JSON.stringify(queryKey);
  if (activeProjectsQuerySubscription?.key === currentKey) {
    activeProjectsQuerySubscription.observer?.setOptions?.(
      createProjectsQueryOptions(team, {
        ...options,
        teamId,
        render,
      }),
    );
    return activeProjectsQuerySubscription;
  }

  activeProjectsQuerySubscription?.unsubscribe?.();
  const subscription = subscribeQueryObserver(
    createProjectsQueryOptions(team, {
      ...options,
      teamId,
      render,
    }),
    (result) => {
      if (result.data) {
        applyProjectsQuerySnapshotToState(result.data, {
          teamId,
          isFetching: result.isFetching,
          reconcileExpandedDeletedFiles: options.reconcileExpandedDeletedFiles,
        });
      } else if (result.error && state.selectedTeamId === teamId) {
        state.projectDiscovery = createProjectDiscoverySnapshot({
          status: "error",
          error: result.error?.message ?? String(result.error),
        });
        state.projectsPage.isRefreshing = result.isFetching;
      } else if (state.selectedTeamId === teamId) {
        state.projectsPage.isRefreshing = result.isFetching;
      }
      render?.();
    },
  );

  activeProjectsQuerySubscription = {
    ...subscription,
    key: currentKey,
    teamId,
  };
  return activeProjectsQuerySubscription;
}

export async function invalidateProjectsQueryAfterMutation(team, options = {}) {
  const teamId = options.teamId ?? team?.id ?? null;
  const queryKey = projectKeys.byTeam(teamId);
  const query = queryClient.getQueryCache().find({ queryKey });
  const hasActiveObserver = typeof query?.getObserversCount === "function"
    ? query.getObserversCount() > 0
    : false;

  await queryClient.invalidateQueries({
    queryKey,
    refetchType: hasActiveObserver ? "active" : "none",
  });

  if (!hasActiveObserver && options.refetchIfInactive !== false) {
    await queryClient.fetchQuery(createProjectsQueryOptions(team, {
      ...options,
      teamId,
    }));
  }
}

function createProjectLifecycleMutationOptions({
  team,
  project,
  mutationType,
  optimisticData,
  settledData = {},
  commitMutation,
  onOptimisticApplied,
  render,
  reconcileExpandedDeletedFiles,
} = {}) {
  const teamId = team?.id ?? null;
  const queryKey = projectKeys.byTeam(teamId);
  return {
    mutationKey: ["project", mutationType, project?.id ?? null],
    scope: { id: `team-metadata:${team?.installationId}` },
    mutationFn: async () => {
      const mutation = {
        type: mutationType,
        projectId: project.id,
      };
      if (mutationType === "rename") {
        mutation.title = optimisticData.title;
        mutation.previousTitle = project.title ?? project.name;
      }
      await commitMutation(team, mutation);
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey });
      const previousQueryData = queryClient.getQueryData(queryKey);
      let optimisticQueryData = previousQueryData;
      if (mutationType === "softDelete") {
        optimisticQueryData = moveProjectToCollection(previousQueryData, project.id, "deleted", optimisticData);
      } else if (mutationType === "restore") {
        optimisticQueryData = moveProjectToCollection(previousQueryData, project.id, "active", optimisticData);
      } else {
        optimisticQueryData = patchProjectQueryData(previousQueryData, project.id, optimisticData);
      }
      if (optimisticQueryData) {
        queryClient.setQueryData(queryKey, optimisticQueryData);
        applyProjectsQuerySnapshotToState(optimisticQueryData, {
          teamId,
          isFetching: state.projectsPage?.isRefreshing === true,
          reconcileExpandedDeletedFiles,
        });
      }
      onOptimisticApplied?.();
      render?.();
      return { previousQueryData };
    },
    onError: (error, _variables, context) => {
      if (context?.previousQueryData) {
        queryClient.setQueryData(queryKey, context.previousQueryData);
        applyProjectsQuerySnapshotToState(context.previousQueryData, {
          teamId,
          isFetching: state.projectsPage?.isRefreshing === true,
          reconcileExpandedDeletedFiles,
        });
      }
      if (typeof render === "function") {
        showNoticeBadge(error?.message ?? String(error), render);
      }
      render?.();
    },
    onSuccess: () => {
      const currentQueryData = queryClient.getQueryData(queryKey);
      const settledQueryData = patchProjectQueryData(currentQueryData, project.id, settledData);
      if (settledQueryData) {
        queryClient.setQueryData(queryKey, settledQueryData);
        applyProjectsQuerySnapshotToState(settledQueryData, {
          teamId,
          isFetching: state.projectsPage?.isRefreshing === true,
          reconcileExpandedDeletedFiles,
        });
      }
    },
    onSettled: async () => {
      await invalidateProjectsQueryAfterMutation(team, {
        teamId,
        render,
        reconcileExpandedDeletedFiles,
        refetchIfInactive: false,
      });
    },
  };
}

export function createProjectRenameMutationOptions({
  team,
  project,
  nextTitle,
  commitMutation,
  onOptimisticApplied,
  render,
  reconcileExpandedDeletedFiles,
} = {}) {
  return createProjectLifecycleMutationOptions({
    team,
    project,
    mutationType: "rename",
    optimisticData: {
      title: nextTitle,
      pendingMutation: "rename",
    },
    settledData: {
      title: nextTitle,
      pendingMutation: null,
      localLifecycleIntent: "rename",
    },
    commitMutation,
    onOptimisticApplied,
    render,
    reconcileExpandedDeletedFiles,
  });
}

export function createProjectSoftDeleteMutationOptions(options = {}) {
  return createProjectLifecycleMutationOptions({
    ...options,
    mutationType: "softDelete",
    optimisticData: {
      lifecycleState: "deleted",
      pendingMutation: "softDelete",
    },
    settledData: {
      lifecycleState: "deleted",
      pendingMutation: null,
      localLifecycleIntent: "softDelete",
    },
  });
}

export function createProjectRestoreMutationOptions(options = {}) {
  return createProjectLifecycleMutationOptions({
    ...options,
    mutationType: "restore",
    optimisticData: {
      lifecycleState: "active",
      pendingMutation: "restore",
    },
    settledData: {
      lifecycleState: "active",
      pendingMutation: null,
      localLifecycleIntent: "restore",
    },
  });
}

export async function runProjectRenameMutation(options = {}) {
  const observer = createMutationObserver(createProjectRenameMutationOptions(options));
  return observer.mutate();
}

export async function runProjectSoftDeleteMutation(options = {}) {
  const observer = createMutationObserver(createProjectSoftDeleteMutationOptions(options));
  return observer.mutate();
}

export async function runProjectRestoreMutation(options = {}) {
  const observer = createMutationObserver(createProjectRestoreMutationOptions(options));
  return observer.mutate();
}
