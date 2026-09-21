import test from "node:test";
import assert from "node:assert/strict";

const invokeCalls = [];
let invokeHandler = async () => null;

globalThis.document = {
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
  },
};

globalThis.window = {
  __TAURI__: {
    core: {
      invoke(command, payload) {
        invokeCalls.push({ command, payload });
        return invokeHandler(command, payload);
      },
    },
  },
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame(callback) {
    return setTimeout(callback, 0);
  },
  setTimeout,
  clearTimeout,
};

const { createResourcePageState } = await import("./resource-page-controller.js");
const {
  confirmProjectPermanentDeletion,
  permanentlyDeleteProject,
  updateProjectPermanentDeletionConfirmation,
  submitProjectCreation,
  deleteProject,
} = await import("./project-flow.js");
const { queryClient, projectKeys } = await import("./query-client.js");
const { removePersistentValue } = await import("./persistent-store.js");
const { resetSessionState, state } = await import("./state.js");
const { setActiveStorageLogin } = await import("./team-storage.js");

const { createProjectsQuerySnapshot, applyProjectsQuerySnapshotToState } = await import("./project-query.js");
const { renderProjectsScreen } = await import("../screens/projects.js");
const { clearNoticeBadge } = await import("./status-feedback.js");

const STORAGE_LOGIN = "project-flow-local-delete-test";
const LOCAL_HARD_DELETE_STORAGE_KEY = `gnosis-tms-local-hard-delete-tombstones:${STORAGE_LOGIN}`;
const PROJECT_CACHE_STORAGE_KEY = `gnosis-tms-project-cache:${STORAGE_LOGIN}`;

function deletedProject(overrides = {}) {
  return {
    id: "project-1",
    name: "project-repo",
    title: "Project",
    fullName: "team-1/project-repo",
    lifecycleState: "deleted",
    chapters: [],
    ...overrides,
  };
}

function setupProjectPermanentDeletionState() {
  resetSessionState();
  invokeCalls.length = 0;
  setActiveStorageLogin(STORAGE_LOGIN);

  const team = {
    id: "team-1",
    name: "Team 1",
    githubOrg: "team-1",
    installationId: 42,
    canLocalHardDelete: true,
  };
  const project = deletedProject();

  state.auth.session = { sessionToken: "token" };
  state.teams = [team];
  state.selectedTeamId = team.id;
  state.screen = "projects";
  state.projectsPage = createResourcePageState();
  state.deletedProjects = [project];
  const queryData = createProjectsQuerySnapshot({ deletedItems: [project] });
  queryClient.setQueryData(projectKeys.byTeam(team.id), queryData);
  applyProjectsQuerySnapshotToState(queryData, { teamId: team.id });
  state.projectPermanentDeletion = {
    teamId: team.id,
    isOpen: true,
    status: "idle",
    error: "",
    projectId: project.id,
    projectName: project.title,
    confirmationText: project.title,
  };

  return { project, team };
}

test.afterEach(() => {
  clearNoticeBadge();
  queryClient.clear();
  invokeCalls.length = 0;
  invokeHandler = async () => null;
  removePersistentValue(LOCAL_HARD_DELETE_STORAGE_KEY);
  removePersistentValue(PROJECT_CACHE_STORAGE_KEY);
  setActiveStorageLogin(null);
  resetSessionState();
});

test("successful project local delete closes the modal with a full render", async () => {
  const { project, team } = setupProjectPermanentDeletionState();
  const renderCalls = [];
  const render = (options) => {
    renderCalls.push(options ?? null);
  };

  await confirmProjectPermanentDeletion(render);

  assert.deepEqual(
    invokeCalls.find((call) => call.command === "purge_local_gtms_project_repo"),
    {
      command: "purge_local_gtms_project_repo",
      payload: {
        input: {
          installationId: team.installationId,
          projectId: project.id,
          repoName: project.name,
        },
      },
    },
  );
  assert.equal(state.projectPermanentDeletion.isOpen, false);
  assert.equal(state.projectPermanentDeletion.status, "idle");
  assert.equal(state.deletedProjects.some((item) => item.id === project.id), false);
  assert.equal(renderCalls.at(-1), null);
  assert.ok(
    renderCalls.some((options) => options?.scope === "status-surface"),
    "expected the notice/status badge to request its scoped render",
  );
});

