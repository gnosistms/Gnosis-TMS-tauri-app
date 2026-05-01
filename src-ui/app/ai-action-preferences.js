import { getActiveStorageLogin } from "./team-storage.js";
import { readPersistentValue, removePersistentValue, writePersistentValue } from "./persistent-store.js";
import {
  extractAiActionPreferences,
  normalizeStoredAiActionPreferences,
} from "./ai-action-config.js";
import { state } from "./state.js";

const AI_ACTION_SETTINGS_STORAGE_KEY = "gnosis-tms-ai-action-settings";

function normalizeStorageLogin(login) {
  return typeof login === "string" && login.trim() ? login.trim().toLowerCase() : null;
}

function normalizeInstallationId(installationId) {
  return Number.isFinite(installationId) ? Number(installationId) : null;
}

function selectedTeamInstallationId() {
  return normalizeInstallationId(
    state.teams.find((team) => team.id === state.selectedTeamId)?.installationId,
  );
}

function scopedAiActionSettingsKey(login = getActiveStorageLogin(), installationId = selectedTeamInstallationId()) {
  const normalizedLogin = normalizeStorageLogin(login);
  return normalizedLogin ? `${AI_ACTION_SETTINGS_STORAGE_KEY}:${normalizedLogin}` : null;
}

function scopedTeamAiActionSettingsKey(
  login = getActiveStorageLogin(),
  installationId = selectedTeamInstallationId(),
) {
  const normalizedLogin = normalizeStorageLogin(login);
  const normalizedInstallationId = normalizeInstallationId(installationId);
  return normalizedLogin && normalizedInstallationId !== null
    ? `${AI_ACTION_SETTINGS_STORAGE_KEY}:${normalizedLogin}:team:${normalizedInstallationId}`
    : null;
}

export function loadStoredAiActionPreferences(
  login = getActiveStorageLogin(),
  installationId = selectedTeamInstallationId(),
) {
  const teamKey = scopedTeamAiActionSettingsKey(login, installationId);
  const key = teamKey ?? scopedAiActionSettingsKey(login, installationId);
  if (!key) {
    return normalizeStoredAiActionPreferences(null);
  }

  const rawValue = readPersistentValue(key, null)
    ?? (teamKey ? readPersistentValue(scopedAiActionSettingsKey(login, installationId), null) : null);
  if (rawValue === null || rawValue === undefined) {
    return normalizeStoredAiActionPreferences(null);
  }

  const normalizedValue = normalizeStoredAiActionPreferences(rawValue);
  if (JSON.stringify(normalizedValue) !== JSON.stringify(rawValue)) {
    writePersistentValue(key, normalizedValue);
  }
  return normalizedValue;
}

export function loadStoredTeamAiActionPreferences(
  login = getActiveStorageLogin(),
  installationId = selectedTeamInstallationId(),
) {
  const key = scopedTeamAiActionSettingsKey(login, installationId);
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

export function saveStoredAiActionPreferences(
  config,
  login = getActiveStorageLogin(),
  installationId = selectedTeamInstallationId(),
) {
  const key =
    scopedTeamAiActionSettingsKey(login, installationId)
    ?? scopedAiActionSettingsKey(login, installationId);
  if (!key) {
    return;
  }

  const normalizedValue = extractAiActionPreferences(config);
  writePersistentValue(key, normalizedValue);
}
