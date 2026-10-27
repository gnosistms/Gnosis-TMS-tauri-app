const STORE_FILENAME = "app-state.json";
const BROWSER_STORAGE_KEY_PREFIX = "gnosis-tms-";

let store = null;
let initialized = false;
let initializationPromise = null;
let memoryState = {};
// Incremented for every in-memory mutation. A reload only publishes its replacement
// handle after it has persisted a snapshot from the latest revision, preventing writes
// made during recovery from racing behind an older flush.
let memoryRevision = 0;
// True when a Tauri store loader exists (i.e. we are in the native app, not a plain
// browser). Distinguishes "store handle temporarily gone during a reload" from "no
// native store at all" so writes route correctly (memory-only vs. localStorage).
let storeLoaderAvailable = false;
// Concurrency guard: at most one in-flight store-handle reload at a time.
let storeReloadPromise = null;
// Injected non-fatal reporter (wired in main.js). Kept as injection so this leaf module
// stays telemetry-free and no persistent-store -> telemetry -> telemetry-consent ->
// persistent-store import cycle forms.
let reportStoreFailure = null;

/**
 * Wire a reporter used to surface recoverable store failures (a stale resource id and
 * its recovery) as scrubbed, non-fatal telemetry. Called once at bootstrap. Passing a
 * non-function clears it.
 */
export function setPersistentStoreFailureReporter(reporter) {
  reportStoreFailure = typeof reporter === "function" ? reporter : null;
}

function cloneValue(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function localStorageKeys() {
  try {
    if (!window.localStorage) {
      return [];
    }

    const keys = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (typeof key === "string") {
        keys.push(key);
      }
    }
    return keys;
  } catch {
    return [];
  }
}

function readBrowserStorageEntries() {
  const entries = {};

  for (const key of localStorageKeys()) {
    if (!key.startsWith(BROWSER_STORAGE_KEY_PREFIX)) {
      continue;
    }

    try {
      const rawValue = window.localStorage?.getItem(key);
      if (rawValue === null) {
        continue;
      }

      entries[key.slice(BROWSER_STORAGE_KEY_PREFIX.length)] = JSON.parse(rawValue);
    } catch {
      try {
        entries[key.slice(BROWSER_STORAGE_KEY_PREFIX.length)] =
          window.localStorage?.getItem(key);
      } catch {}
    }
  }

  return entries;
}

async function loadStoreSnapshot(nextStore) {
  const entries = (await nextStore.entries()) ?? [];
  return Object.fromEntries(entries);
}

function getGlobalStoreLoader() {
  return window.__TAURI__?.store?.load?.bind(window.__TAURI__.store) ?? null;
}

export async function initializePersistentStorage() {
  if (initialized) {
    return;
  }

  if (initializationPromise) {
    await initializationPromise;
    return;
  }

  initializationPromise = (async () => {
    const loadStore = getGlobalStoreLoader();
    if (!loadStore) {
      storeLoaderAvailable = false;
      memoryState = readBrowserStorageEntries();
      initialized = true;
      return;
    }

    storeLoaderAvailable = true;
    const nextStore = await loadStore(STORE_FILENAME);
    const persistedState = await loadStoreSnapshot(nextStore);

    store = nextStore;
    memoryState = persistedState;
    initialized = true;
  })();

  try {
    await initializationPromise;
  } finally {
    initializationPromise = null;
  }
}

// The stale-resource-id reason is a bare string (Tauri's BadResourceId Display), not an
// Error, so match against the message *or* the value itself: "The resource id N is invalid."
function isStaleResourceError(error) {
  const message = String(error?.message ?? error ?? "");
  return /resource id\s+\d+\s+is invalid/i.test(message);
}

