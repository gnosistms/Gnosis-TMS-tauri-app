import { getActiveStorageLogin } from "./team-storage.js";
import { readPersistentValue, removePersistentValue, writePersistentValue } from "./persistent-store.js";

const AI_SETTINGS_ABOUT_DISMISSED_STORAGE_KEY = "gnosis-tms-ai-settings-about-dismissed";

function normalizeStorageLogin(login) {
  return typeof login === "string" && login.trim() ? login.trim().toLowerCase() : null;
}

function scopedAiSettingsAboutDismissedKey(login = getActiveStorageLogin()) {
  const normalizedLogin = normalizeStorageLogin(login);
  return normalizedLogin
    ? `${AI_SETTINGS_ABOUT_DISMISSED_STORAGE_KEY}:${normalizedLogin}`
    : AI_SETTINGS_ABOUT_DISMISSED_STORAGE_KEY;
}

export function loadStoredAiSettingsAboutDismissed(login = getActiveStorageLogin()) {
  return readPersistentValue(scopedAiSettingsAboutDismissedKey(login), false) === true;
}

export function saveStoredAiSettingsAboutDismissed(
  dismissed,
  login = getActiveStorageLogin(),
) {
  const key = scopedAiSettingsAboutDismissedKey(login);
  if (dismissed === true) {
    writePersistentValue(key, true);
    return;
  }

  removePersistentValue(key);
}

export function clearStoredAiSettingsAboutDismissed(login = getActiveStorageLogin()) {
  removePersistentValue(scopedAiSettingsAboutDismissedKey(login));
}
