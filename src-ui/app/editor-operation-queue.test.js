import test from "node:test";
import assert from "node:assert/strict";

import {
  createEditorOperationQueue,
  resetEditorOperationQueue,
} from "./editor-operation-queue.js";
import {
  enqueueRepoWrite,
  flushRepoWriteQueue,
  resetRepoWriteQueue,
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
  resetEditorOperationQueue();
  resetRepoWriteQueue();
});

test("queued editor operations with the same coalesce key run only the latest command", async () => {
  const queue = createEditorOperationQueue();
  const releaseBlocker = deferred();
  const events = [];
  const optimisticValues = [];
  const repoScope = "7:project-1:repo-one";

  const blocker = enqueueRepoWrite({
    scope: repoScope,
    kind: "blocker",
    run: async () => {
      events.push("blocker:start");
      await releaseBlocker.promise;
      events.push("blocker:end");
    },
  });
  await delay(0);

  const first = queue.requestOperation({
    operationId: "marker-1",
    repoScope,
    rowScope: "row-1",
    coalesceKey: "row-1:please-check",
    kind: "marker",
    value: { pleaseCheck: true },
  }, {
    applyOptimistic: (operation) => optimisticValues.push(operation.value.pleaseCheck),
    run: async (operation) => {
      events.push(`run:${operation.value.pleaseCheck}`);
    },
  });

  const second = queue.requestOperation({
    operationId: "marker-2",
    repoScope,
    rowScope: "row-1",
    coalesceKey: "row-1:please-check",
    kind: "marker",
    value: { pleaseCheck: false },
  }, {
    applyOptimistic: (operation) => optimisticValues.push(operation.value.pleaseCheck),
    run: async (operation) => {
      events.push(`run:${operation.value.pleaseCheck}`);
    },
  });

  assert.equal(queue.getOperation("marker-1").status, "cancelled");
  assert.deepEqual(optimisticValues, [true, false]);

  releaseBlocker.resolve();
  await Promise.all([blocker, first.promise, second.promise]);

  assert.deepEqual(events, ["blocker:start", "blocker:end", "run:false"]);
  assert.equal(queue.getOperation("marker-2").status, "succeeded");
});

test("running stale editor operation success does not reconcile over a newer intent", async () => {
  const queue = createEditorOperationQueue();
  const repoScope = "7:project-1:repo-one";
  const firstStarted = deferred();
  const releaseFirst = deferred();
  const successes = [];
  const staleSuccesses = [];
  const runs = [];

  const first = queue.requestOperation({
    operationId: "marker-1",
    repoScope,
    coalesceKey: "row-1:reviewed",
    kind: "marker",
    value: { reviewed: true },
  }, {
    run: async (operation) => {
      runs.push(`run:${operation.value.reviewed}`);
      firstStarted.resolve();
      await releaseFirst.promise;
      return operation.value.reviewed;
    },
    onSuccess: (_result, operation) => successes.push(operation.operationId),
    onStaleSuccess: (_result, operation) => staleSuccesses.push(operation.operationId),
  });

  await firstStarted.promise;

  const second = queue.requestOperation({
    operationId: "marker-2",
    repoScope,
    coalesceKey: "row-1:reviewed",
    kind: "marker",
    value: { reviewed: false },
  }, {
    run: async (operation) => {
      runs.push(`run:${operation.value.reviewed}`);
      return operation.value.reviewed;
    },
    onSuccess: (_result, operation) => successes.push(operation.operationId),
    onStaleSuccess: (_result, operation) => staleSuccesses.push(operation.operationId),
  });

  assert.equal(queue.getOperation("marker-1").stale, true);
  assert.equal(queue.getOperation("marker-1").supersededBy, "marker-2");

  releaseFirst.resolve();
  await Promise.all([first.promise, second.promise]);

  assert.deepEqual(runs, ["run:true", "run:false"]);
  assert.deepEqual(staleSuccesses, ["marker-1"]);
  assert.deepEqual(successes, ["marker-2"]);
});

