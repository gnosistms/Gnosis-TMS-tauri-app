import test from "node:test";
import assert from "node:assert/strict";

import { state, createEditorCloseWaitState } from "./state.js";
import {
  createEditorCloseWaitController,
  EDITOR_CLOSE_WAIT_POLL_MS,
} from "./editor-close-wait-flow.js";

function createWaitHarness({ pendingCount = 3 } = {}) {
  const harness = {
    pendingCount,
    renderCount: 0,
    closeCalls: [],
    tick: null,
    cancelledHandles: [],
  };
  harness.controller = createEditorCloseWaitController({
    getPendingWriteCount: () => harness.pendingCount,
    schedule: (callback, delayMs) => {
      assert.equal(delayMs, EDITOR_CLOSE_WAIT_POLL_MS);
      harness.tick = callback;
      return "poll-handle";
    },
    cancel: (handle) => harness.cancelledHandles.push(handle),
  });
  harness.begin = () =>
    harness.controller.begin(() => {
      harness.renderCount += 1;
    }, {
      hasPendingDurableWrites: () => harness.pendingCount > 0,
      closeWindow: (options) => harness.closeCalls.push(options ?? {}),
    });
  return harness;
}

test.beforeEach(() => {
  state.editorCloseWait = createEditorCloseWaitState();
});

test("begin opens the wait state with the current pending count and renders", () => {
  const harness = createWaitHarness({ pendingCount: 4 });

  harness.begin();

  assert.deepEqual(state.editorCloseWait, { isOpen: true, pendingCount: 4, initialCount: 4 });
  assert.equal(harness.renderCount, 1);
  assert.equal(harness.controller.isOpen(), true);
  assert.deepEqual(harness.closeCalls, []);
});

test("a repeated begin while open is absorbed without resetting progress", () => {
  const harness = createWaitHarness({ pendingCount: 4 });

  harness.begin();
  harness.pendingCount = 2;
  harness.tick();
  harness.begin();

  assert.deepEqual(state.editorCloseWait, { isOpen: true, pendingCount: 2, initialCount: 4 });
  assert.equal(harness.renderCount, 2);
});

test("polling only renders when the pending count changes", () => {
  const harness = createWaitHarness({ pendingCount: 3 });

  harness.begin();
  harness.tick();
  assert.equal(harness.renderCount, 1);

  harness.pendingCount = 1;
  harness.tick();

  assert.deepEqual(state.editorCloseWait, { isOpen: true, pendingCount: 1, initialCount: 3 });
  assert.equal(harness.renderCount, 2);
});

test("draining writes closes the session and the window without force", () => {
  const harness = createWaitHarness({ pendingCount: 2 });

  harness.begin();
  harness.pendingCount = 0;
  harness.tick();

  assert.deepEqual(state.editorCloseWait, createEditorCloseWaitState());
  assert.deepEqual(harness.closeCalls, [{}]);
  assert.deepEqual(harness.cancelledHandles, ["poll-handle"]);
  assert.equal(harness.controller.isOpen(), false);
});

test("keepOpen cancels the pending close and leaves the window open", () => {
  const harness = createWaitHarness();

  harness.begin();
  harness.controller.keepOpen(() => {
    harness.renderCount += 1;
  });

  assert.deepEqual(state.editorCloseWait, createEditorCloseWaitState());
  assert.deepEqual(harness.closeCalls, []);
  assert.deepEqual(harness.cancelledHandles, ["poll-handle"]);
  assert.equal(harness.controller.isOpen(), false);

  // The session is gone, so a later poll tick (already cancelled in production)
  // and repeated keepOpen calls are no-ops.
  harness.controller.keepOpen(() => {
    harness.renderCount += 1;
  });
  assert.equal(harness.renderCount, 2);
});

test("forceClose closes the window with force while writes are still pending", () => {
  const harness = createWaitHarness({ pendingCount: 5 });

  harness.begin();
  harness.controller.forceClose(() => {
    harness.renderCount += 1;
  });

  assert.deepEqual(state.editorCloseWait, createEditorCloseWaitState());
  assert.deepEqual(harness.closeCalls, [{ force: true }]);
  assert.deepEqual(harness.cancelledHandles, ["poll-handle"]);
  assert.equal(harness.controller.isOpen(), false);
});

test("a session can reopen after the previous one was cancelled", () => {
  const harness = createWaitHarness({ pendingCount: 2 });

  harness.begin();
  harness.controller.keepOpen(() => {});
  harness.pendingCount = 6;
  harness.begin();

  assert.deepEqual(state.editorCloseWait, { isOpen: true, pendingCount: 6, initialCount: 6 });
  assert.equal(harness.controller.isOpen(), true);
});
