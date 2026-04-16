import {
  readPersistentValue,
  removePersistentValue,
  writePersistentValue,
} from "./persistent-store.js";
import { getActiveStorageLogin } from "./team-storage.js";

const TEAM_AI_SHARED_STORAGE_KEY = "gnosis-tms-team-ai-shared";

function normalizeStorageLogin(login) {
  return typeof login === "string" && login.trim() ? login.trim().toLowerCase() : null;
}

function normalizeOrgLogin(orgLogin) {
  return typeof orgLogin === "string" && orgLogin.trim() ? orgLogin.trim().toLowerCase() : null;
}

function normalizeInstallationId(installationId) {
  return Number.isInteger(installationId) && installationId > 0 ? installationId : null;
}

function teamAiSharedStorageKey(
  installationId,
  orgLogin,
  login = getActiveStorageLogin(),
) {
  const normalizedLogin = normalizeStorageLogin(login);
  const normalizedInstallationId = normalizeInstallationId(installationId);
  const normalizedOrgLogin = normalizeOrgLogin(orgLogin);
  if (!normalizedLogin || normalizedInstallationId === null || !normalizedOrgLogin) {
    return null;
  }

  return `${TEAM_AI_SHARED_STORAGE_KEY}:${normalizedLogin}:${normalizedInstallationId}:${normalizedOrgLogin}`;
}

export function loadStoredTeamAiSnapshot(
  installationId,
  orgLogin,
  login = getActiveStorageLogin(),
) {
  try {
    const key = teamAiSharedStorageKey(installationId, orgLogin, login);
    return key ? readPersistentValue(key, null) : null;
  } catch {
    return null;
  }
}

export function saveStoredTeamAiSnapshot(
  installationId,
  orgLogin,
  snapshot,
  login = getActiveStorageLogin(),
) {
  try {
    const key = teamAiSharedStorageKey(installationId, orgLogin, login);
    if (!key || !snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      return;
    }

    writePersistentValue(key, snapshot);
  } catch {}
}

export function clearStoredTeamAiSnapshot(
  installationId,
  orgLogin,
  login = getActiveStorageLogin(),
) {
  try {
    const key = teamAiSharedStorageKey(installationId, orgLogin, login);
    if (!key) {
      return;
    }

    removePersistentValue(key);
  } catch {}
}
