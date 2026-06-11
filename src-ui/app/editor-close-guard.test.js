import test from "node:test";
import assert from "node:assert/strict";

import {
  createEditorCloseGuard,
  EDITOR_CLOSE_GUARD_NOTICE,
  EDITOR_CLOSE_GUARD_REPEAT_MIN_DELAY_MS,
  EDITOR_CLOSE_GUARD_REPEAT_WINDOW_MS,
} from "./editor-close-guard.js";

function createGuardHarness({ pending = true } = {}) {
  const harness = {
    pending,
    notices: [],
    nowMs: 0,
  };
  harness.guard = createEditorCloseGuard({
    hasPendingDurableWrites: () => harness.pending,
    showBlockedNotice: (message) => harness.notices.push(message),
    now: () => harness.nowMs,
  });
  return harness;
}

test("close proceeds without a notice when no durable writes are pending", () => {
  const harness = createGuardHarness({ pending: false });

  const result = harness.guard.handleCloseRequest();

  assert.deepEqual(result, { allowClose: true, forced: false });
  assert.deepEqual(harness.notices, []);
});

test("first close attempt with pending writes is blocked and shows the notice", () => {
  const harness = createGuardHarness();

  const result = harness.guard.handleCloseRequest();

  assert.deepEqual(result, { allowClose: false, forced: false });
  assert.deepEqual(harness.notices, [EDITOR_CLOSE_GUARD_NOTICE]);
});

test("second close attempt after the minimum delay force-allows the close", () => {
  const harness = createGuardHarness();

  harness.guard.handleCloseRequest();
  harness.nowMs = EDITOR_CLOSE_GUARD_REPEAT_MIN_DELAY_MS;
  const result = harness.guard.handleCloseRequest();

  assert.deepEqual(result, { allowClose: true, forced: true });
  assert.deepEqual(harness.notices, [EDITOR_CLOSE_GUARD_NOTICE]);
});

test("a rapid repeat attempt stays blocked but keeps the escape hatch armed", () => {
  const harness = createGuardHarness();

  harness.guard.handleCloseRequest();
  harness.nowMs = EDITOR_CLOSE_GUARD_REPEAT_MIN_DELAY_MS - 1;
  const rapid = harness.guard.handleCloseRequest();
  harness.nowMs = EDITOR_CLOSE_GUARD_REPEAT_MIN_DELAY_MS;
  const armed = harness.guard.handleCloseRequest();

  assert.deepEqual(rapid, { allowClose: false, forced: false });
  assert.deepEqual(armed, { allowClose: true, forced: true });
  assert.deepEqual(harness.notices, [EDITOR_CLOSE_GUARD_NOTICE, EDITOR_CLOSE_GUARD_NOTICE]);
});

test("an attempt after the repeat window counts as a fresh blocked attempt", () => {
  const harness = createGuardHarness();

  harness.guard.handleCloseRequest();
  harness.nowMs = EDITOR_CLOSE_GUARD_REPEAT_WINDOW_MS + 1;
  const stale = harness.guard.handleCloseRequest();
  harness.nowMs += EDITOR_CLOSE_GUARD_REPEAT_MIN_DELAY_MS;
  const armed = harness.guard.handleCloseRequest();

  assert.deepEqual(stale, { allowClose: false, forced: false });
  assert.deepEqual(armed, { allowClose: true, forced: true });
  assert.deepEqual(harness.notices, [EDITOR_CLOSE_GUARD_NOTICE, EDITOR_CLOSE_GUARD_NOTICE]);
});

test("writes draining between attempts allows the close without forcing and disarms the hatch", () => {
  const harness = createGuardHarness();

  harness.guard.handleCloseRequest();
  harness.pending = false;
  harness.nowMs = EDITOR_CLOSE_GUARD_REPEAT_MIN_DELAY_MS;
  const drained = harness.guard.handleCloseRequest();

  harness.pending = true;
  harness.nowMs += EDITOR_CLOSE_GUARD_REPEAT_MIN_DELAY_MS;
  const reblocked = harness.guard.handleCloseRequest();

  assert.deepEqual(drained, { allowClose: true, forced: false });
  assert.deepEqual(reblocked, { allowClose: false, forced: false });
  assert.deepEqual(harness.notices, [EDITOR_CLOSE_GUARD_NOTICE, EDITOR_CLOSE_GUARD_NOTICE]);
});
