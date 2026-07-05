import test from "node:test";
import assert from "node:assert/strict";

const previousWindow = globalThis.window;

function createFakeLocalStorage() {
  const map = new Map();
  return {
    map,
    get length() {
      return map.size;
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

// Simulates a fresh app boot: a new module instance (module-level `initialized`
// / `memoryState` reset) backed by the same localStorage as the prior session.
async function bootPersistentStore(localStorage) {
  globalThis.window = { localStorage };
  const module = await import(`./persistent-store.js?boot=${bootPersistentStore.counter++}`);
  await module.initializePersistentStorage();
  return module;
}
bootPersistentStore.counter = 0;

test.after(() => {
  if (previousWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = previousWindow;
  }
});

test("browser-mode persistent value round-trips across a simulated reload", async () => {
  const localStorage = createFakeLocalStorage();

  const firstBoot = await bootPersistentStore(localStorage);
  assert.equal(firstBoot.readPersistentValue("telemetry-disclosure-shown"), null);

  firstBoot.writePersistentValue("telemetry-disclosure-shown", true);

  // Written under the prefixed key so the next boot's loader can find it.
  assert.equal(
    localStorage.getItem("gnosis-tms-telemetry-disclosure-shown"),
    JSON.stringify(true),
  );
  assert.equal(localStorage.getItem("telemetry-disclosure-shown"), null);

  const secondBoot = await bootPersistentStore(localStorage);
  assert.equal(secondBoot.readPersistentValue("telemetry-disclosure-shown"), true);
});

test("browser-mode removePersistentValue clears the prefixed key", async () => {
  const localStorage = createFakeLocalStorage();

  const firstBoot = await bootPersistentStore(localStorage);
  firstBoot.writePersistentValue("some-key", { nested: "value" });
  assert.deepEqual(firstBoot.readPersistentValue("some-key"), { nested: "value" });

  firstBoot.removePersistentValue("some-key");
  assert.equal(localStorage.getItem("gnosis-tms-some-key"), null);

  const secondBoot = await bootPersistentStore(localStorage);
  assert.equal(secondBoot.readPersistentValue("some-key", "fallback"), "fallback");
});
