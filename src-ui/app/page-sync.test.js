import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = globalThis.window ?? {
  setTimeout,
  clearTimeout,
};
globalThis.window.setTimeout = globalThis.window.setTimeout ?? setTimeout;
globalThis.window.clearTimeout = globalThis.window.clearTimeout ?? clearTimeout;

const { createPageSyncController } = await import("./page-sync.js");

function createHarness(initialState = { status: "idle", startedAt: null }) {
  const harness = {
    state: initialState,
    renderCalls: [],
  };
  harness.controller = createPageSyncController({
    getState: () => harness.state,
    setState: (nextState) => {
      harness.state = nextState;
    },
    countConcurrent: true,
    minSyncingDurationMs: 0,
    upToDateDurationMs: 60_000,
  });
  return harness;
}

test("concurrent page sync completion clears stale visible syncing state", async () => {
  const harness = createHarness({
    status: "syncing",
    startedAt: performance.now() - 1_000,
  });

  await harness.controller.complete((payload) => {
    harness.renderCalls.push(payload);
  });

  assert.equal(harness.state.status, "upToDate");
  assert.equal(harness.state.startedAt, null);
  assert.deepEqual(harness.renderCalls, [{ scope: "status-surface" }]);
});

test("concurrent page sync still waits for all active begins before completing", async () => {
  const harness = createHarness();
  harness.controller.begin();
  harness.controller.begin();

  await harness.controller.complete();

  assert.equal(harness.state.status, "syncing");

  await harness.controller.complete();

  assert.equal(harness.state.status, "upToDate");
});

test("concurrent page sync complete remains a no-op when nothing is syncing", async () => {
  const harness = createHarness();

  await harness.controller.complete();

  assert.equal(harness.state.status, "idle");
});
