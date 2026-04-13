import { getActiveStorageLogin } from "./team-storage.js";
import { readPersistentValue, removePersistentValue, writePersistentValue } from "./persistent-store.js";

const EDITOR_COMMENT_SEEN_REVISIONS_STORAGE_KEY = "gnosis-tms-editor-comment-seen-revisions";

function normalizeStorageLogin(login) {
  return typeof login === "string" && login.trim() ? login.trim().toLowerCase() : null;
}

function resolveStorageLogin(login = getActiveStorageLogin()) {
  return normalizeStorageLogin(login);
}

function scopedEditorCommentSeenRevisionsKey(login = getActiveStorageLogin()) {
  const normalizedLogin = resolveStorageLogin(login);
  return normalizedLogin ? `${EDITOR_COMMENT_SEEN_REVISIONS_STORAGE_KEY}:${normalizedLogin}` : null;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
