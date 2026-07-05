import test from "node:test";
import assert from "node:assert/strict";
import { installMockNavigator } from "../test/mock-navigator.mjs";

installMockNavigator({
  platform: "MacIntel",
  userAgentData: null,
});
globalThis.window = {
  addEventListener() {},
  setTimeout() {
    return 1;
  },
  clearTimeout() {},
};
globalThis.performance = {
  now() {
    return 0;
  },
};

const {
  isUserScrollBasisCurrent,
  noteUserScrollIntent,
  readSessionAnchor,
  readUserScrollGeneration,
  resetEditorScrollSessionForTests,
  updateSessionAnchor,
} = await import("./editor-scroll-session.js");

test.beforeEach(() => {
  resetEditorScrollSessionForTests();
});

test("user scroll intent advances the generation", () => {
  assert.equal(readUserScrollGeneration(), 0);
  noteUserScrollIntent("wheel");
  noteUserScrollIntent("bottom-pin");
  assert.equal(readUserScrollGeneration(), 2);
});

test("a basis captured before the latest scroll intent is stale", () => {
  noteUserScrollIntent("wheel");
  const basis = readUserScrollGeneration();
  assert.equal(isUserScrollBasisCurrent(basis), true);

  noteUserScrollIntent("wheel");
  assert.equal(isUserScrollBasisCurrent(basis), false);
});

test("snapshots without a recorded basis are never refused", () => {
  noteUserScrollIntent("wheel");
  assert.equal(isUserScrollBasisCurrent(undefined), true);
  assert.equal(isUserScrollBasisCurrent(null), true);
});

test("the session anchor is chapter-scoped", () => {
  updateSessionAnchor({ type: "row", rowId: "row-9", offsetTop: 42 }, "chapter-a");

  assert.deepEqual(readSessionAnchor("chapter-a"), {
    type: "row",
    rowId: "row-9",
    offsetTop: 42,
  });
  assert.equal(readSessionAnchor("chapter-b"), null);
});

test("anchors without a row id do not clobber the tracked session anchor", () => {
  updateSessionAnchor({ type: "row", rowId: "row-9", offsetTop: 42 }, "chapter-a");
  updateSessionAnchor(null, "chapter-a");
  updateSessionAnchor({ type: "row", rowId: "", offsetTop: 0 }, "chapter-a");

  assert.equal(readSessionAnchor("chapter-a")?.rowId, "row-9");
});
