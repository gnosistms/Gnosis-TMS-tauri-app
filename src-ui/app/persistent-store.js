const STORE_FILENAME = "app-state.json";
const MIGRATION_KEY = "__gnosis_persistent_store_migrated_v1";
const LEGACY_KEY_PREFIX = "gnosis-tms-";

let store = null;
let initialized = false;
let initializationPromise = null;
let memoryState = {};

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

function readLegacyLocalStorageEntries() {
  const entries = {};

  for (const key of localStorageKeys()) {
    if (!key.startsWith(LEGACY_KEY_PREFIX)) {
      continue;
    }

    try {
      const rawValue = window.localStorage?.getItem(key);
      if (rawValue === null) {
        continue;
      }

      entries[key] = JSON.parse(rawValue);
    } catch {
      try {
        entries[key] = window.localStorage?.getItem(key);
      } catch {}
    }
  }

  return entries;
}

function clearLegacyLocalStorageEntries() {
  for (const key of localStorageKeys()) {
    if (!key.startsWith(LEGACY_KEY_PREFIX)) {
      continue;
    }

    try {
      window.localStorage?.removeItem(key);
    } catch {}
  }
}

async function loadStoreSnapshot(nextStore) {
  const entries = (await nextStore.entries()) ?? [];
  return Object.fromEntries(entries);
}

function getGlobalStoreLoader() {
  return window.__TAURI__?.store?.load?.bind(window.__TAURI__.store) ?? null;
}

async function persistMigrationSnapshot(nextStore, snapshot) {
  const keys = Object.keys(snapshot);
  for (const key of keys) {
    await nextStore.set(key, snapshot[key]);
  }
  await nextStore.save();
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
      memoryState = readLegacyLocalStorageEntries();
      initialized = true;
      return;
    }

    const nextStore = await loadStore(STORE_FILENAME);
    const persistedState = await loadStoreSnapshot(nextStore);

    if (persistedState[MIGRATION_KEY] === true) {
      store = nextStore;
      memoryState = persistedState;
      initialized = true;
      return;
    }

    const legacyEntries = readLegacyLocalStorageEntries();
    const migratedState = {
      ...legacyEntries,
      ...persistedState,
      [MIGRATION_KEY]: true,
    };

    await persistMigrationSnapshot(nextStore, migratedState);
    clearLegacyLocalStorageEntries();

    store = nextStore;
    memoryState = migratedState;
    initialized = true;
  })();

  try {
    await initializationPromise;
  } finally {
    initializationPromise = null;
  }
}

export function readPersistentValue(key, fallbackValue = null) {
  if (!Object.prototype.hasOwnProperty.call(memoryState, key)) {
    return cloneValue(fallbackValue);
  }

  return cloneValue(memoryState[key]);
}

export function writePersistentValue(key, value) {
  memoryState[key] = cloneValue(value);

  if (store) {
    void store.set(key, memoryState[key]);
    return;
  }

  try {
    window.localStorage?.setItem(key, JSON.stringify(memoryState[key]));
  } catch {}
}

export function removePersistentValue(key) {
  delete memoryState[key];

  if (store) {
    void store.delete(key);
    return;
  }

  try {
    window.localStorage?.removeItem(key);
  } catch {}
}
