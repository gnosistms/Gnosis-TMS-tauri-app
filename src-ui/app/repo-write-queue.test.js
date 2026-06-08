import test from "node:test";
import assert from "node:assert/strict";

import {
  __setRepoWriteOverdueReporter,
  __setRepoWriteOverdueScheduler,
  __setRepoWriteQueueClock,
  clearRepoQueueErrors,
  consumeRepoInvalidations,
  enqueueRepoWrite,
  flushRepoWriteQueue,
  getRepoInvalidations,
  getRepoQueueErrors,
  getRepoWriteQueueSnapshot,
  projectRepoScope,
  publishRepoInvalidation,
  recordRepoQueueError,
  repoWriteQueueHasActiveWrites,
  resetRepoWriteQueue,
  resolveProjectRepoScope,
  subscribeRepoInvalidations,
  subscribeRepoWriteQueue,
} from "./repo-write-queue.js";

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

test.afterEach(async () => {
  await flushRepoWriteQueue().catch(() => {});
  resetRepoWriteQueue();
});

test("project repo scope helper returns full and fallback scopes", () => {
  assert.deepEqual(
    resolveProjectRepoScope({
      team: { installationId: 7 },
      project: { id: "project-1", name: "repo-one" },
    }),
    {
      scope: "7:project-1:repo-one",
      kind: "project-repo",
      installationId: "7",
      projectId: "project-1",
      repoName: "repo-one",
      reason: "",
    },
  );

  assert.equal(
    projectRepoScope({
      installationId: 7,
      projectId: "project-1",
    }),
    "7:project-1",
  );
  assert.equal(
    projectRepoScope({
      installationId: 7,
      repoName: "repo-one",
    }),
    "7:repo-one",
  );
  assert.equal(projectRepoScope({ installationId: 7 }), "7:projects");
  assert.equal(projectRepoScope({ team: { id: "team-1" } }), "team:team-1:projects");
  assert.equal(projectRepoScope({ team: { installationId: 7 } }, { metadataOnly: true }), null);
});

test("same-scope repo writes serialize", async () => {
  const events = [];
  const releaseFirstWrite = deferred();

  const first = enqueueRepoWrite({
    scope: "7:project-1:repo-one",
    kind: "first",
    run: async () => {
      events.push("first:start");
      await releaseFirstWrite.promise;
      events.push("first:end");
    },
  });
  const second = enqueueRepoWrite({
    scope: "7:project-1:repo-one",
    kind: "second",
    run: async () => {
      events.push("second:start");
      events.push("second:end");
    },
  });

  await delay(0);
  assert.deepEqual(events, ["first:start"]);
  assert.equal(repoWriteQueueHasActiveWrites("7:project-1:repo-one"), true);
  assert.equal(getRepoWriteQueueSnapshot("7:project-1:repo-one").queuedCount, 1);

  releaseFirstWrite.resolve();
  await Promise.all([first, second]);

  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
  assert.equal(repoWriteQueueHasActiveWrites("7:project-1:repo-one"), false);
});

test("durable local writes jump ahead of queued normal writes", async () => {
  const events = [];
  const releaseFirstWrite = deferred();

  const first = enqueueRepoWrite({
    scope: "7:project-1:repo-one",
    kind: "first",
    run: async () => {
      events.push("first:start");
      await releaseFirstWrite.promise;
      events.push("first:end");
    },
  });
  const background = enqueueRepoWrite({
    scope: "7:project-1:repo-one",
    kind: "editorBackgroundSync",
    run: async () => {
      events.push("background:start");
      events.push("background:end");
    },
  });
  const localSave = enqueueRepoWrite({
    scope: "7:project-1:repo-one",
    kind: "editor:rowText",
    priority: "durableLocal",
    run: async () => {
      events.push("local:start");
      events.push("local:end");
    },
  });

  await delay(0);
  assert.deepEqual(events, ["first:start"]);
  assert.deepEqual(
    getRepoWriteQueueSnapshot("7:project-1:repo-one")
      .scopes[0]
      .operations
      .filter((operation) => operation.status === "queued")
      .map((operation) => operation.kind),
    ["editor:rowText", "editorBackgroundSync"],
  );

  releaseFirstWrite.resolve();
  await Promise.all([first, background, localSave]);

  assert.deepEqual(events, [
    "first:start",
    "first:end",
    "local:start",
    "local:end",
    "background:start",
    "background:end",
  ]);
});

