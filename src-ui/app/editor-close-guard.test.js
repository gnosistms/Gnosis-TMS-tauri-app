import test from "node:test";
import assert from "node:assert/strict";

import { createEditorCloseGuard } from "./editor-close-guard.js";

function createGuardHarness({ pending = true } = {}) {
  const harness = {
    pending,
    blockedCount: 0,
  };
  harness.guard = createEditorCloseGuard({
    hasPendingDurableWrites: () => harness.pending,
    onCloseBlocked: () => {
      harness.blockedCount += 1;
    },
  });
  return harness;
}

test("close proceeds without opening the wait session when no durable writes are pending", () => {
  const harness = createGuardHarness({ pending: false });

  const result = harness.guard.handleCloseRequest();

  assert.deepEqual(result, { allowClose: true });
  assert.equal(harness.blockedCount, 0);
});

test("a close attempt with pending writes is blocked and opens the wait session", () => {
  const harness = createGuardHarness();

  const result = harness.guard.handleCloseRequest();

  assert.deepEqual(result, { allowClose: false });
  assert.equal(harness.blockedCount, 1);
});

test("repeated close attempts stay blocked and re-notify the wait session", () => {
  const harness = createGuardHarness();

  harness.guard.handleCloseRequest();
  const repeat = harness.guard.handleCloseRequest();

  assert.deepEqual(repeat, { allowClose: false });
  assert.equal(harness.blockedCount, 2);
});

test("writes draining between attempts allows the close", () => {
  const harness = createGuardHarness();

  harness.guard.handleCloseRequest();
  harness.pending = false;
  const drained = harness.guard.handleCloseRequest();

  assert.deepEqual(drained, { allowClose: true });
  assert.equal(harness.blockedCount, 1);
});
