import test from "node:test";
import assert from "node:assert/strict";

import { QueryObserver } from "@tanstack/query-core";

globalThis.document = globalThis.document ?? {
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.window = globalThis.window ?? {
  __TAURI__: {},
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
  setTimeout,
  clearTimeout,
};

const { createResourcePageState } = await import("./resource-page-controller.js");
const { resetSessionState, state } = await import("./state.js");
const {
  applyProjectsQuerySnapshotToState,
  createProjectRenameMutationOptions,
  createProjectRestoreMutationOptions,
  createProjectSoftDeleteMutationOptions,
  createProjectsQuerySnapshot,
  invalidateProjectsQueryAfterMutation,
  preservePendingProjectLifecyclePatches,
  seedProjectsQueryFromCache,
} = await import("./project-query.js");
const { projectKeys, queryClient } = await import("./query-client.js");

function project(overrides = {}) {
  return {
    id: "project-1",
    name: "project-repo",
    title: "Project",
    lifecycleState: "active",
    chapters: [],
    ...overrides,
  };
}

test.afterEach(() => {
  queryClient.clear();
  resetSessionState();
});

test("project query adapter maps snapshots into project page state", () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.projectsPage = createResourcePageState();
  const snapshot = createProjectsQuerySnapshot({
    items: [project()],
    deletedItems: [project({ id: "deleted-project", lifecycleState: "deleted" })],
    repoSyncByProjectId: { "project-1": { status: "synced" } },
    glossaries: [{ id: "glossary-1", title: "Glossary" }],
    pendingChapterMutations: [{ id: "mutation-1" }],
    discovery: { status: "ready", glossaryWarning: "Glossary warning" },
  });

  const applied = applyProjectsQuerySnapshotToState(snapshot, {
    teamId: "team-1",
    isFetching: true,
  });

  assert.equal(applied, true);
  assert.equal(state.projects.length, 1);
  assert.equal(state.deletedProjects.length, 1);
  assert.equal(state.projectRepoSyncByProjectId["project-1"].status, "synced");
  assert.equal(state.glossaries[0].title, "Glossary");
  assert.equal(state.pendingChapterMutations[0].id, "mutation-1");
  assert.equal(state.projectDiscovery.glossaryWarning, "Glossary warning");
  assert.equal(state.projectsPage.isRefreshing, true);
});

test("project query adapter ignores stale team snapshots", () => {
  resetSessionState();
  state.selectedTeamId = "team-2";
  state.projects = [project({ title: "Existing" })];

  const applied = applyProjectsQuerySnapshotToState(
    createProjectsQuerySnapshot({ items: [project({ title: "Stale" })] }),
    { teamId: "team-1" },
  );

  assert.equal(applied, false);
  assert.equal(state.projects[0].title, "Existing");
});

test("project query cache seed applies cached projects with pending mutations", () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.projectsPage = createResourcePageState();
  const team = { id: "team-1", installationId: 1 };

  const snapshot = seedProjectsQueryFromCache(team, {
    loadStoredProjectsForTeam: () => ({
      exists: true,
      projects: [project()],
      deletedProjects: [],
    }),
    loadStoredChapterPendingMutations: () => [{ id: "rename-project", projectId: "project-1" }],
    applyChapterPendingMutation: (currentSnapshot) => ({
      ...currentSnapshot,
      items: currentSnapshot.items.map((item) => ({ ...item, title: "Pending" })),
    }),
  });

  assert.equal(snapshot.snapshot.items[0].title, "Pending");
  assert.equal(queryClient.getQueryData(projectKeys.byTeam(team.id)).snapshot.items[0].title, "Pending");
  assert.equal(state.projects[0].title, "Pending");
});

test("project rename optimistic patch updates query cache and state immediately", async () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.projectsPage = createResourcePageState();
  const team = { id: "team-1", installationId: 1 };
  const queryKey = projectKeys.byTeam(team.id);
  let optimisticApplied = false;
  queryClient.setQueryData(queryKey, createProjectsQuerySnapshot({ items: [project()] }));

  const options = createProjectRenameMutationOptions({
    team,
    project: project(),
    nextTitle: "Renamed",
    commitMutation: async () => {},
    onOptimisticApplied: () => {
      optimisticApplied = true;
    },
  });

  await options.onMutate();

  assert.equal(queryClient.getQueryData(queryKey).snapshot.items[0].title, "Renamed");
  assert.equal(queryClient.getQueryData(queryKey).snapshot.items[0].pendingMutation, "rename");
  assert.equal(state.projects[0].title, "Renamed");
  assert.equal(optimisticApplied, true);
});

