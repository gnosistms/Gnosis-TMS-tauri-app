import test from "node:test";
import assert from "node:assert/strict";

import { createWriteIntentCoordinator } from "./write-intent-coordinator.js";

async function drainScope(coordinator, scope) {
  for (let i = 0; i < 100 && coordinator.scopeIsActive(scope); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test("onSuccess re-requesting the same key is not dropped by clearOnSuccess", async () => {
  const coordinator = createWriteIntentCoordinator({ label: "Test", defaultScope: "s" });
  const runValues = [];
  let reRequested = false;

  const makeOperations = () => ({
    clearOnSuccess: true,
    run: async (intent) => {
      runValues.push(intent.value);
    },
    onSuccess: () => {
      // Simulate a handler that fires a follow-up save for the same key
      // synchronously inside onSuccess (e.g. a debounced field flushing a
      // newer value). Its fresh intent must survive the clearOnSuccess delete.
      if (!reRequested) {
        reRequested = true;
        coordinator.request({ key: "k", scope: "s", value: "second" }, makeOperations());
      }
    },
  });

  coordinator.request({ key: "k", scope: "s", value: "first" }, makeOperations());
  await drainScope(coordinator, "s");

  assert.deepEqual(runValues, ["first", "second"], "the follow-up save must run");
  assert.equal(coordinator.getIntent("k"), null, "the key is cleared once settled");
});

test("clearOnSuccess still clears the key when onSuccess does not re-request", async () => {
  const coordinator = createWriteIntentCoordinator({ label: "Test", defaultScope: "s" });
  const runValues = [];

  coordinator.request(
    { key: "k", scope: "s", value: "only" },
    {
      clearOnSuccess: true,
      run: async (intent) => {
        runValues.push(intent.value);
      },
    },
  );
  await drainScope(coordinator, "s");

  assert.deepEqual(runValues, ["only"]);
  assert.equal(coordinator.getIntent("k"), null);
  assert.equal(coordinator.isActive("k"), false);
});