test("enabled local Delete opens and confirms during a background refresh", async () => {
  const { project } = setupProjectPermanentDeletionState();
  state.projectsPage.isRefreshing = true;
  state.projectPermanentDeletion.isOpen = false;
  state.showDeletedProjects = true;
  const html = renderProjectsScreen(state);
  assert.match(html, /data-action="delete-deleted-project:project-1"/);
  await permanentlyDeleteProject(() => {}, project.id);
  assert.equal(state.projectPermanentDeletion.isOpen, true);
  updateProjectPermanentDeletionConfirmation(project.title);
  await confirmProjectPermanentDeletion(() => {});
  assert.equal(state.projectDiscovery.status, "ready");
  assert.equal(state.projectsPage.isRefreshing, true);
  assert.equal(state.deletedProjects.length, 0);
  assert.equal(invokeCalls.filter((call) => call.command === "purge_local_gtms_project_repo").length, 1);
  assert.doesNotMatch(renderProjectsScreen(state), /PROJECT LOAD FAILED/);
});

test("local delete confirmation tolerates refresh starting after the dialog opens", async () => {
  const { project } = setupProjectPermanentDeletionState();
  await permanentlyDeleteProject(() => {}, project.id);
  updateProjectPermanentDeletionConfirmation(project.title);
  state.projectsPage.isRefreshing = true;
  await confirmProjectPermanentDeletion(() => {});
  assert.equal(state.projectPermanentDeletion.isOpen, false);
  assert.equal(state.deletedProjects.length, 0);
  assert.equal(state.projectsPage.isRefreshing, true);
});

function setupActiveProjectState() {
  const { team, project } = setupProjectPermanentDeletionState();
  team.membershipRole = "owner";
  state.screen = "projects";
  project.lifecycleState = "active";
  project.fileLoadState = "ready";
  state.projects = [project];
  state.deletedProjects = [];
  state.projectDiscovery = { status: "ready", error: "" };
  state.projectPermanentDeletion.isOpen = false;
  queryClient.setQueryData(projectKeys.byTeam(team.id), createProjectsQuerySnapshot({ items: [project] }));
  return { team, project };
}

test("a failed deletion retains the project list and reports the operation error", async () => {
  const { project } = setupActiveProjectState();
  invokeHandler = async (command) => {
    if (command === "upsert_local_gnosis_project_metadata_record") throw new Error("Metadata push failed");
    return null;
  };
  await deleteProject(() => {}, project.id);
  assert.ok(invokeCalls.some((call) => call.command === "upsert_local_gnosis_project_metadata_record"));
  assert.equal(state.projectDiscovery.status, "ready");
  assert.equal(state.projects[0]?.id, project.id);
  assert.match(state.statusBadges.left.text, /Could not delete project:.*Metadata push failed/);
  const html = renderProjectsScreen(state);
  assert.doesNotMatch(html, /PROJECT LOAD FAILED/);
  assert.match(html, /data-action="delete-project:project-1"/);
});

