const STORE_FILENAME = "app-state.json";
const BROWSER_STORAGE_KEY_PREFIX = "gnosis-tms-";

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

      entries[key] = JSON.parse(rawValue);
    } catch {
      try {
        entries[key] = window.localStorage?.getItem(key);
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
      memoryState = readBrowserStorageEntries();
      initialized = true;
      return;
    }

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
