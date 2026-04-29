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
  preserveProjectLifecyclePatchesInProjectSnapshot,
  preservePendingProjectLifecyclePatches,
  seedProjectsQueryFromCache,
} = await import("./project-query.js");
const { glossaryKeys, projectKeys, queryClient } = await import("./query-client.js");
const {
  chapterGlossaryIntentKey,
  chapterLifecycleIntentKey,
  projectLifecycleIntentKey,
  projectRepoWriteScope,
  projectTitleIntentKey,
  requestProjectWriteIntent,
  resetProjectWriteCoordinator,
  teamMetadataWriteScope,
} = await import("./project-write-coordinator.js");

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

function chapter(overrides = {}) {
  return {
    id: "chapter-1",
    name: "Chapter",
    status: "active",
    linkedGlossary: null,
    ...overrides,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

test.afterEach(() => {
  queryClient.clear();
  resetProjectWriteCoordinator();
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

test("project query adapter overlays active project title intents during refresh", async () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.projectsPage = createResourcePageState();
  const releaseWrite = deferred();

  requestProjectWriteIntent({
    key: projectTitleIntentKey("project-1"),
    scope: teamMetadataWriteScope({ installationId: 1 }),
    teamId: "team-1",
    projectId: "project-1",
    type: "projectTitle",
    value: { title: "Local Rename" },
  }, {
    run: async () => {
      await releaseWrite.promise;
    },
  });
  await delay(0);

  applyProjectsQuerySnapshotToState(
    createProjectsQuerySnapshot({ items: [project({ title: "Server Title" })] }),
    { teamId: "team-1", isFetching: true },
  );

  assert.equal(state.projects[0].title, "Local Rename");
  assert.equal(state.projects[0].pendingMutation, "rename");

  releaseWrite.resolve();
  await delay(5);
});

test("project query adapter overlays active project lifecycle intents during refresh", async () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.projectsPage = createResourcePageState();
  const releaseWrite = deferred();

  requestProjectWriteIntent({
    key: projectLifecycleIntentKey("project-1"),
    scope: teamMetadataWriteScope({ installationId: 1 }),
    teamId: "team-1",
    projectId: "project-1",
    type: "projectLifecycle",
    value: { lifecycleState: "deleted" },
  }, {
    run: async () => {
      await releaseWrite.promise;
    },
  });
  await delay(0);

  applyProjectsQuerySnapshotToState(
    createProjectsQuerySnapshot({ items: [project({ lifecycleState: "active" })] }),
    { teamId: "team-1", isFetching: true },
  );

  assert.equal(state.projects.length, 0);
  assert.equal(state.deletedProjects[0].id, "project-1");
  assert.equal(state.deletedProjects[0].pendingMutation, "softDelete");

  releaseWrite.resolve();
  await delay(5);
});

test("project query adapter overlays active chapter lifecycle and glossary intents during refresh", async () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.projectsPage = createResourcePageState();
  const releaseLifecycleWrite = deferred();
  const releaseGlossaryWrite = deferred();

  requestProjectWriteIntent({
    key: chapterLifecycleIntentKey("project-1", "chapter-1"),
    scope: projectRepoWriteScope({ installationId: 1 }, "project-1"),
    teamId: "team-1",
    projectId: "project-1",
    chapterId: "chapter-1",
    type: "chapterLifecycle",
    value: { status: "active" },
  }, {
    run: async () => {
      await releaseLifecycleWrite.promise;
    },
  });
  requestProjectWriteIntent({
    key: chapterGlossaryIntentKey("project-2", "chapter-2"),
    scope: projectRepoWriteScope({ installationId: 1 }, "project-2"),
    teamId: "team-1",
    projectId: "project-2",
    chapterId: "chapter-2",
    type: "chapterGlossary",
    value: { glossary: { glossaryId: "new", repoName: "new-glossary" } },
  }, {
    run: async () => {
      await releaseGlossaryWrite.promise;
    },
  });
  await delay(0);

  applyProjectsQuerySnapshotToState(
    createProjectsQuerySnapshot({
      items: [
        project({ chapters: [chapter({ status: "deleted" })] }),
        project({
          id: "project-2",
          chapters: [chapter({
            id: "chapter-2",
            linkedGlossary: { glossaryId: "old", repoName: "old-glossary" },
          })],
        }),
      ],
    }),
    { teamId: "team-1", isFetching: true },
  );

  assert.equal(state.projects[0].chapters[0].status, "active");
  assert.equal(state.projects[0].chapters[0].pendingMutation, "restore");
  assert.equal(state.projects[1].chapters[0].linkedGlossary.glossaryId, "new");
  assert.equal(state.projects[1].chapters[0].pendingGlossaryMutation, true);

  releaseLifecycleWrite.resolve();
  releaseGlossaryWrite.resolve();
  await delay(5);
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

test("project query cache seed preserves glossary options during refresh", () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.projectsPage = createResourcePageState();
  state.glossaries = [{ id: "glossary-1", title: "Glossary", repoName: "glossary-repo" }];
  const team = { id: "team-1", installationId: 1 };

  const snapshot = seedProjectsQueryFromCache(team, {
    loadStoredProjectsForTeam: () => ({
      exists: true,
      projects: [project({
        chapters: [{
          id: "chapter-1",
          name: "Chapter",
          linkedGlossary: { glossaryId: "glossary-1", repoName: "glossary-repo" },
        }],
      })],
      deletedProjects: [],
    }),
  });

  assert.equal(snapshot.glossaries[0].title, "Glossary");
  assert.equal(state.glossaries[0].title, "Glossary");
  assert.equal(state.projects[0].chapters[0].linkedGlossary.glossaryId, "glossary-1");
});

test("project query cache seed uses the selected team's cached glossaries over stale visible glossaries", () => {
  resetSessionState();
  state.selectedTeamId = "team-2";
  state.projectsPage = createResourcePageState();
  state.glossaries = [{ id: "team-1-glossary", title: "Team 1 Glossary", repoName: "team-1-repo" }];
  const team = { id: "team-2", installationId: 2 };

  const snapshot = seedProjectsQueryFromCache(team, {
    loadStoredProjectsForTeam: () => ({
      exists: true,
      projects: [project({
        chapters: [{
          id: "chapter-1",
          name: "Chapter",
          linkedGlossary: { glossaryId: "team-2-glossary", repoName: "team-2-repo" },
        }],
      })],
      deletedProjects: [],
    }),
    loadStoredGlossariesForTeam: () => ({
      exists: true,
      glossaries: [{ id: "team-2-glossary", title: "Team 2 Glossary", repoName: "team-2-repo" }],
    }),
  });

  assert.equal(snapshot.glossaries[0].id, "team-2-glossary");
  assert.equal(state.glossaries[0].title, "Team 2 Glossary");
  assert.equal(queryClient.getQueryData(projectKeys.byTeam(team.id)).glossaries[0].id, "team-2-glossary");
});

test("project query cache seed prefers selected team glossary query data over stored glossary cache", () => {
  resetSessionState();
  state.selectedTeamId = "team-2";
  state.projectsPage = createResourcePageState();
  const team = { id: "team-2", installationId: 2 };
  queryClient.setQueryData(glossaryKeys.byTeam(team.id), {
    glossaries: [{ id: "query-glossary", title: "Query Glossary", repoName: "query-repo" }],
  });

  const snapshot = seedProjectsQueryFromCache(team, {
    loadStoredProjectsForTeam: () => ({
      exists: true,
      projects: [project({
        chapters: [{
          id: "chapter-1",
          name: "Chapter",
          linkedGlossary: { glossaryId: "query-glossary", repoName: "query-repo" },
        }],
      })],
      deletedProjects: [],
    }),
    loadStoredGlossariesForTeam: () => ({
      exists: true,
      glossaries: [{ id: "stored-glossary", title: "Stored Glossary", repoName: "stored-repo" }],
    }),
  });

  assert.equal(snapshot.glossaries[0].id, "query-glossary");
  assert.equal(state.glossaries[0].title, "Query Glossary");
});

test("project query adapter keeps current glossary options while fetch placeholder data is empty", () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.projectsPage = createResourcePageState();
  state.glossaries = [{ id: "glossary-1", title: "Glossary", repoName: "glossary-repo" }];

  applyProjectsQuerySnapshotToState(createProjectsQuerySnapshot({
    items: [project()],
    glossaries: [],
  }), {
    teamId: "team-1",
    isFetching: true,
  });

  assert.equal(state.glossaries[0].title, "Glossary");

  applyProjectsQuerySnapshotToState(createProjectsQuerySnapshot({
    items: [project()],
    glossaries: [],
  }), {
    teamId: "team-1",
    isFetching: false,
  });

  assert.equal(state.glossaries.length, 0);
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

test("refresh snapshots preserve settled local project lifecycle intent until server agrees", () => {
  const previousSnapshot = createProjectsQuerySnapshot({
    items: [
      project({ id: "rename-project", title: "Local Rename", localLifecycleIntent: "rename" }),
      project({ id: "restore-project", lifecycleState: "active", localLifecycleIntent: "restore" }),
    ],
    deletedItems: [
      project({ id: "delete-project", lifecycleState: "deleted", localLifecycleIntent: "softDelete" }),
    ],
  });
  const staleRefreshSnapshot = createProjectsQuerySnapshot({
    items: [
      project({ id: "rename-project", title: "Server Title" }),
      project({ id: "delete-project", lifecycleState: "active" }),
    ],
    deletedItems: [
      project({ id: "restore-project", lifecycleState: "deleted" }),
    ],
  });

  const merged = preservePendingProjectLifecyclePatches(staleRefreshSnapshot, previousSnapshot);

  assert.equal(merged.snapshot.items.find((item) => item.id === "rename-project").title, "Local Rename");
  assert.equal(merged.snapshot.items.find((item) => item.id === "rename-project").localLifecycleIntent, "rename");
  assert.equal(merged.snapshot.deletedItems.find((item) => item.id === "delete-project").localLifecycleIntent, "softDelete");
  assert.equal(merged.snapshot.items.find((item) => item.id === "restore-project").localLifecycleIntent, "restore");
});

test("direct project refresh snapshots preserve settled local project lifecycle intent", () => {
  const previousSnapshot = createProjectsQuerySnapshot({
    items: [
      project({ id: "rename-project", title: "Local Rename", localLifecycleIntent: "rename" }),
    ],
    deletedItems: [
      project({ id: "delete-project", lifecycleState: "deleted", localLifecycleIntent: "softDelete" }),
    ],
  });
  const staleRefreshSnapshot = {
    items: [
      project({ id: "rename-project", title: "Server Title" }),
      project({ id: "delete-project", lifecycleState: "active" }),
    ],
    deletedItems: [],
  };

  const merged = preserveProjectLifecyclePatchesInProjectSnapshot(staleRefreshSnapshot, previousSnapshot);

  assert.equal(merged.items.length, 1);
  assert.equal(merged.items[0].title, "Local Rename");
  assert.equal(merged.items[0].localLifecycleIntent, "rename");
  assert.equal(merged.deletedItems[0].id, "delete-project");
  assert.equal(merged.deletedItems[0].localLifecycleIntent, "softDelete");
});

test("refresh snapshots clear local project lifecycle intent after server state agrees", () => {
  const previousSnapshot = createProjectsQuerySnapshot({
    items: [
      project({ id: "rename-project", title: "Local Rename", localLifecycleIntent: "rename" }),
      project({ id: "restore-project", lifecycleState: "active", localLifecycleIntent: "restore" }),
    ],
    deletedItems: [
      project({ id: "delete-project", lifecycleState: "deleted", localLifecycleIntent: "softDelete" }),
    ],
  });
  const settledRefreshSnapshot = createProjectsQuerySnapshot({
    items: [
      project({ id: "rename-project", title: "Local Rename" }),
      project({ id: "restore-project", lifecycleState: "active" }),
    ],
    deletedItems: [
      project({ id: "delete-project", lifecycleState: "deleted" }),
    ],
  });

  const merged = preservePendingProjectLifecyclePatches(settledRefreshSnapshot, previousSnapshot);

  assert.equal(merged.snapshot.items.find((item) => item.id === "rename-project").localLifecycleIntent, undefined);
  assert.equal(merged.snapshot.items.find((item) => item.id === "restore-project").localLifecycleIntent, undefined);
  assert.equal(merged.snapshot.deletedItems.find((item) => item.id === "delete-project").localLifecycleIntent, undefined);
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
