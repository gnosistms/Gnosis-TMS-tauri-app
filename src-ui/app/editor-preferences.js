import { getActiveStorageLogin } from "./team-storage.js";

const EDITOR_FONT_SIZE_STORAGE_KEY = "gnosis-tms-editor-font-size";

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
