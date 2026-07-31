import test from "node:test";
import assert from "node:assert/strict";

import { destroyCurrentAppWindow } from "./app-window-close.js";

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
