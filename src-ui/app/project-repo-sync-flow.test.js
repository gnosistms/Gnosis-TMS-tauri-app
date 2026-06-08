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
  __setProjectRepoSyncTiming,
  reconcileProjectRepoSyncStates,
} = await import("./project-repo-sync-flow.js");
const {
  __setRepoWriteOverdueReporter,
  __setRepoWriteOverdueScheduler,
  __setRepoWriteQueueClock,
  enqueueRepoWrite,
  getRepoWriteQueueSnapshot,
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
  __setProjectRepoSyncTiming();
  resetRepoWriteQueue();
  resetSessionState();
});

test("project repo sync waits behind an existing repo queue write for the same repo", async () => {
  const events = [];
  setupProjectRepoSyncTest(events);
  const timers = [];
  let currentTimeMs = Date.now();
  __setRepoWriteQueueClock(() => currentTimeMs);
  __setRepoWriteOverdueReporter(() => {});
  __setRepoWriteOverdueScheduler(
    (callback, delayMs) => {
      const timer = { callback, delayMs, cancelled: false };
      timers.push(timer);
      return timer;
    },
    (timer) => {
      if (timer) {
        timer.cancelled = true;
      }
    },
  );
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
  assert.equal(state.statusBadges.right.text, "Waiting for local saves in 1 project repo...");
  const running = getRepoWriteQueueSnapshot("1:project-1:repo-one").operations[0];
  currentTimeMs = Date.parse(running.startedAt) + 15_000;
  timers[0].callback();
  await delay(0);
  assert.equal(
    state.statusBadges.right.text,
    "Waiting for local saves in 1 project repo... (taking longer than expected)",
  );

  releaseEditorWrite.resolve();
  await Promise.all([editorWrite, sync]);

  assert.deepEqual(events, [
    "editor:start",
    "editor:end",
    "reconcile_project_repo_sync_states:project-1",
  ]);
});

test("project repo sync does not label active repo operations as local saves", async () => {
  const events = [];
  setupProjectRepoSyncTest(events);
  const releaseRepoOperation = deferred();
  const repoOperation = enqueueRepoWrite({
    scope: "1:project-1:repo-one",
    kind: "projectRepoMaintenance",
    run: async () => {
      events.push("repo-operation:start");
      await releaseRepoOperation.promise;
      events.push("repo-operation:end");
    },
  });
  await delay(0);

  const sync = reconcileProjectRepoSyncStates(() => {}, team(), [project()]);
  await delay(5);

  assert.deepEqual(events, ["repo-operation:start"]);
  assert.equal(state.statusBadges.right.text, "Waiting for project repo operation in 1 project repo...");

  releaseRepoOperation.resolve();
  await Promise.all([repoOperation, sync]);

  assert.deepEqual(events, [
    "repo-operation:start",
    "repo-operation:end",
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

test("project repo sync does not report its own sync operation as a waiting repo operation", async () => {
  const events = [];
  setupProjectRepoSyncTest(events);
  const releaseReconcile = deferred();
  invokeHandler = async (command, payload) => {
    const projectId = payload?.input?.projects?.[0]?.projectId ?? "unknown";
    events.push(`${command}:${projectId}`);
    if (command === "reconcile_project_repo_sync_states") {
      await releaseReconcile.promise;
    }
    return [{
      projectId,
      repoName: payload?.input?.projects?.[0]?.repoName ?? "",
      status: "clean",
    }];
  };

  const sync = reconcileProjectRepoSyncStates(() => {}, team(), [project()]);
  await delay(5);

  // The in-flight projectRepoSync op is running on the repo scope, but the badge must
  // not label it as a repo operation we are waiting on.
  assert.equal(state.statusBadges.right.text, "Checking local repos...");

  releaseReconcile.resolve();
  await sync;
});

test("project repo sync polling exits and marks a repo stalled after no progress", async () => {
  const events = [];
  setupProjectRepoSyncTest(events);
  let nowMs = 1_000;
  __setProjectRepoSyncTiming({
    now: () => nowMs,
    delay: async (delayMs) => {
      nowMs += delayMs;
    },
  });
  invokeHandler = async (command, payload) => {
    const projectId = payload?.input?.projects?.[0]?.projectId ?? "unknown";
    events.push(`${command}:${projectId}`);
    return [{
      projectId,
      repoName: payload?.input?.projects?.[0]?.repoName ?? "",
      status: "syncing",
      message: "Syncing project repo...",
    }];
  };
  const appliedSnapshots = [];

  const snapshots = await reconcileProjectRepoSyncStates(() => {}, team(), [project()], {
    applySnapshots: (nextSnapshots) => {
      appliedSnapshots.push(nextSnapshots);
      state.projectRepoSyncByProjectId = Object.fromEntries(
        (nextSnapshots || []).map((snapshot) => [snapshot.projectId, snapshot]),
      );
    },
  });

  assert.equal(
    events.filter((event) => event === "list_project_repo_sync_states:project-1").length,
    8,
  );
  assert.equal(snapshots[0].status, "syncStalled");
  assert.equal(snapshots[0].syncStalled, true);
  assert.equal(appliedSnapshots.at(-1)[0].status, "syncStalled");
  assert.equal(state.projectRepoSyncByProjectId["project-1"].syncStalled, true);
  assert.equal(state.statusBadges.right.visible, false);
  assert.equal(
    state.statusBadges.left.text,
    "1 project repo sync is taking longer than expected; try refreshing again",
  );
});
