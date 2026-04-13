import { getActiveStorageLogin } from "./team-storage.js";
import { readPersistentValue, removePersistentValue, writePersistentValue } from "./persistent-store.js";

const EDITOR_FONT_SIZE_STORAGE_KEY = "gnosis-tms-editor-font-size";
const EDITOR_LOCATION_STORAGE_KEY = "gnosis-tms-editor-location";
const EDITOR_COMMENT_SEEN_REVISIONS_STORAGE_KEY = "gnosis-tms-editor-comment-seen-revisions";

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

function scopedEditorCommentSeenRevisionsKey(login = getActiveStorageLogin()) {
  const normalizedLogin = resolveStorageLogin(login);
  return normalizedLogin ? `${EDITOR_COMMENT_SEEN_REVISIONS_STORAGE_KEY}:${normalizedLogin}` : null;
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

function normalizeStoredCommentSeenRevisionMap(value) {
  if (!isPlainObject(value)) {
    return {};
  }

  const normalizedMap = {};
  for (const [rowId, revision] of Object.entries(value)) {
    if (typeof rowId !== "string" || !rowId.trim()) {
      continue;
    }
    const normalizedRevision = Number.parseInt(String(revision ?? ""), 10);
    if (!Number.isInteger(normalizedRevision) || normalizedRevision < 0) {
      continue;
    }
    normalizedMap[rowId] = normalizedRevision;
  }
  return normalizedMap;
}

function loadStoredEditorCommentSeenRevisionMap(login = getActiveStorageLogin()) {
  const key = scopedEditorCommentSeenRevisionsKey(login);
  if (!key) {
    return {};
  }

  const rawValue = readPersistentValue(key, null);
  if (!isPlainObject(rawValue)) {
    if (rawValue !== null && rawValue !== undefined) {
      removePersistentValue(key);
    }
    return {};
  }

  const normalizedMap = {};
  let removedInvalidEntry = false;

  for (const [chapterId, value] of Object.entries(rawValue)) {
    if (typeof chapterId !== "string" || !chapterId.trim()) {
      removedInvalidEntry = true;
      continue;
    }

    const normalizedEntry = normalizeStoredCommentSeenRevisionMap(value);
    if (Object.keys(normalizedEntry).length === 0) {
      removedInvalidEntry = true;
      continue;
    }

    normalizedMap[chapterId] = normalizedEntry;
    if (Object.keys(normalizedEntry).length !== Object.keys(value ?? {}).length) {
      removedInvalidEntry = true;
    }
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

function saveStoredEditorCommentSeenRevisionMap(chapterMap, login = getActiveStorageLogin()) {
  const key = scopedEditorCommentSeenRevisionsKey(login);
  if (!key) {
    return;
  }

  const normalizedChapterMap = {};
  for (const [chapterId, value] of Object.entries(chapterMap ?? {})) {
    if (typeof chapterId !== "string" || !chapterId.trim()) {
      continue;
    }
    const normalizedEntry = normalizeStoredCommentSeenRevisionMap(value);
    if (Object.keys(normalizedEntry).length > 0) {
      normalizedChapterMap[chapterId] = normalizedEntry;
    }
  }

  if (Object.keys(normalizedChapterMap).length > 0) {
    writePersistentValue(key, normalizedChapterMap);
  } else {
    removePersistentValue(key);
  }
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

export function loadStoredEditorCommentSeenRevisions(chapterId, login = getActiveStorageLogin()) {
  if (typeof chapterId !== "string" || !chapterId.trim()) {
    return {};
  }

  const chapterMap = loadStoredEditorCommentSeenRevisionMap(login);
  return normalizeStoredCommentSeenRevisionMap(chapterMap[chapterId]);
}

export function saveStoredEditorCommentSeenRevision(chapterId, rowId, revision, login = getActiveStorageLogin()) {
  if (
    typeof chapterId !== "string"
    || !chapterId.trim()
    || typeof rowId !== "string"
    || !rowId.trim()
  ) {
    return {};
  }

  const normalizedRevision = Number.parseInt(String(revision ?? ""), 10);
  if (!Number.isInteger(normalizedRevision) || normalizedRevision < 0) {
    return loadStoredEditorCommentSeenRevisions(chapterId, login);
  }

  const chapterMap = loadStoredEditorCommentSeenRevisionMap(login);
  const chapterRevisions = normalizeStoredCommentSeenRevisionMap(chapterMap[chapterId]);
  chapterRevisions[rowId] = normalizedRevision;
  chapterMap[chapterId] = chapterRevisions;
  saveStoredEditorCommentSeenRevisionMap(chapterMap, login);
  return { ...chapterRevisions };
}

export function pruneStoredEditorCommentSeenRevisions(chapterId, validRowIds, login = getActiveStorageLogin()) {
  if (typeof chapterId !== "string" || !chapterId.trim()) {
    return {};
  }

  const validRowIdSet = new Set(
    (Array.isArray(validRowIds) ? validRowIds : [])
      .map((rowId) => (typeof rowId === "string" ? rowId.trim() : ""))
      .filter(Boolean),
  );
  const chapterMap = loadStoredEditorCommentSeenRevisionMap(login);
  const chapterRevisions = normalizeStoredCommentSeenRevisionMap(chapterMap[chapterId]);
  const prunedRevisions = Object.fromEntries(
    Object.entries(chapterRevisions).filter(([rowId]) => validRowIdSet.has(rowId)),
  );

  if (Object.keys(prunedRevisions).length > 0) {
    chapterMap[chapterId] = prunedRevisions;
  } else {
    delete chapterMap[chapterId];
  }
  saveStoredEditorCommentSeenRevisionMap(chapterMap, login);
  return { ...prunedRevisions };
}