test("creation completes locally while its background refresh is still pending", async () => {
  const { team } = setupActiveProjectState();
  state.projectsPage.isRefreshing = true;
  state.projectCreation = { isOpen: true, status: "idle", error: "", projectName: "New project" };
  let resolveListing;
  const listing = new Promise((resolve) => { resolveListing = resolve; });
  let oldSignal;
  const oldDiscovery = queryClient.fetchQuery({
    queryKey: projectKeys.byTeam(team.id),
    queryFn: ({ signal }) => {
      oldSignal = signal;
      return listing;
    },
  }).catch(() => null);
  invokeHandler = async (command, payload) => {
    if (command === "create_gnosis_project_repo") {
      assert.equal(oldSignal.aborted, true, "cancel discovery before creating remote or local metadata");
      return { name: payload.input.repoName, fullName: `team-1/${payload.input.repoName}`, defaultBranchName: "main" };
    }
    if (command === "list_gnosis_resources_for_installation") return listing;
    return null;
  };
  try {
    await submitProjectCreation(() => {});
    assert.ok(invokeCalls.some((call) => call.command === "initialize_gtms_project_repo"));
    assert.equal(state.projectCreation.isOpen, false);
    assert.equal(state.projectsPage.writeState, "idle");
    const created = state.projects.find((project) => project.title === "New project");
    assert.ok(created);
    assert.equal(created.fileLoadState, "ready");
    assert.deepEqual(created.chapters, []);
    const html = renderProjectsScreen(state);
    const addButton = html.match(new RegExp(`<button[^>]*data-action="add-project-files:${created.id}"[^>]*>`))?.[0];
    assert.ok(addButton);
    assert.doesNotMatch(addButton, /disabled/);
  } finally {
    state.screen = "teams";
    resolveListing({ projects: [], glossaries: [], qaLists: [] });
    await oldDiscovery;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

for (const block of ["write", "softDelete", "restore"]) {
  test(`local removal reports ${block} blocking without failing discovery`, async () => {
    const { project } = setupProjectPermanentDeletionState();
    if (block === "write") state.projectsPage.writeState = "submitting";
    else project.pendingMutation = block;
    const modal = state.projectPermanentDeletion;
    permanentlyDeleteProject(() => {}, project.id);
    assert.equal(state.projectPermanentDeletion, modal);
    assert.match(state.statusBadges.left.text, /current project write/);
    await confirmProjectPermanentDeletion(() => {});
    assert.match(modal.error, /current project write/);
    assert.equal(state.projectDiscovery.status, "ready");
    assert.equal(invokeCalls.length, 0);
    assert.doesNotMatch(renderProjectsScreen(state), /PROJECT LOAD FAILED/);
  });
}

test("local removal errors preserve the row, confirmation text, and refresh badge for retry", async () => {
  const { project } = setupProjectPermanentDeletionState();
  state.projectsPage.isRefreshing = true;
  state.statusBadges.right = { visible: true, text: "Refreshing projects..." };
  const badge = { ...state.statusBadges.right };
  invokeHandler = async () => { throw new Error("Filesystem busy"); };
  await confirmProjectPermanentDeletion(() => {});
  assert.equal(state.projectPermanentDeletion.status, "idle");
  assert.equal(state.projectPermanentDeletion.confirmationText, project.title);
  assert.match(state.projectPermanentDeletion.error, /Filesystem busy/);
  assert.equal(state.deletedProjects[0].id, project.id);
  assert.equal(state.projectDiscovery.status, "ready");
  assert.deepEqual(state.statusBadges.right, badge);
  invokeHandler = async () => null;
  await confirmProjectPermanentDeletion(() => {});
  assert.equal(state.deletedProjects.length, 0);
  assert.deepEqual(state.statusBadges.right, badge);
});

for (const invalidation of ["missing", "restored", "nameMismatch"]) {
  test(`local removal rejects ${invalidation} before native deletion`, async () => {
    const { project } = setupProjectPermanentDeletionState();
    if (invalidation === "missing") state.deletedProjects = [];
    if (invalidation === "restored") project.lifecycleState = "active";
    if (invalidation === "nameMismatch") state.projectPermanentDeletion.confirmationText = "wrong";
    await confirmProjectPermanentDeletion(() => {});
    assert.ok(state.projectPermanentDeletion.error);
    assert.equal(invokeCalls.length, 0);
    assert.equal(state.projectDiscovery.status, "ready");
  });
}

test("double confirmation only purges once and does not open another dialog", async () => {
  const { project } = setupProjectPermanentDeletionState();
  const finish = deferred();
  invokeHandler = async () => finish.promise;
  const modal = state.projectPermanentDeletion;
  const first = confirmProjectPermanentDeletion(() => {});
  await confirmProjectPermanentDeletion(() => {});
  permanentlyDeleteProject(() => {}, project.id);
  assert.equal(state.projectPermanentDeletion, modal);
  assert.equal(invokeCalls.length, 1);
  finish.resolve();
  await first;
  assert.equal(state.deletedProjects.length, 0);
});

test("offline local removal uses only the purge command", async () => {
  setupProjectPermanentDeletionState();
  state.offline.isEnabled = true;
  state.auth.session = null;
  await confirmProjectPermanentDeletion(() => {});
  assert.deepEqual(invokeCalls.map((call) => call.command), ["purge_local_gtms_project_repo"]);
  assert.equal(state.deletedProjects.length, 0);
});

test("an old team's confirmation cannot delete a matching project in another team", async () => {
  setupProjectPermanentDeletionState();
  state.teams.push({ id: "team-2", installationId: 43 });
  state.selectedTeamId = "team-2";
  await confirmProjectPermanentDeletion(() => {});
  assert.equal(invokeCalls.length, 0);
});

for (const fails of [false, true]) {
  test(`purge completion preserves another team's screen and modal, failure=${fails}`, async () => {
    const { team, project } = setupProjectPermanentDeletionState();
    const finish = deferred();
    invokeHandler = async () => {
      await finish.promise;
      if (fails) throw new Error("Filesystem busy");
    };
    const removal = confirmProjectPermanentDeletion(() => {});
    const otherTeam = { id: "team-2", installationId: 43 };
    state.teams.push(otherTeam);
    state.selectedTeamId = otherTeam.id;
    const otherSnapshot = createProjectsQuerySnapshot({ items: [{ ...project, id: "other-project", lifecycleState: "active" }] });
    queryClient.setQueryData(projectKeys.byTeam(otherTeam.id), otherSnapshot);
    applyProjectsQuerySnapshotToState(otherSnapshot, { teamId: otherTeam.id });
    const otherModal = { isOpen: true, status: "idle", teamId: otherTeam.id, error: "unchanged" };
    state.projectPermanentDeletion = otherModal;
    const visibleBefore = JSON.stringify({ projects: state.projects, discovery: state.projectDiscovery, badges: state.statusBadges });
    finish.resolve();
    await removal;
    assert.equal(state.projectPermanentDeletion, otherModal);
    assert.equal(JSON.stringify({ projects: state.projects, discovery: state.projectDiscovery, badges: state.statusBadges }), visibleBefore);
    assert.equal(queryClient.getQueryData(projectKeys.byTeam(team.id)).snapshot.deletedItems.length, fails ? 1 : 0);
    assert.deepEqual(queryClient.getQueryData(projectKeys.byTeam(otherTeam.id)), otherSnapshot);
    if (!fails) {
      const { loadStoredProjectsForTeam } = await import("./project-cache.js");
      assert.deepEqual(loadStoredProjectsForTeam(team).projects, []);
      assert.deepEqual(loadStoredProjectsForTeam(team).deletedProjects, []);
    }
  });
}

test("local removal preserves an existing discovery failure", async () => {
  const { project } = setupProjectPermanentDeletionState();
  state.projectDiscovery = { status: "error", error: "Actual load failure" };
  state.projectsPage.writeState = "submitting";
  permanentlyDeleteProject(() => {}, project.id);
  assert.equal(state.projectDiscovery.error, "Actual load failure");
  state.projectsPage.writeState = "idle";
  await confirmProjectPermanentDeletion(() => {});
  assert.equal(state.projectDiscovery.status, "error");
  assert.equal(state.projectDiscovery.error, "Actual load failure");
});

test("a stale refresh cannot resurrect a removed project or lose unrelated projects", async () => {
  const { project, team } = setupProjectPermanentDeletionState();
  const other = { ...project, id: "other-project", name: "other-repo", fullName: "team-1/other-repo", lifecycleState: "active" };
  const staleSnapshot = createProjectsQuerySnapshot({ items: [other], deletedItems: [project] });
  queryClient.setQueryData(projectKeys.byTeam(team.id), staleSnapshot);
  applyProjectsQuerySnapshotToState(staleSnapshot, { teamId: team.id, isFetching: true });
  const refresh = deferred();
  const request = queryClient.fetchQuery({ queryKey: projectKeys.byTeam(team.id), queryFn: () => refresh.promise });
  await confirmProjectPermanentDeletion(() => {});
  assert.deepEqual(state.projects.map((item) => item.id), [other.id]);
  assert.deepEqual(state.deletedProjects, []);
  refresh.resolve(staleSnapshot);
  applyProjectsQuerySnapshotToState(await request, { teamId: team.id });
  assert.deepEqual(state.projects.map((item) => item.id), [other.id]);
  assert.deepEqual(state.deletedProjects, []);
});

test("soft deletion waits for native sync before local removal becomes available", async () => {
  const { team, project } = setupActiveProjectState();
  const { reconcileProjectRepoSyncStates, __setProjectRepoSyncTiming } = await import("./project-repo-sync-flow.js");
  const { resetRepoWriteQueue } = await import("./repo-write-queue.js");
  const nativeFinished = deferred();
  const polling = deferred();
  __setProjectRepoSyncTiming({ delay: async () => {} });
  invokeHandler = async (command) => {
    if (command === "reconcile_project_repo_sync_states") return [{ projectId: project.id, status: "syncing" }];
    if (command === "list_project_repo_sync_states") {
      polling.resolve();
      await nativeFinished.promise;
      return [{ projectId: project.id, status: "upToDate" }];
    }
    return null;
  };
  const sync = reconcileProjectRepoSyncStates(() => {}, team, [project]);
  await polling.promise;
  const softDelete = deleteProject(() => {}, project.id);
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(state.deletedProjects[0]?.pendingMutation, "softDelete");
    permanentlyDeleteProject(() => {}, project.id);
    assert.equal(state.projectPermanentDeletion.isOpen, false);
    assert.equal(invokeCalls.some((call) => call.command === "purge_local_gtms_project_repo"), false);
    nativeFinished.resolve();
    await Promise.all([sync, softDelete]);
    assert.equal(state.deletedProjects[0]?.pendingMutation, null);
    permanentlyDeleteProject(() => {}, project.id);
    updateProjectPermanentDeletionConfirmation(project.title);
    await confirmProjectPermanentDeletion(() => {});
    assert.equal(state.deletedProjects.length, 0);
    assert.equal(invokeCalls.filter((call) => call.command === "purge_local_gtms_project_repo").length, 1);
  } finally {
    nativeFinished.resolve();
    await Promise.all([sync, softDelete]);
    __setProjectRepoSyncTiming();
    resetRepoWriteQueue();
  }
});

for (const fails of [false, true]) {
  test(`purge completion preserves a replacement modal on the same team, failure=${fails}`, async () => {
    setupProjectPermanentDeletionState();
    const finish = deferred();
    invokeHandler = async () => {
      await finish.promise;
      if (fails) throw new Error("Filesystem busy");
    };
    const removal = confirmProjectPermanentDeletion(() => {});
    const replacement = { ...state.projectPermanentDeletion, status: "idle", projectId: "another-project" };
    state.projectPermanentDeletion = replacement;
    finish.resolve();
    await removal;
    assert.equal(state.projectPermanentDeletion, replacement);
    assert.equal(replacement.error, "");
  });
}

test("stale project-page ownership cannot remove another team's local copy", async () => {
  const { project } = setupProjectPermanentDeletionState();
  state.projectsPage.visibleTeamId = "previous-team";
  permanentlyDeleteProject(() => {}, project.id);
  await confirmProjectPermanentDeletion(() => {});
  assert.equal(invokeCalls.length, 0);
  assert.equal(state.projectDiscovery.status, "ready");
});

for (const destination of ["signed-out", "other-account", "same-account"]) {
  test(`local purge finishing after ${destination} persists only to its originating account`, async () => {
    const { team, project } = setupProjectPermanentDeletionState();
    const { saveStoredProjectsForTeam, loadStoredProjectsForTeam,
      saveStoredChapterPendingMutations, loadStoredChapterPendingMutations } = await import("./project-cache.js");
    const { isLocalHardDeletedResource } = await import("./local-hard-delete-store.js");
    const finish = deferred();
    invokeHandler = () => finish.promise;
    const other = deletedProject({ id: "keep", name: "keep", fullName: "team-1/keep" });
    saveStoredProjectsForTeam(team, { deletedProjects: [project, other] });
    saveStoredChapterPendingMutations(team, [{ projectId: project.id }, { projectId: other.id }]);
    const removal = confirmProjectPermanentDeletion(() => {});
    resetSessionState();
    queryClient.clear();
    const nextLogin = destination === "signed-out" ? null
      : destination === "same-account" ? STORAGE_LOGIN : "local-removal-other-account";
    setActiveStorageLogin(nextLogin);
    const nextQuery = createProjectsQuerySnapshot({ items: [other] });
    queryClient.setQueryData(projectKeys.byTeam(team.id), nextQuery);
    const beforeState = JSON.stringify(state);
    finish.resolve();
    await removal;
    assert.equal(JSON.stringify(state), beforeState);
    assert.deepEqual(queryClient.getQueryData(projectKeys.byTeam(team.id)), nextQuery);
    if (destination === "other-account") {
      assert.equal(isLocalHardDeletedResource(team, "project", project), false);
      assert.equal(loadStoredProjectsForTeam(team).exists, false);
      assert.deepEqual(loadStoredChapterPendingMutations(team), []);
    }
    setActiveStorageLogin(STORAGE_LOGIN);
    assert.equal(isLocalHardDeletedResource(team, "project", project), true);
    assert.deepEqual(loadStoredProjectsForTeam(team).deletedProjects.map(p => p.id), ["keep"]);
    assert.deepEqual(loadStoredChapterPendingMutations(team), [{ projectId: "keep" }]);
    removePersistentValue(`gnosis-tms-chapter-pending-mutations:${STORAGE_LOGIN}`);
    for (const key of ["gnosis-tms-project-cache", "gnosis-tms-chapter-pending-mutations", "gnosis-tms-local-hard-delete-tombstones"]) {
      removePersistentValue(`${key}:local-removal-other-account`);
    }
  });
}

test("a stale active refresh cannot restore a locally removed project", async () => {
  const { project, team } = setupProjectPermanentDeletionState();
  const { isLocalHardDeletedResource } = await import("./local-hard-delete-store.js");
  const stale = createProjectsQuerySnapshot({ items: [{ ...project, lifecycleState: "active" }] });
  await confirmProjectPermanentDeletion(() => {});
  for (const isFetching of [true, false]) {
    applyProjectsQuerySnapshotToState(stale, { teamId: team.id, isFetching });
    assert.deepEqual(state.projects, []);
    assert.deepEqual(state.deletedProjects, []);
    assert.equal(isLocalHardDeletedResource(team, "project", project), true);
  }
});

test("failed purge after an account switch leaves both accounts and the new query unchanged", async () => {
  const { team, project } = setupProjectPermanentDeletionState();
  const { saveStoredProjectsForTeam, loadStoredProjectsForTeam } = await import("./project-cache.js");
  const { isLocalHardDeletedResource } = await import("./local-hard-delete-store.js");
  saveStoredProjectsForTeam(team, { deletedProjects: [project] });
  const finish = deferred();
  invokeHandler = async () => {
    await finish.promise;
    throw new Error("Filesystem busy");
  };
  const removal = confirmProjectPermanentDeletion(() => {});
  resetSessionState();
  setActiveStorageLogin("local-removal-failed-other");
  const nextQuery = createProjectsQuerySnapshot();
  queryClient.setQueryData(projectKeys.byTeam(team.id), nextQuery);
  const before = JSON.stringify(state);
  finish.resolve();
  await removal;
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(queryClient.getQueryData(projectKeys.byTeam(team.id)), nextQuery);
  assert.equal(isLocalHardDeletedResource(team, "project", project), false);
  assert.equal(loadStoredProjectsForTeam(team).exists, false);
  setActiveStorageLogin(STORAGE_LOGIN);
  assert.equal(isLocalHardDeletedResource(team, "project", project), false);
  assert.deepEqual(loadStoredProjectsForTeam(team).deletedProjects.map(item => item.id), [project.id]);
});
