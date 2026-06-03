// Telemetry consent + disclosure gate. Pure decision logic over an injected key-value
// store so it can be unit-tested; defaults to the app's persistent store.
//
// Model (see plans/telemetry-plan.md):
// - Opt-out: telemetry is enabled unless the user has explicitly turned it off.
// - No routine event may be sent until the first-run disclosure has been shown.
// - First-run crashes are captured before the gate opens and transmitted once it does;
//   an explicit opt-out discards them. (That capture-timing difference lives in
//   telemetry.js; the send gate itself is the same for crashes and routine events.)

import { readPersistentValue, writePersistentValue } from "./persistent-store.js";

export const TELEMETRY_INSTALL_ID_KEY = "telemetry-install-id";
export const TELEMETRY_ENABLED_KEY = "telemetry-enabled";
export const TELEMETRY_DISCLOSURE_SHOWN_KEY = "telemetry-disclosure-shown";

function defaultStore() {
  return { read: readPersistentValue, write: writePersistentValue };
}

function generateInstallId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  return `install-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Load the anonymous per-install UUID, generating and persisting one on first use. */
export function resolveInstallId(store = defaultStore()) {
  const existing = store.read(TELEMETRY_INSTALL_ID_KEY, null);
  if (typeof existing === "string" && existing.trim()) {
    return existing;
  }
  const id = generateInstallId();
  store.write(TELEMETRY_INSTALL_ID_KEY, id);
  return id;
}

/** Opt-out: enabled unless explicitly set to false. */
export function isTelemetryEnabled(store = defaultStore()) {
  return store.read(TELEMETRY_ENABLED_KEY, true) !== false;
}

export function setTelemetryEnabled(enabled, store = defaultStore()) {
  store.write(TELEMETRY_ENABLED_KEY, enabled === true);
}

export function isDisclosureShown(store = defaultStore()) {
  return store.read(TELEMETRY_DISCLOSURE_SHOWN_KEY, false) === true;
}

export function markDisclosureShown(store = defaultStore()) {
  store.write(TELEMETRY_DISCLOSURE_SHOWN_KEY, true);
}

/**
 * The single send gate: an event may leave the process only after the disclosure has
 * been shown AND telemetry is enabled. Routine events are also only *captured* after
 * this is true; crashes are captured earlier and buffered until it becomes true.
 */
export function isTelemetrySendAllowed(store = defaultStore()) {
  return isDisclosureShown(store) && isTelemetryEnabled(store);
}
