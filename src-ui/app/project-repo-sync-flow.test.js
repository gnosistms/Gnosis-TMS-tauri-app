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
const {
  deferProjectsRenderWhileSelectEngaged,
  flushProjectsHeldRender,
  resetProjectsRenderHoldForTests,
} = await import("./projects-render-hold.js");
const { clearNoticeBadge } = await import("./status-feedback.js");

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

for (const status of ["upToDate", "syncError"]) {
  test(`sync completion preserves the held full render for ${status}`, async (t) => {
    setupProjectRepoSyncTest();
    state.screen = "projects";
    const previousSelectElement = globalThis.HTMLSelectElement;
    class ChapterSelect {
      matches(selector) {
        return selector.includes("[data-chapter-status-select]");
      }
    }
    globalThis.HTMLSelectElement = ChapterSelect;
    document.activeElement = new ChapterSelect();
    t.after(() => {
      document.activeElement = null;
      if (previousSelectElement === undefined) delete globalThis.HTMLSelectElement;
      else globalThis.HTMLSelectElement = previousSelectElement;
      resetProjectsRenderHoldForTests();
      clearNoticeBadge();
    });
    invokeHandler = async () => [{ projectId: "project-1", repoName: "repo-one", status }];
    const performed = [];
    const render = (options = {}) => {
      const perform = () => performed.push({
        scope: options.scope ?? "full",
        status: state.projectRepoSyncByProjectId["project-1"]?.status,
        syncBadgeVisible: state.statusBadges.right.visible,
        noticeVisible: state.statusBadges.left.visible,
      });
      if (!deferProjectsRenderWhileSelectEngaged(state, perform)) perform();
    };

    await reconcileProjectRepoSyncStates(render, team(), [project()]);
    assert.deepEqual(performed, [], "keep the dropdown intact during sync");
    document.activeElement = null;
    flushProjectsHeldRender();
    assert.deepEqual(performed, [{
      scope: "full",
      status,
      syncBadgeVisible: false,
      noticeVisible: status === "syncError",
    }]);
  });
}

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

for (const stallReason of ["noProgress", "maxDuration"]) {
  for (const cancelDiscovery of [false, true]) {
    test(`slow sync retains queued writes after ${stallReason}, canceled=${cancelDiscovery}`, async () => {
      setupProjectRepoSyncTest();
      const beyondStall = deferred();
      const finishSync = deferred();
      let nowMs = 1_000;
      let polls = 0;
      let canceled = false;
      let imported = false;
      __setProjectRepoSyncTiming({
        now: () => nowMs,
        delay: async (delayMs) => {
          nowMs += stallReason === "maxDuration" ? 30_000 : delayMs;
        },
      });
      invokeHandler = async (command) => {
        let status = "syncing";
        if (command === "list_project_repo_sync_states" && ++polls === 10) {
          beyondStall.resolve();
          await finishSync.promise;
          status = "upToDate";
        }
        return [{ projectId: "project-1", repoName: "repo-one", status }];
      };
      const published = [];
      const sync = reconcileProjectRepoSyncStates(() => {}, team(), [project()], {
        shouldAbort: () => canceled,
        onSnapshots: (snapshots) => published.push(snapshots[0]),
      });
      await beyondStall.promise;
      assert.equal(published.at(-1).status, "syncStalled");
      assert.equal(published.at(-1).stallReason, stallReason);
      assert.equal(published.length, 2, "unchanged stalled polls do not keep rendering");
      canceled = cancelDiscovery;
      const localWrite = enqueueRepoWrite({
        scope: "1:project-1:repo-one",
        kind: "projectImport",
        run: async () => { imported = true; },
      });
      await delay(0);
      assert.equal(imported, false, "a stall or cancellation must not release native queue ownership");
      finishSync.resolve();
      const [snapshots] = await Promise.all([sync, localWrite]);
      assert.equal(imported, true);
      assert.equal(snapshots[0].status, "upToDate", "terminal status wins even after the timeout");
      assert.deepEqual(published.map((snapshot) => snapshot.status), cancelDiscovery
        ? ["syncing", "syncStalled"]
        : ["syncing", "syncStalled", "upToDate"]);
    });
  }
}

test("unchanged repo polls skip publication and rendering but changed details still publish", async () => {
  setupProjectRepoSyncTest();
  let polls = 0;
  let fullRenders = 0;
  let rendersAfterPreviousUpdate = 0;
  const publications = [];
  const initial = {
    projectId: "project-1",
    repoName: "repo-one",
    status: "syncing",
    message: "Syncing project repo...",
  };
  __setProjectRepoSyncTiming({ delay: async () => {} });
  invokeHandler = async (command) => {
    if (command === "reconcile_project_repo_sync_states") return [{ ...initial }];
    assert.equal(command, "list_project_repo_sync_states");
    polls += 1;
    if (polls === 1) rendersAfterPreviousUpdate = fullRenders;
    if (polls === 3) {
      assert.equal(fullRenders, rendersAfterPreviousUpdate, "identical polls must not render");
      assert.equal(publications.length, 1);
      // A field outside the stall-detection signature must still be delivered.
      return [{ ...initial, localPath: "/updated/project/path" }];
    }
    if (polls === 4) {
      assert.equal(fullRenders, rendersAfterPreviousUpdate + 1);
      assert.equal(publications.at(-1).localPath, "/updated/project/path");
      return [{ ...initial, status: "clean" }];
    }
    return [{ ...initial }];
  };

  const result = await reconcileProjectRepoSyncStates((options) => {
    if (!options?.scope) fullRenders += 1;
  }, team(), [project()], {
    onSnapshots: (snapshots) => publications.push(snapshots[0]),
  });

  assert.equal(polls, 4);
  assert.deepEqual(publications.map((snapshot) => snapshot.status), ["syncing", "syncing", "clean"]);
  assert.equal(fullRenders, 4, "three changed snapshots plus final reconciliation");
  assert.equal(result[0].status, "clean");
  assert.equal(state.projectRepoSyncByProjectId["project-1"].status, "clean");
});

test("canceling discovery keeps local writes queued until the native sync finishes", async () => {
  setupProjectRepoSyncTest();
  const pollStarted = deferred();
  const syncFinished = deferred();
  let canceled = false;
  let imported = false;
  let publicationsAfterCancel = 0;
  __setProjectRepoSyncTiming({ delay: async () => {} });
  invokeHandler = async (command) => {
    if (command === "reconcile_project_repo_sync_states") {
      canceled = true;
      return [{ projectId: "project-1", repoName: "repo-one", status: "syncing" }];
    }
    if (command === "list_project_repo_sync_states") {
      pollStarted.resolve();
      await syncFinished.promise;
      return [{ projectId: "project-1", repoName: "repo-one", status: "upToDate" }];
    }
    return [];
  };
  const sync = reconcileProjectRepoSyncStates(() => {}, team(), [project()], {
    shouldAbort: () => canceled,
    mergeSnapshots: () => { if (canceled) publicationsAfterCancel += 1; },
    applySnapshots: () => { if (canceled) publicationsAfterCancel += 1; },
  });
  await pollStarted.promise;
  const localWrite = enqueueRepoWrite({
    scope: "1:project-1:repo-one",
    kind: "projectImport",
    run: async () => { imported = true; },
  });
  await delay(0);
  assert.equal(imported, false);
  syncFinished.resolve();
  await Promise.all([sync, localWrite]);
  assert.equal(imported, true);
  assert.equal(publicationsAfterCancel, 0);
});
