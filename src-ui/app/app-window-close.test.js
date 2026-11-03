import test from "node:test";
import assert from "node:assert/strict";

import { destroyCurrentAppWindow, exitAppAfterCloseWait } from "./app-window-close.js";

test("guarded app close destroys the window without calling close", () => {
  const calls = { close: 0, destroy: 0 };
  const currentWindow = {
    close() {
      calls.close += 1;
    },
    destroy() {
      calls.destroy += 1;
    },
  };

  const requested = destroyCurrentAppWindow({
    getCurrentWindow: () => currentWindow,
  });

  assert.equal(requested, true);
  assert.deepEqual(calls, { close: 0, destroy: 1 });
});

test("close wait exit quits through the backend without destroying the window", async () => {
  const calls = { invoke: [], destroy: 0 };
  const exited = await exitAppAfterCloseWait({
    tauriCoreApi: { invoke: async (command) => { calls.invoke.push(command); } },
    tauriWindowApi: { getCurrentWindow: () => ({ destroy() { calls.destroy += 1; } }) },
  });

  assert.equal(exited, true);
  assert.deepEqual(calls, { invoke: ["exit_app_after_close_wait"], destroy: 0 });
});

test("close wait exit falls back to destroying the window when the command fails", async () => {
  let destroyCalls = 0;
  const exited = await exitAppAfterCloseWait({
    tauriCoreApi: { invoke: async () => { throw new Error("unknown command"); } },
    tauriWindowApi: { getCurrentWindow: () => ({ destroy() { destroyCalls += 1; } }) },
  });

  assert.equal(exited, true);
  assert.equal(destroyCalls, 1);
});

test("close wait exit reports nothing to close outside Tauri", async () => {
  assert.equal(await exitAppAfterCloseWait({ tauriCoreApi: undefined, tauriWindowApi: undefined }), false);
});
