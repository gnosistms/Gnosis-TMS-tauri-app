import { getActiveStorageLogin } from "./team-storage.js";
import { readPersistentValue, removePersistentValue, writePersistentValue } from "./persistent-store.js";

const EDITOR_FONT_SIZE_STORAGE_KEY = "gnosis-tms-editor-font-size";
const EDITOR_LOCATION_STORAGE_KEY = "gnosis-tms-editor-location";
const EDITOR_PREVIEW_LANGUAGE_STORAGE_KEY = "gnosis-tms-editor-preview-language";

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

function scopedEditorPreviewLanguageKey(login = getActiveStorageLogin()) {
  const normalizedLogin = resolveStorageLogin(login);
  return normalizedLogin ? `${EDITOR_PREVIEW_LANGUAGE_STORAGE_KEY}:${normalizedLogin}` : null;
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
  const scrollTop = Number(value.scrollTop);
  const type =
    value.type === "field"
    || value.type === "row"
    || value.type === "deleted-group"
    || value.type === "language-panel"
    || value.type === "language-toggle"
      ? value.type
      : null;

  return {
    ...(type ? { type } : {}),
    rowId,
    languageCode,
    offsetTop: Number.isFinite(offsetTop) ? offsetTop : 0,
    ...(Number.isFinite(scrollTop) ? { scrollTop } : {}),
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

function normalizeStoredEditorPreviewLanguageCode(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function loadStoredEditorPreviewLanguageMap(login = getActiveStorageLogin()) {
  const key = scopedEditorPreviewLanguageKey(login);
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

    const normalizedCode = normalizeStoredEditorPreviewLanguageCode(value);
    if (!normalizedCode) {
      removedInvalidEntry = true;
      continue;
    }

    normalizedMap[chapterId] = normalizedCode;
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
    const persistedValue = readPersistentValue(key, null);
    if (persistedValue !== null && persistedValue !== undefined) {
      return Number.parseInt(String(persistedValue ?? ""), 10);
    }

    const rawValue = window.localStorage?.getItem(key);
    if (rawValue === null) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue);
    const normalizedValue = Number.parseInt(String(parsedValue ?? ""), 10);
    if (Number.isFinite(normalizedValue)) {
      writePersistentValue(key, normalizedValue);
      try {
        window.localStorage?.removeItem(key);
      } catch {}
      return normalizedValue;
    }
    return null;
  } catch {
    try {
      const normalizedValue = Number.parseInt(String(window.localStorage?.getItem(key) ?? ""), 10);
      if (Number.isFinite(normalizedValue)) {
        writePersistentValue(key, normalizedValue);
        try {
          window.localStorage?.removeItem(key);
        } catch {}
        return normalizedValue;
      }
      return null;
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

  writePersistentValue(key, normalizedValue);
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

export function loadStoredEditorPreviewLanguageCode(chapterId, login = getActiveStorageLogin()) {
  if (typeof chapterId !== "string" || !chapterId.trim()) {
    return null;
  }

  const languageCodes = loadStoredEditorPreviewLanguageMap(login);
  return languageCodes[chapterId] ?? null;
}

export function saveStoredEditorPreviewLanguageCode(
  chapterId,
  languageCode,
  login = getActiveStorageLogin(),
) {
  if (typeof chapterId !== "string" || !chapterId.trim()) {
    return;
  }

  const normalizedCode = normalizeStoredEditorPreviewLanguageCode(languageCode);
  if (!normalizedCode) {
    clearStoredEditorPreviewLanguageCode(chapterId, login);
    return;
  }

  const key = scopedEditorPreviewLanguageKey(login);
  if (!key) {
    return;
  }

  const languageCodes = loadStoredEditorPreviewLanguageMap(login);
  languageCodes[chapterId] = normalizedCode;
  writePersistentValue(key, languageCodes);
}

export function clearStoredEditorPreviewLanguageCode(chapterId, login = getActiveStorageLogin()) {
  if (typeof chapterId !== "string" || !chapterId.trim()) {
    return;
  }

  const key = scopedEditorPreviewLanguageKey(login);
  if (!key) {
    return;
  }

  const languageCodes = loadStoredEditorPreviewLanguageMap(login);
  if (!Object.prototype.hasOwnProperty.call(languageCodes, chapterId)) {
    return;
  }

  delete languageCodes[chapterId];
  if (Object.keys(languageCodes).length > 0) {
    writePersistentValue(key, languageCodes);
  } else {
    removePersistentValue(key);
  }
}