async function reloadStoreHandle() {
  const loadStore = getGlobalStoreLoader();
  if (!loadStore) {
    // The loader vanished between the failed write and this reload — i.e. Tauri is tearing
    // down (app restart / shutdown). Downgrade to browser mode so subsequent writes stop
    // targeting a store handle that will never return, and instead fall to the localStorage
    // branch in writePersistentValue. Those localStorage writes are ephemeral teardown
    // artifacts (the next boot re-initializes from the store file, not localStorage), which
    // is acceptable here precisely because the app is shutting down. This is the ONLY place
    // the flag flips true -> false outside initializePersistentStorage.
    storeLoaderAvailable = false;
    return;
  }

  // Re-acquire a fresh handle (new resource id), but do not publish it until the
  // authoritative in-memory state has been flushed. Otherwise a write arriving during
  // this loop could use the fresh handle and then be overwritten by an older snapshot.
  const nextStore = await loadStore(STORE_FILENAME);

  while (true) {
    const revision = memoryRevision;
    const snapshot = cloneValue(memoryState);

    // Reconcile rather than merely setting present keys: a delete that originally hit
    // the stale handle must also be replayed on the replacement handle.
    const persistedEntries = (await nextStore.entries()) ?? [];
    for (const [key] of persistedEntries) {
      if (!Object.prototype.hasOwnProperty.call(snapshot, key)) {
        await nextStore.delete(key);
      }
    }
    for (const [key, value] of Object.entries(snapshot)) {
      await nextStore.set(key, value);
    }

    if (memoryRevision === revision) {
      store = nextStore;
      return;
    }
  }
}

function ensureStoreReloaded() {
  if (storeReloadPromise) {
    return storeReloadPromise;
  }

  storeReloadPromise = (async () => {
    try {
      await reloadStoreHandle();
    } catch (error) {
      // The reload itself can reject in exactly the teardown scenario that caused the
      // stale rid (app restart / shutdown). Route it through the same non-fatal reporter
      // so it never becomes a fresh unhandled rejection — which the crash handler would
      // otherwise mis-classify as fatal, recreating the very bug we are fixing. The
      // handle stays null; a later boot re-initializes cleanly.
      reportStoreFailure?.("persistent-store.reload", error, {
        level: "warning",
        fingerprint: ["persistent-store", "stale-resource-id"],
        tags: { store_operation: "reload" },
      });
    } finally {
      storeReloadPromise = null;
    }
  })();

  return storeReloadPromise;
}

function handleStoreWriteFailure(operation, error, failedStore) {
  if (!isStaleResourceError(error)) {
    // Unexpected write failure — report non-fatally but keep the handle; it is not known
    // to be stale.
    reportStoreFailure?.(`persistent-store.${operation}`, error, {
      level: "warning",
      fingerprint: ["persistent-store", "write-failure"],
      tags: { store_operation: operation },
    });
    return;
  }

  // Only discard the handle that actually produced this failure. Another write against
  // the same stale handle may reject after recovery has already published a replacement;
  // that delayed rejection must not clear the healthy replacement or start another reload.
  if (store === failedStore) {
    // Subsequent writes go memory-only (never localStorage — see writePersistentValue)
    // until the reload reconnects a fresh handle. No immediate retry of the failed write.
    store = null;
    void ensureStoreReloaded();
  }
  reportStoreFailure?.(`persistent-store.${operation}`, error, {
    level: "warning",
    fingerprint: ["persistent-store", "stale-resource-id"],
    tags: { store_operation: operation },
  });
}

export function readPersistentValue(key, fallbackValue = null) {
  if (!Object.prototype.hasOwnProperty.call(memoryState, key)) {
    return cloneValue(fallbackValue);
  }

  return cloneValue(memoryState[key]);
}

export function writePersistentValue(key, value) {
  memoryState[key] = cloneValue(value);
  memoryRevision += 1;

  if (store) {
    const targetStore = store;
    void targetStore.set(key, memoryState[key]).catch((error) => {
      handleStoreWriteFailure("set", error, targetStore);
    });
    return;
  }

  // In a Tauri environment the handle may be temporarily null while a stale rid is being
  // reloaded. Writing to localStorage here would create a split brain: init reads the
  // store file, not localStorage, so this value would be silently lost on the next
  // restart. Keep it in memoryState only; localStorage is the fallback for browser mode.
  if (storeLoaderAvailable) {
    void ensureStoreReloaded();
    return;
  }

  try {
    window.localStorage?.setItem(
      BROWSER_STORAGE_KEY_PREFIX + key,
      JSON.stringify(memoryState[key]),
    );
  } catch {}
}

export function removePersistentValue(key) {
  delete memoryState[key];
  memoryRevision += 1;

  if (store) {
    const targetStore = store;
    void targetStore.delete(key).catch((error) => {
      handleStoreWriteFailure("delete", error, targetStore);
    });
    return;
  }

  // See writePersistentValue: memory-only while the native handle is reloading, so we
  // don't strand a delete in localStorage that init will never consult.
  if (storeLoaderAvailable) {
    void ensureStoreReloaded();
    return;
  }

  try {
    window.localStorage?.removeItem(BROWSER_STORAGE_KEY_PREFIX + key);
  } catch {}
}
