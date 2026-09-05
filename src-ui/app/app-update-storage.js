import { readPersistentValue, writePersistentValue, removePersistentValue } from "./persistent-store.js";

const KEY = "app-update-availability";

export function loadKnownAppUpdate() {
  const update = readPersistentValue(KEY);
  return update && typeof update.version === "string" && update.version.trim()
    ? { ...update, available: true, status: "available", promptVisible: update.required === true }
    : null;
}

export function storeKnownAppUpdate(update) {
  if (!update.available) {
    removePersistentValue(KEY);
    return;
  }
  writePersistentValue(KEY, {
    version: update.version,
    currentVersion: update.currentVersion,
    required: update.required === true,
    message: update.message,
    dismissedVersion: update.dismissedVersion,
  });
}

export function confirmsKnownUpdateInstalled(update, known) {
  if (update.available || update.message) return false;
  if (!known.available) return true;
  const parse = (value) => /^\d+\.\d+\.\d+$/.test(value ?? "")
    ? value.split(".").map(Number) : null;
  const current = parse(update.currentVersion);
  const target = parse(known.version);
  if (!current || !target) return false;
  for (let i = 0; i < 3; i += 1) {
    if (current[i] !== target[i]) return current[i] > target[i];
  }
  return true;
}