test("project rename optimistic failure rolls back query cache and state", async () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.projectsPage = createResourcePageState();
  const team = { id: "team-1", installationId: 1 };
  const queryKey = projectKeys.byTeam(team.id);
  queryClient.setQueryData(queryKey, createProjectsQuerySnapshot({ items: [project()] }));

  const options = createProjectRenameMutationOptions({
    team,
    project: project(),
    nextTitle: "Renamed",
    commitMutation: async () => {},
  });

  const context = await options.onMutate();
  options.onError(new Error("failed"), undefined, context);

  assert.equal(queryClient.getQueryData(queryKey).snapshot.items[0].title, "Project");
  assert.equal(state.projects[0].title, "Project");
});

test("project soft delete and restore optimistic patches move collections", async () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.projectsPage = createResourcePageState();
  const team = { id: "team-1", installationId: 1 };
  const queryKey = projectKeys.byTeam(team.id);
  queryClient.setQueryData(queryKey, createProjectsQuerySnapshot({ items: [project()] }));

  await createProjectSoftDeleteMutationOptions({
    team,
    project: project(),
    commitMutation: async () => {},
  }).onMutate();

  assert.equal(queryClient.getQueryData(queryKey).snapshot.items.length, 0);
  assert.equal(queryClient.getQueryData(queryKey).snapshot.deletedItems[0].pendingMutation, "softDelete");
  assert.equal(state.deletedProjects[0].id, "project-1");

  await createProjectRestoreMutationOptions({
    team,
    project: project({ lifecycleState: "deleted", pendingMutation: "softDelete" }),
    commitMutation: async () => {},
  }).onMutate();

  assert.equal(queryClient.getQueryData(queryKey).snapshot.deletedItems.length, 0);
  assert.equal(queryClient.getQueryData(queryKey).snapshot.items[0].pendingMutation, "restore");
  assert.equal(state.projects[0].id, "project-1");
});

test("project mutations use the team metadata mutation scope", () => {
  const team = { id: "team-1", installationId: 42 };

  assert.deepEqual(
    createProjectRenameMutationOptions({
      team,
      project: project(),
      nextTitle: "Renamed",
      commitMutation: async () => {},
    }).scope,
    { id: "team-metadata:42" },
  );
  assert.deepEqual(
    createProjectSoftDeleteMutationOptions({
      team,
      project: project(),
      commitMutation: async () => {},
    }).scope,
    { id: "team-metadata:42" },
  );
  assert.deepEqual(
    createProjectRestoreMutationOptions({
      team,
      project: project({ lifecycleState: "deleted" }),
      commitMutation: async () => {},
    }).scope,
    { id: "team-metadata:42" },
  );
});

test("refresh snapshots preserve pending project lifecycle patches", () => {
  const previousSnapshot = createProjectsQuerySnapshot({
    items: [
      project({ title: "Optimistic Rename", pendingMutation: "rename" }),
      project({ id: "restore-project", lifecycleState: "active", pendingMutation: "restore" }),
    ],
    deletedItems: [
      project({ id: "delete-project", lifecycleState: "deleted", pendingMutation: "softDelete" }),
    ],
  });
  const nextSnapshot = createProjectsQuerySnapshot({
    items: [
      project({ title: "Server Title" }),
      project({ id: "delete-project", lifecycleState: "active" }),
    ],
    deletedItems: [
      project({ id: "restore-project", lifecycleState: "deleted" }),
    ],
  });

  const merged = preservePendingProjectLifecyclePatches(nextSnapshot, previousSnapshot);

  assert.equal(merged.snapshot.items.find((item) => item.id === "project-1").title, "Optimistic Rename");
  assert.equal(merged.snapshot.deletedItems.find((item) => item.id === "delete-project").pendingMutation, "softDelete");
  assert.equal(merged.snapshot.items.find((item) => item.id === "restore-project").pendingMutation, "restore");
});

test("project mutation settle invalidates active project query once without explicit fetch", async () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  const team = { id: "team-1", installationId: 1 };
  const queryKey = projectKeys.byTeam(team.id);
  queryClient.setQueryData(queryKey, createProjectsQuerySnapshot({ items: [project()] }));
  const observer = new QueryObserver(queryClient, {
    queryKey,
    queryFn: async () => createProjectsQuerySnapshot({ items: [project()] }),
  });
  const unsubscribe = observer.subscribe(() => {});
  const originalInvalidateQueries = queryClient.invalidateQueries.bind(queryClient);
  const originalFetchQuery = queryClient.fetchQuery.bind(queryClient);
  let invalidateCount = 0;
  let fetchCount = 0;
  queryClient.invalidateQueries = async (filters) => {
    invalidateCount += 1;
    assert.deepEqual(filters.queryKey, queryKey);
  };
  queryClient.fetchQuery = async () => {
    fetchCount += 1;
  };

  try {
    await invalidateProjectsQueryAfterMutation(team);
  } finally {
    queryClient.invalidateQueries = originalInvalidateQueries;
    queryClient.fetchQuery = originalFetchQuery;
    unsubscribe();
  }

  assert.equal(invalidateCount, 1);
  assert.equal(fetchCount, 0);
});
