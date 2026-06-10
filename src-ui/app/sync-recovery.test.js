import test from "node:test";
import assert from "node:assert/strict";

let invokeHandler = async () => null;

globalThis.document = globalThis.document ?? {
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.window = globalThis.window ?? {
  __TAURI__: {
    core: {
      invoke: (command, payload) => invokeHandler(command, payload),
    },
  },
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
  setTimeout,
  clearTimeout,
};

const { resetSessionState, state } = await import("./state.js");
const { handleSyncFailure } = await import("./sync-recovery.js");
const { classifySyncError } = await import("./sync-error.js");

test.afterEach(() => {
  resetSessionState();
  invokeHandler = async () => null;
});

test("a rejected session refresh routes the user to the sign-in screen", async () => {
  resetSessionState();
  state.screen = "projects";
  state.auth = {
    status: "success",
    message: "",
    session: { sessionToken: "token", login: "owner" },
  };

  const handled = await handleSyncFailure(
    classifySyncError(new Error("AUTH_REQUIRED:Your GitHub session expired. Please log in with GitHub again to continue.")),
    { render: () => {} },
  );

  assert.equal(handled, true);
  assert.equal(state.screen, "start");
  assert.equal(state.auth.status, "expired");
  assert.equal(state.auth.session, null);
  assert.match(state.auth.message, /sign in with GitHub again/i);
});

test("non-auth classifications do not touch the screen", async () => {
  resetSessionState();
  state.screen = "projects";

  const handled = await handleSyncFailure(
    classifySyncError(new Error("some ordinary failure")),
    { render: () => {} },
  );

  assert.equal(handled, false);
  assert.equal(state.screen, "projects");
});
