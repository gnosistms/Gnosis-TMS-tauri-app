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

function createFakeTauriStore(overrides = {}) {
  const data = new Map();
  return {
    data,
    async entries() {
      return [...data.entries()];
    },
    async set(key, value) {
      data.set(key, value);
    },
    async delete(key) {
      data.delete(key);
    },
    ...overrides,
  };
}

// Boots the module in a simulated Tauri environment: `window.__TAURI__.store.load`
// resolves to the store handles the given loader yields.
async function bootTauriStore(loader, localStorage = createFakeLocalStorage()) {
  globalThis.window = {
    localStorage,
    __TAURI__: { store: { load: loader } },
  };
  const module = await import(`./persistent-store.js?boot=${bootPersistentStore.counter++}`);
  await module.initializePersistentStorage();
  return module;
}

// A macrotask boundary lets the floated `.catch` + reload chain settle and gives Node's
// unhandled-rejection detector a chance to fire.
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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

test("recovers from a stale store resource id and reports it non-fatally", async () => {
  const staleStore = createFakeTauriStore({
    // The production reason is a bare string, not an Error — Tauri's BadResourceId Display.
    set() {
      return Promise.reject("The resource id 12 is invalid.");
    },
  });
  const freshStore = createFakeTauriStore();
  let loadCount = 0;
  const loader = async () => {
    loadCount += 1;
    return loadCount === 1 ? staleStore : freshStore;
  };

  const reports = [];
  const module = await bootTauriStore(loader);
  module.setPersistentStoreFailureReporter((command, error, options) => {
    reports.push({ command, error, options });
  });

  module.writePersistentValue("k", "v");
  // memoryState is updated synchronously regardless of the store outcome.
  assert.equal(module.readPersistentValue("k"), "v");

  await tick();

  assert.equal(loadCount, 2, "a stale handle should trigger exactly one reload");
  assert.equal(reports.length, 1, "the stale write should be reported once");
  assert.equal(reports[0].options.level, "warning");
  assert.ok(
    Array.isArray(reports[0].options.fingerprint) && reports[0].options.fingerprint.length > 0,
    "the report should carry a stable fingerprint",
  );

  // The next write reconnects to the fresh handle.
  module.writePersistentValue("k2", "v2");
  await tick();
  assert.equal(freshStore.data.get("k2"), "v2");
});

test("a failing store reload does not produce a new unhandled rejection", async () => {
  const staleStore = createFakeTauriStore({
    set() {
      return Promise.reject("The resource id 7 is invalid.");
    },
  });
  let loadCount = 0;
  const loader = async () => {
    loadCount += 1;
    if (loadCount === 1) {
      return staleStore;
    }
    // The reload itself fails — the same teardown that invalidated the rid.
    throw new Error("store gone during teardown");
  };

  const rejections = [];
  const onRejection = (reason) => rejections.push(reason);
  process.on("unhandledRejection", onRejection);

  try {
    const reports = [];
    const module = await bootTauriStore(loader);
    module.setPersistentStoreFailureReporter((command, error, options) => {
      reports.push({ command, error, options });
    });

    module.writePersistentValue("k", "v");
    await tick();
    await tick();

    assert.equal(
      rejections.length,
      0,
      "a failing reload must not surface as a new unhandled rejection",
    );
    // Both the stale write and the failed reload route through the reporter, non-fatally.
    assert.ok(reports.length >= 1);
    assert.ok(reports.every((report) => report.options.level === "warning"));
  } finally {
    process.removeListener("unhandledRejection", onRejection);
  }
});