test("editor operation permission denial prevents the Tauri command callback", async () => {
  const queue = createEditorOperationQueue();
  let commandRan = false;

  const operation = queue.requestOperation({
    operationId: "row-text-1",
    repoScope: "7:project-1:repo-one",
    rowScope: "row-1",
    kind: "rowText",
    value: { text: "updated" },
  }, {
    checkPermission: () => ({ allowed: false, message: "Cannot save changes now." }),
    run: async () => {
      commandRan = true;
    },
  });

  await assert.rejects(operation.promise, /Cannot save changes now/);

  assert.equal(commandRan, false);
  assert.equal(queue.getOperation("row-text-1").status, "failed");
  assert.equal(queue.getOperation("row-text-1").error, "Cannot save changes now.");
});

test("editor operation publishes invalidation keys after latest success", async () => {
  const invalidations = [];
  const queue = createEditorOperationQueue({
    publishInvalidation: (invalidation) => invalidations.push(invalidation),
  });

  const operation = queue.requestOperation({
    operationId: "row-text-1",
    repoScope: "7:project-1:repo-one",
    rowScope: "row-1",
    kind: "rowText",
    value: { text: "updated" },
    invalidationKeys: ["chapter:project-1:chapter-1"],
  }, {
    run: async () => ({ ok: true }),
  });

  await operation.promise;

  assert.equal(queue.getOperation("row-text-1").status, "succeeded");
  assert.deepEqual(invalidations, [
    {
      keys: ["chapter:project-1:chapter-1"],
      repoScope: "7:project-1:repo-one",
      operationId: "row-text-1",
      sourceScreen: "editor",
      metadata: null,
    },
  ]);
});

test("editor queue snapshot reports active operations by repo scope", async () => {
  const queue = createEditorOperationQueue();
  const releaseWrite = deferred();
  const operation = queue.requestOperation({
    operationId: "row-text-1",
    repoScope: "7:project-1:repo-one",
    rowScope: "row-1",
    kind: "rowText",
    value: { text: "updated" },
  }, {
    run: async () => {
      await releaseWrite.promise;
    },
  });

  await delay(0);

  assert.equal(queue.getSnapshot({ repoScope: "7:project-1:repo-one" }).runningCount, 1);
  assert.equal(queue.anyActive((item) => item.repoScope === "7:project-1:repo-one"), true);

  releaseWrite.resolve();
  await operation.promise;

  assert.equal(queue.getSnapshot({ repoScope: "7:project-1:repo-one" }).activeCount, 0);
});

test("waitForIdle resolves after matching editor operations finish", async () => {
  const queue = createEditorOperationQueue();
  const releaseMatchingWrite = deferred();
  const matchingOperation = queue.requestOperation({
    operationId: "row-text-1",
    repoScope: "7:project-1:repo-one",
    rowScope: "row-1",
    kind: "rowText",
    value: { text: "updated" },
    metadata: { chapterId: "chapter-1" },
  }, {
    run: async () => {
      await releaseMatchingWrite.promise;
    },
  });

  await delay(0);

  let resolved = false;
  const wait = queue.waitForIdle((operation) =>
    operation.repoScope === "7:project-1:repo-one"
    && operation.metadata?.chapterId === "chapter-1",
  ).then(() => {
    resolved = true;
  });
  await delay(0);

  assert.equal(resolved, false);

  releaseMatchingWrite.resolve();
  await matchingOperation.promise;
  await wait;

  assert.equal(resolved, true);
});

test("waitForIdle ignores non-matching active editor operations", async () => {
  const queue = createEditorOperationQueue();
  const releaseOtherWrite = deferred();
  const otherOperation = queue.requestOperation({
    operationId: "row-text-2",
    repoScope: "7:project-1:repo-one",
    rowScope: "row-2",
    kind: "rowText",
    value: { text: "other" },
    metadata: { chapterId: "chapter-2" },
  }, {
    run: async () => {
      await releaseOtherWrite.promise;
    },
  });

  await delay(0);
  await queue.waitForIdle((operation) =>
    operation.repoScope === "7:project-1:repo-one"
    && operation.metadata?.chapterId === "chapter-1",
  );

  assert.equal(queue.anyActive((operation) => operation.operationId === "row-text-2"), true);

  releaseOtherWrite.resolve();
  await otherOperation.promise;
});
