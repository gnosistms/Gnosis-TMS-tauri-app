import test from "node:test";
import assert from "node:assert/strict";

let invokeHandler = async () => [];

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
      invoke: (command, payload) => invokeHandler(command, payload),
    },
  },
  requestAnimationFrame(callback) {
    return setTimeout(callback, 0);
  },
  setTimeout,
  clearTimeout,
};

const { resetSessionState, state } = await import("./state.js");
const {
  reconcileProjectRepoSyncStates,
} = await import("./project-repo-sync-flow.js");
const {
  enqueueRepoWrite,
  resetRepoWriteQueue,
} = await import("./repo-write-queue.js");

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

function team() {
  return {
    id: "team-1",
    installationId: 1,
  };
}

function project(overrides = {}) {
  return {
    id: "project-1",
    name: "repo-one",
    fullName: "org/repo-one",
    lifecycleState: "active",
    ...overrides,
  };
}

function setupProjectRepoSyncTest(events = []) {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.teams = [team()];
  state.auth.session = { sessionToken: "token" };
  state.offline.isEnabled = false;
  invokeHandler = async (command, payload) => {
    const projectId = payload?.input?.projects?.[0]?.projectId ?? "unknown";
    events.push(`${command}:${projectId}`);
    return [{
      projectId,
      repoName: payload?.input?.projects?.[0]?.repoName ?? "",
      status: "clean",
    }];
  };
}

test.afterEach(() => {
  invokeHandler = async () => [];
  resetRepoWriteQueue();
  resetSessionState();
});

test("project repo sync waits behind an existing repo queue write for the same repo", async () => {
  const events = [];
  setupProjectRepoSyncTest(events);
  const releaseEditorWrite = deferred();
  const editorWrite = enqueueRepoWrite({
    scope: "1:project-1:repo-one",
    kind: "editor:rowText",
    run: async () => {
      events.push("editor:start");
      await releaseEditorWrite.promise;
      events.push("editor:end");
    },
  });
  await delay(0);

  const sync = reconcileProjectRepoSyncStates(() => {}, team(), [project()]);
  await delay(5);

  assert.deepEqual(events, ["editor:start"]);

  releaseEditorWrite.resolve();
  await Promise.all([editorWrite, sync]);

  assert.deepEqual(events, [
    "editor:start",
    "editor:end",
    "reconcile_project_repo_sync_states:project-1",
  ]);
});

test("project repo sync for another repo can run while an editor write is active", async () => {
  const events = [];
  setupProjectRepoSyncTest(events);
  const releaseEditorWrite = deferred();
  const editorWrite = enqueueRepoWrite({
    scope: "1:project-1:repo-one",
    kind: "editor:rowText",
    run: async () => {
      events.push("editor:start");
      await releaseEditorWrite.promise;
      events.push("editor:end");
    },
  });
  await delay(0);

  const sync = reconcileProjectRepoSyncStates(() => {}, team(), [
    project({ id: "project-2", name: "repo-two", fullName: "org/repo-two" }),
  ]);
  await delay(5);

  assert.deepEqual(events, [
    "editor:start",
    "reconcile_project_repo_sync_states:project-2",
  ]);

  releaseEditorWrite.resolve();
  await Promise.all([editorWrite, sync]);
});

test("whole-page project repo sync fans out and only waits for blocked repos", async () => {
  const events = [];
  setupProjectRepoSyncTest(events);
  const releaseEditorWrite = deferred();
  const editorWrite = enqueueRepoWrite({
    scope: "1:project-1:repo-one",
    kind: "editor:rowText",
    run: async () => {
      events.push("editor:start");
      await releaseEditorWrite.promise;
      events.push("editor:end");
    },
  });
  await delay(0);

  const sync = reconcileProjectRepoSyncStates(() => {}, team(), [
    project(),
    project({ id: "project-2", name: "repo-two", fullName: "org/repo-two" }),
  ]);
  await delay(5);

  assert.deepEqual(events, [
    "editor:start",
    "reconcile_project_repo_sync_states:project-2",
  ]);

  releaseEditorWrite.resolve();
  await Promise.all([editorWrite, sync]);

  assert.deepEqual(events, [
    "editor:start",
    "reconcile_project_repo_sync_states:project-2",
    "editor:end",
    "reconcile_project_repo_sync_states:project-1",
  ]);
});