test("blocking local metadata writes jump ahead of durable editor writes", async () => {
  const events = [];
  const releaseFirstWrite = deferred();

  const first = enqueueRepoWrite({
    scope: "7:project-1:repo-one",
    kind: "first",
    run: async () => {
      events.push("first:start");
      await releaseFirstWrite.promise;
      events.push("first:end");
    },
  });
  const localSave = enqueueRepoWrite({
    scope: "7:project-1:repo-one",
    kind: "editor:rowText",
    operationType: "localEditorWrite",
    run: async () => {
      events.push("local:start");
      events.push("local:end");
    },
  });
  const conflictResolution = enqueueRepoWrite({
    scope: "7:project-1:repo-one",
    kind: "editor:clearImportedConflict",
    operationType: "localMetadataWrite",
    priority: "blockingLocal",
    run: async () => {
      events.push("conflict:start");
      events.push("conflict:end");
    },
  });

  await delay(0);
  assert.deepEqual(events, ["first:start"]);
  assert.deepEqual(
    getRepoWriteQueueSnapshot("7:project-1:repo-one")
      .scopes[0]
      .operations
      .filter((operation) => operation.status === "queued")
      .map((operation) => operation.kind),
    ["editor:clearImportedConflict", "editor:rowText"],
  );

  releaseFirstWrite.resolve();
  await Promise.all([first, localSave, conflictResolution]);

  assert.deepEqual(events, [
    "first:start",
    "first:end",
    "conflict:start",
    "conflict:end",
    "local:start",
    "local:end",
  ]);
});

test("repo queue snapshots expose local write and remote sync state separately", async () => {
  const releaseRemoteSync = deferred();

  const remoteSync = enqueueRepoWrite({
    scope: "7:project-1:repo-one",
    kind: "editorBackgroundSync",
    operationType: "remoteSync",
    run: async () => {
      await releaseRemoteSync.promise;
    },
  });

  await delay(0);
  const runningRemoteSnapshot = getRepoWriteQueueSnapshot("7:project-1:repo-one");
  assert.equal(runningRemoteSnapshot.hasActiveRemoteSync, true);
  assert.equal(runningRemoteSnapshot.hasRunningRemoteSync, true);
  assert.equal(runningRemoteSnapshot.hasActiveLocalWrites, false);
  assert.equal(runningRemoteSnapshot.operations[0].operationType, "remoteSync");

  releaseRemoteSync.resolve();
  await remoteSync;

  const releaseLocalWrite = deferred();
  const localWrite = enqueueRepoWrite({
    scope: "7:project-1:repo-one",
    kind: "editor:rowText",
    operationType: "localEditorWrite",
    run: async () => {
      await releaseLocalWrite.promise;
    },
  });

  await delay(0);
  const localSnapshot = getRepoWriteQueueSnapshot("7:project-1:repo-one");
  assert.equal(localSnapshot.hasActiveLocalWrites, true);
  assert.equal(localSnapshot.hasActiveRemoteSync, false);
  assert.equal(localSnapshot.operations[0].operationType, "localEditorWrite");

  releaseLocalWrite.resolve();
  await localWrite;
});

test("repo queue watchdog surfaces overdue writes without settling the operation", async () => {
  const releaseLocalWrite = deferred();
  const reports = [];
  const timers = [];
  let currentTimeMs = Date.now();
  __setRepoWriteQueueClock(() => currentTimeMs);
  __setRepoWriteOverdueReporter((payload) => {
    reports.push(payload);
  });
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

  let settled = false;
  const localWrite = enqueueRepoWrite({
    scope: "7:project-1:repo-one",
    kind: "editor:rowText",
    operationType: "localEditorWrite",
    run: async () => {
      await releaseLocalWrite.promise;
    },
  });
  localWrite.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );

  await delay(0);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delayMs, 15_000);

  const running = getRepoWriteQueueSnapshot("7:project-1:repo-one").operations[0];
  currentTimeMs = Date.parse(running.startedAt) + 15_000;
  timers[0].callback();
  timers[0].callback();
  await delay(0);

  const overdueSnapshot = getRepoWriteQueueSnapshot("7:project-1:repo-one");
  assert.equal(overdueSnapshot.hasOverdueWrites, true);
  assert.equal(overdueSnapshot.operations[0].overdue, true);
  assert.equal(overdueSnapshot.oldestActiveOperation.operationId, overdueSnapshot.operations[0].operationId);
  assert.equal(overdueSnapshot.scopes[0].hasOverdueWrites, true);
  assert.equal(overdueSnapshot.scopes[0].oldestActiveOperation.operationId, overdueSnapshot.operations[0].operationId);
  assert.equal(settled, false);
  assert.deepEqual(reports, [{
    operation: "repo_write_overdue",
    reason: "localEditorWrite",
  }]);

  releaseLocalWrite.resolve();
  await localWrite;
  assert.equal(timers[0].cancelled, true);
  assert.equal(getRepoWriteQueueSnapshot("7:project-1:repo-one").hasActiveWrites, false);
});

