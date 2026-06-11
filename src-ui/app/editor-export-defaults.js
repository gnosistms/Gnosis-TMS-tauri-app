import { getActiveStorageLogin } from "./team-storage.js";
import {
  readPersistentValue,
  removePersistentValue,
  writePersistentValue,
} from "./persistent-store.js";

// Local-only memory of the last successful export per chapter (option id,
// plus the exact WordPress post for link:wordpress). Not synced to the team.
const EDITOR_EXPORT_DEFAULTS_STORAGE_KEY = "gnosis-tms-editor-export-defaults";

function normalizeStorageLogin(login) {
  return typeof login === "string" && login.trim() ? login.trim().toLowerCase() : null;
}

function scopedEditorExportDefaultsKey(login = getActiveStorageLogin()) {
  const normalizedLogin = normalizeStorageLogin(login);
  return normalizedLogin ? `${EDITOR_EXPORT_DEFAULTS_STORAGE_KEY}:${normalizedLogin}` : null;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeStoredEditorExportDefault(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const optionId = typeof value.optionId === "string" ? value.optionId.trim() : "";
  if (!optionId) {
    return null;
  }

  const normalized = { optionId };
  if (isPlainObject(value.wordpress)) {
    const postId = Number.parseInt(String(value.wordpress.postId ?? ""), 10);
    if (Number.isFinite(postId) && postId > 0) {
      normalized.wordpress = {
        postId,
        postTitle: typeof value.wordpress.postTitle === "string"
          ? value.wordpress.postTitle.trim()
          : "",
      };
    }
  }
  return normalized;
}

function loadStoredEditorExportDefaultsMap(login = getActiveStorageLogin()) {
  const key = scopedEditorExportDefaultsKey(login);
  if (!key) {
    return {};
  }

  const rawValue = readPersistentValue(key, null);
  if (!isPlainObject(rawValue)) {
    return {};
  }
  return rawValue;
}

export function loadStoredEditorExportDefault(chapterId, login = getActiveStorageLogin()) {
  if (typeof chapterId !== "string" || !chapterId.trim()) {
    return null;
  }

  const defaults = loadStoredEditorExportDefaultsMap(login);
  return normalizeStoredEditorExportDefault(defaults[chapterId]);
}

export function saveStoredEditorExportDefault(
  chapterId,
  value,
  login = getActiveStorageLogin(),
) {
  if (typeof chapterId !== "string" || !chapterId.trim()) {
    return;
  }

  const key = scopedEditorExportDefaultsKey(login);
  if (!key) {
    return;
  }

  const normalized = normalizeStoredEditorExportDefault(value);
  const defaults = loadStoredEditorExportDefaultsMap(login);
  if (!normalized) {
    if (!Object.prototype.hasOwnProperty.call(defaults, chapterId)) {
      return;
    }
    delete defaults[chapterId];
    if (Object.keys(defaults).length > 0) {
      writePersistentValue(key, defaults);
    } else {
      removePersistentValue(key);
    }
    return;
  }

  defaults[chapterId] = normalized;
  writePersistentValue(key, defaults);
}
