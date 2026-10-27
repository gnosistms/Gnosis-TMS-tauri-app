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

test("a delayed failure from the stale handle does not discard its replacement", async () => {
  const writeRejections = [];
  const staleStore = createFakeTauriStore({
    set() {
      return new Promise((_resolve, reject) => {
        writeRejections.push(reject);
      });
    },
  });
  const freshStore = createFakeTauriStore();
  let loadCount = 0;
  const loader = async () => {
    loadCount += 1;
    return loadCount === 1 ? staleStore : freshStore;
  };

  const module = await bootTauriStore(loader);
  module.writePersistentValue("first", "value-1");
  module.writePersistentValue("second", "value-2");

  // Let the newer write fail first and complete recovery while the older write remains
  // pending against the stale handle.
  writeRejections[1]("The resource id 61 is invalid.");
  await tick();
  await tick();

  assert.equal(loadCount, 2);
  assert.equal(freshStore.data.get("first"), "value-1");
  assert.equal(freshStore.data.get("second"), "value-2");

  // The old rejection must be reported without clearing the replacement or reloading.
  writeRejections[0]("The resource id 61 is invalid.");
  await tick();
  await tick();

  assert.equal(loadCount, 2, "a superseded handle must not trigger another reload");
  module.writePersistentValue("third", "value-3");
  await tick();
  assert.equal(freshStore.data.get("third"), "value-3");
});

test("recovers from a stale store resource id on delete and reports it non-fatally", async () => {
  const staleStore = createFakeTauriStore({
    // Mirror of the set-path test: the delete write is floated the same way, so a dropped
    // .catch on store.delete() must be caught by its own regression guard (M1).
    delete() {
      return Promise.reject("The resource id 21 is invalid.");
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

  module.removePersistentValue("k");
  // memoryState is updated synchronously regardless of the store outcome.
  assert.equal(module.readPersistentValue("k", "gone"), "gone");

  await tick();

  assert.equal(loadCount, 2, "a stale handle should trigger exactly one reload");
  assert.equal(reports.length, 1, "the stale delete should be reported once");
  assert.equal(reports[0].command, "persistent-store.delete");
  assert.equal(reports[0].options.level, "warning");
  assert.ok(
    Array.isArray(reports[0].options.fingerprint) && reports[0].options.fingerprint.length > 0,
    "the report should carry a stable fingerprint",
  );

  // The next delete reconnects to the fresh handle.
  freshStore.data.set("k2", "v2");
  module.removePersistentValue("k2");
  await tick();
  assert.equal(freshStore.data.has("k2"), false);
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
    // The scenario emits exactly two reports, in order: the stale write, then the failed
    // reload. Asserting the exact count (not >= 1) keeps this a real regression guard — a
    // >= 1 check would still pass if the reload-failure branch silently stopped reporting.
    assert.equal(
      reports.length,
      2,
      "the stale write and the failed reload should each emit exactly one report",
    );
    assert.match(reports[0].command, /persistent-store\.set$/);
    assert.match(reports[1].command, /persistent-store\.reload$/);
    assert.ok(reports.every((report) => report.options.level === "warning"));
  } finally {
    process.removeListener("unhandledRejection", onRejection);
  }
});

test("a later write retries a failed stale-handle reload and persists all memory state", async () => {
  const staleStore = createFakeTauriStore({
    set() {
      return Promise.reject("The resource id 31 is invalid.");
    },
  });
  const recoveredStore = createFakeTauriStore();
  let loadCount = 0;
  const loader = async () => {
    loadCount += 1;
    if (loadCount === 1) {
      return staleStore;
    }
    if (loadCount === 2) {
      throw new Error("replacement handle temporarily unavailable");
    }
    return recoveredStore;
  };

  const module = await bootTauriStore(loader);
  module.writePersistentValue("before-retry", "preserved");
  await tick();
  await tick();

  assert.equal(loadCount, 2, "the first recovery attempt should fail once");

  module.writePersistentValue("retry-trigger", "persisted");
  await tick();

  assert.equal(loadCount, 3, "a later write should trigger a new recovery attempt");
  assert.equal(recoveredStore.data.get("before-retry"), "preserved");
  assert.equal(recoveredStore.data.get("retry-trigger"), "persisted");
});

test("writes during recovery stay memory-only until the replacement handle catches up", async () => {
  const staleStore = createFakeTauriStore({
    set() {
      return Promise.reject("The resource id 41 is invalid.");
    },
  });
  let releaseFirstFlush;
  const firstFlushStarted = new Promise((resolve) => {
    releaseFirstFlush = resolve;
  });
  let notifyFirstFlush;
  const firstFlushObserved = new Promise((resolve) => {
    notifyFirstFlush = resolve;
  });
  let setCount = 0;
  const recoveredStore = createFakeTauriStore({
    async set(key, value) {
      setCount += 1;
      if (setCount === 1) {
        notifyFirstFlush();
        await firstFlushStarted;
      }
      recoveredStore.data.set(key, value);
    },
  });
  let loadCount = 0;
  const loader = async () => {
    loadCount += 1;
    return loadCount === 1 ? staleStore : recoveredStore;
  };

  const module = await bootTauriStore(loader);
  module.writePersistentValue("k", "old");
  await firstFlushObserved;

  module.writePersistentValue("k", "new");
  module.writePersistentValue("another", "value");
  releaseFirstFlush();
  await tick();
  await tick();

  assert.equal(loadCount, 2, "concurrent writes should share the in-flight reload");
  assert.equal(recoveredStore.data.get("k"), "new");
  assert.equal(recoveredStore.data.get("another"), "value");
});

test("recovery replays a delete that failed on the stale handle", async () => {
  const staleStore = createFakeTauriStore({
    data: new Map([["removed", "old"]]),
    delete() {
      return Promise.reject("The resource id 51 is invalid.");
    },
  });
  const recoveredStore = createFakeTauriStore();
  recoveredStore.data.set("removed", "old");
  let loadCount = 0;
  const loader = async () => {
    loadCount += 1;
    return loadCount === 1 ? staleStore : recoveredStore;
  };

  const module = await bootTauriStore(loader);
  module.removePersistentValue("removed");
  await tick();

  assert.equal(recoveredStore.data.has("removed"), false);
});