test("repo queue clears overdue timers when operations finish before the threshold", async () => {
  const timers = [];
  __setRepoWriteOverdueReporter(() => {
    throw new Error("Completed operations should not report overdue.");
  });
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

  const write = enqueueRepoWrite({
    scope: "7:project-1:repo-one",
    kind: "quick",
    run: async () => "done",
  });

  await write;
  assert.equal(timers.length, 1);
  assert.equal(timers[0].cancelled, true);
  timers[0].callback();
  assert.equal(getRepoWriteQueueSnapshot("7:project-1:repo-one").hasActiveWrites, false);
});

test("different repo scopes run concurrently", async () => {
  const events = [];
  const releaseFirstWrite = deferred();

  const first = enqueueRepoWrite({
    scope: "7:project-1:repo-one",
    kind: "first",
    run: async () => {
      events.push("first:start");
      await releaseFirstWrite.promise;
      events.push("first:end");
    },
  });
  const second = enqueueRepoWrite({
    scope: "7:project-2:repo-two",
    kind: "second",
    run: async () => {
      events.push("second:start");
      events.push("second:end");
    },
  });

  await delay(5);
  releaseFirstWrite.resolve();
  await Promise.all([first, second]);

  assert.deepEqual(events, ["first:start", "second:start", "second:end", "first:end"]);
});

test("runtime permission denial prevents repo command execution", async () => {
  let commandRan = false;

  const write = enqueueRepoWrite({
    scope: "7:project-1:repo-one",
    kind: "blocked",
    checkPermission: () => ({ allowed: false, message: "Cannot write now." }),
    run: async () => {
      commandRan = true;
    },
  });

  await assert.rejects(write, /Cannot write now/);

  assert.equal(commandRan, false);
  assert.equal(getRepoQueueErrors()[0].message, "Cannot write now.");
});

test("queue snapshot subscribers can derive visible status without inspecting promises", async () => {
  const releaseWrite = deferred();
  const snapshots = [];
  const unsubscribe = subscribeRepoWriteQueue((snapshot) => {
    snapshots.push({
      queuedCount: snapshot.queuedCount,
      runningCount: snapshot.runningCount,
      activeCount: snapshot.activeCount,
    });
  });

  const write = enqueueRepoWrite({
    scope: "7:project-1:repo-one",
    kind: "status",
    run: async () => {
      await releaseWrite.promise;
    },
  });

  await delay(0);
  releaseWrite.resolve();
  await write;
  unsubscribe();

  assert.ok(snapshots.some((snapshot) => snapshot.runningCount === 1));
  assert.ok(snapshots.at(-1).activeCount === 0);
});

test("durable queue errors and invalidations are stored independently of active queue state", () => {
  const error = recordRepoQueueError({
    repoScope: "7:project-1:repo-one",
    projectId: "project-1",
    chapterId: "chapter-1",
    rowId: "row-1",
    operationId: "op-1",
    kind: "rowText",
    message: "failed",
    sourceScreen: "editor",
  });

  assert.equal(error.message, "failed");
  assert.equal(getRepoQueueErrors()[0].rowId, "row-1");
  assert.equal(clearRepoQueueErrors((item) => item.operationId === "op-1"), true);
  assert.deepEqual(getRepoQueueErrors(), []);

  const invalidationEvents = [];
  const unsubscribe = subscribeRepoInvalidations((invalidation) => {
    invalidationEvents.push(invalidation);
  });
  const invalidation = publishRepoInvalidation({
    keys: ["chapter:project-1:chapter-1"],
    repoScope: "7:project-1:repo-one",
    operationId: "op-1",
    sourceScreen: "editor",
  });
  unsubscribe();

  assert.equal(invalidation.keys[0], "chapter:project-1:chapter-1");
  assert.equal(invalidationEvents[0].repoScope, "7:project-1:repo-one");
  assert.equal(getRepoInvalidations().length, 1);
  assert.equal(consumeRepoInvalidations((item) => item.repoScope === "7:project-1:repo-one").length, 1);
  assert.deepEqual(getRepoInvalidations(), []);
});
