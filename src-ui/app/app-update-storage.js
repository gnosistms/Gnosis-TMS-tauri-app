import { readPersistentValue, writePersistentValue, removePersistentValue } from "./persistent-store.js";

const KEY = "app-update-availability";

export function loadKnownAppUpdate() {
  const update = readPersistentValue(KEY);
  if (!update || typeof update.version !== "string" || !update.version.trim()) return null;
  const requirement = update.requirement ?? (update.required === true ? {
    requiredVersion: update.version,
    currentVersion: update.currentVersion,
    message: update.message,
  } : null);
  // A saved repository requirement is not proof that this platform can update.
  // Recheck it each session before restoring an app-wide prompt/action lock.
  return {
    ...update,
    requirement,
    required: false,
    available: !requirement,
    status: requirement ? "idle" : "available",
    promptVisible: false,
  };
}

export function storeKnownAppUpdate(update) {
  if (!update.available && !update.requirement) {
    removePersistentValue(KEY);
    return;
  }
  writePersistentValue(KEY, {
    version: update.version,
    currentVersion: update.currentVersion,
    required: update.required === true,
    requirement: update.requirement ?? null,
    message: update.message,
    dismissedVersion: update.dismissedVersion,
  });
}

export function confirmsKnownUpdateInstalled(update, known) {
  // The running version confirms installation independently of whether another
  // release is available or still waiting for this platform's artifacts.
  if (!known.available) return true;
  return isAppVersionAtLeast(update.currentVersion, known.version);
}

export function isAppVersionAtLeast(version, minimumVersion) {
  const parse = (value) => /^\d+\.\d+\.\d+$/.test(value ?? "")
    ? value.split(".").map(Number) : null;
  const current = parse(version);
  const target = parse(minimumVersion);
  if (!current || !target) return false;
  for (let i = 0; i < 3; i += 1) {
    if (current[i] !== target[i]) return current[i] > target[i];
  }
  return true;
}
