import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = {
  setTimeout(callback) {
    callback();
    return 1;
  },
  clearTimeout() {},
};

const { resetSessionState, state } = await import("./state.js");
const {
  clearNoticeBadge,
  clearScopedSyncBadge,
  getStatusSurfaceItems,
  showNoticeBadge,
  showScopedSyncBadge,
} = await import("./status-feedback.js");

test.beforeEach(() => {
  resetSessionState();
});

test("status surface returns notice items", () => {
  showNoticeBadge("Saved.", () => {}, null);

  assert.deepEqual(getStatusSurfaceItems(), [{
    id: "notice",
    kind: "notice",
    text: "Saved.",
    scope: null,
  }]);
});

test("status surface returns scoped sync items", () => {
  showScopedSyncBadge("projects", "Syncing project repo...", () => {});

  assert.deepEqual(getStatusSurfaceItems("projects"), [{
    id: "projects-sync",
    kind: "sync",
    text: "Syncing project repo...",
    scope: "projects",
  }]);
});

test("status surface shows scoped sync and notice together", () => {
  showScopedSyncBadge("projects", "Syncing project repo...", () => {});
  showNoticeBadge("File renamed.", () => {}, null);

  assert.deepEqual(getStatusSurfaceItems("projects").map((item) => item.text), [
    "Syncing project repo...",
    "File renamed.",
  ]);
});

test("clearing one status channel does not clear the other", () => {
  showScopedSyncBadge("projects", "Syncing project repo...", () => {});
  showNoticeBadge("File renamed.", () => {}, null);

  clearNoticeBadge();
  assert.deepEqual(getStatusSurfaceItems("projects").map((item) => item.text), [
    "Syncing project repo...",
  ]);

  showNoticeBadge("File renamed.", () => {}, null);
  clearScopedSyncBadge("projects", () => {});
  assert.deepEqual(getStatusSurfaceItems("projects").map((item) => item.text), [
    "File renamed.",
  ]);
  assert.equal(state.statusBadges.left.visible, true);
});
