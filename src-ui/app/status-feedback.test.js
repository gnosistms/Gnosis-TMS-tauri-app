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

test("status badge updates request status-surface renders", () => {
  const scopes = [];
  const render = (options) => {
    scopes.push(options?.scope ?? "full");
  };

  showScopedSyncBadge("projects", "Syncing project repo...", render);
  clearScopedSyncBadge("projects", render);
  showNoticeBadge("Saved.", render, null);

  assert.deepEqual(scopes, [
    "status-surface",
    "status-surface",
    "status-surface",
  ]);
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

test("scoped sync badges can be cleared without a render callback", () => {
  showScopedSyncBadge("projects", "Refreshing project list...", () => {});

  clearScopedSyncBadge("projects");

  assert.deepEqual(getStatusSurfaceItems("projects"), []);
});
