import { getActiveStorageLogin } from "./team-storage.js";
import { readPersistentValue, removePersistentValue, writePersistentValue } from "./persistent-store.js";

const EDITOR_FONT_SIZE_STORAGE_KEY = "gnosis-tms-editor-font-size";
const EDITOR_LOCATION_STORAGE_KEY = "gnosis-tms-editor-location";

function normalizeStorageLogin(login) {
  return typeof login === "string" && login.trim() ? login.trim().toLowerCase() : null;
}

function resolveStorageLogin(login = getActiveStorageLogin()) {
  return normalizeStorageLogin(login);
}

function scopedEditorPreferenceKey(login = getActiveStorageLogin()) {
  const normalizedLogin = resolveStorageLogin(login);
  return normalizedLogin ? `${EDITOR_FONT_SIZE_STORAGE_KEY}:${normalizedLogin}` : null;
}

function scopedEditorLocationKey(login = getActiveStorageLogin()) {
  const normalizedLogin = resolveStorageLogin(login);
  return normalizedLogin ? `${EDITOR_LOCATION_STORAGE_KEY}:${normalizedLogin}` : null;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeStoredEditorLocationEntry(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const rowId = typeof value.rowId === "string" ? value.rowId.trim() : "";
  if (!rowId) {
    return null;
  }

  const languageCode =
    typeof value.languageCode === "string" && value.languageCode.trim()
      ? value.languageCode.trim()
      : null;
  const offsetTop = Number(value.offsetTop);

  return {
    rowId,
    languageCode,
    offsetTop: Number.isFinite(offsetTop) && offsetTop >= 0 ? offsetTop : 0,
  };
}

function loadStoredEditorLocationMap(login = getActiveStorageLogin()) {
  const key = scopedEditorLocationKey(login);
  if (!key) {
    return {};
  }

  const rawValue = readPersistentValue(key, null);
  if (rawValue === null || rawValue === undefined) {
    return {};
  }

  if (!isPlainObject(rawValue)) {
    removePersistentValue(key);
    return {};
  }

  const normalizedMap = {};
  let removedInvalidEntry = false;

  for (const [chapterId, value] of Object.entries(rawValue)) {
    if (typeof chapterId !== "string" || !chapterId.trim()) {
      removedInvalidEntry = true;
      continue;
    }

    const normalizedEntry = normalizeStoredEditorLocationEntry(value);
    if (!normalizedEntry) {
      removedInvalidEntry = true;
      continue;
    }

    normalizedMap[chapterId] = normalizedEntry;
  }

  if (removedInvalidEntry) {
    if (Object.keys(normalizedMap).length > 0) {
      writePersistentValue(key, normalizedMap);
    } else {
      removePersistentValue(key);
    }
  }

  return normalizedMap;
}

export function loadStoredEditorFontSizePx(login = getActiveStorageLogin()) {
  const key = scopedEditorPreferenceKey(login);
  if (!key) {
    return null;
  }

  try {
    const rawValue = window.localStorage?.getItem(key);
    if (rawValue === null) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue);
    return Number.parseInt(String(parsedValue ?? ""), 10);
  } catch {
    try {
      return Number.parseInt(String(window.localStorage?.getItem(key) ?? ""), 10);
    } catch {
      return null;
    }
  }
}

export function saveStoredEditorFontSizePx(value, login = getActiveStorageLogin()) {
  const key = scopedEditorPreferenceKey(login);
  if (!key) {
    return;
  }

  const normalizedValue = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(normalizedValue)) {
    return;
  }

  try {
    window.localStorage?.setItem(key, JSON.stringify(normalizedValue));
  } catch {}
}

export function loadStoredEditorLocation(chapterId, login = getActiveStorageLogin()) {
  if (typeof chapterId !== "string" || !chapterId.trim()) {
    return null;
  }

  const locations = loadStoredEditorLocationMap(login);
  return locations[chapterId] ?? null;
}

export function saveStoredEditorLocation(chapterId, location, login = getActiveStorageLogin()) {
  if (typeof chapterId !== "string" || !chapterId.trim()) {
    return;
  }

  const normalizedEntry = normalizeStoredEditorLocationEntry(location);
  if (!normalizedEntry) {
    clearStoredEditorLocation(chapterId, login);
    return;
  }

  const key = scopedEditorLocationKey(login);
  if (!key) {
    return;
  }

  const locations = loadStoredEditorLocationMap(login);
  locations[chapterId] = normalizedEntry;
  writePersistentValue(key, locations);
}

export function clearStoredEditorLocation(chapterId, login = getActiveStorageLogin()) {
  if (typeof chapterId !== "string" || !chapterId.trim()) {
    return;
  }

  const key = scopedEditorLocationKey(login);
  if (!key) {
    return;
  }

  const locations = loadStoredEditorLocationMap(login);
  if (!Object.prototype.hasOwnProperty.call(locations, chapterId)) {
    return;
  }

  delete locations[chapterId];
  if (Object.keys(locations).length > 0) {
    writePersistentValue(key, locations);
  } else {
    removePersistentValue(key);
  }
}
