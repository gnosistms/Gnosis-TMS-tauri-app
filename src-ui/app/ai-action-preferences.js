import { getActiveStorageLogin } from "./team-storage.js";
import { readPersistentValue, removePersistentValue, writePersistentValue } from "./persistent-store.js";
import {
  extractAiActionPreferences,
  normalizeStoredAiActionPreferences,
} from "./ai-action-config.js";

const AI_ACTION_SETTINGS_STORAGE_KEY = "gnosis-tms-ai-action-settings";

function normalizeStorageLogin(login) {
  return typeof login === "string" && login.trim() ? login.trim().toLowerCase() : null;
}

function scopedAiActionSettingsKey(login = getActiveStorageLogin()) {
  const normalizedLogin = normalizeStorageLogin(login);
  return normalizedLogin ? `${AI_ACTION_SETTINGS_STORAGE_KEY}:${normalizedLogin}` : null;
}

export function loadStoredAiActionPreferences(login = getActiveStorageLogin()) {
  const key = scopedAiActionSettingsKey(login);
  if (!key) {
    return normalizeStoredAiActionPreferences(null);
  }

  const rawValue = readPersistentValue(key, null);
  if (rawValue === null || rawValue === undefined) {
    return normalizeStoredAiActionPreferences(null);
  }

  const normalizedValue = normalizeStoredAiActionPreferences(rawValue);
  if (JSON.stringify(normalizedValue) !== JSON.stringify(rawValue)) {
    writePersistentValue(key, normalizedValue);
  }
  return normalizedValue;
}

export function saveStoredAiActionPreferences(config, login = getActiveStorageLogin()) {
  const key = scopedAiActionSettingsKey(login);
  if (!key) {
    return;
  }

  const normalizedValue = extractAiActionPreferences(config);
  writePersistentValue(key, normalizedValue);
}

export function clearStoredAiActionPreferences(login = getActiveStorageLogin()) {
  const key = scopedAiActionSettingsKey(login);
  if (!key) {
    return;
  }

  removePersistentValue(key);
}
