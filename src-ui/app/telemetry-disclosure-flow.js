import {
  isDisclosureShown,
  isTelemetryEnabled,
  markDisclosureShown,
  resolveInstallId,
  setTelemetryEnabled,
} from "./telemetry-consent.js";
import { initTelemetry, refreshTelemetryState } from "./telemetry.js";
import { state } from "./state.js";
import { cachePersistentValue } from "./persistent-store.js";

export function shouldShowTelemetryDisclosure(store) {
  return !isDisclosureShown(store);
}

export function openTelemetryDisclosureIfNeeded(render, store) {
  if (!shouldShowTelemetryDisclosure(store)) {
    return false;
  }
  openTelemetryDisclosureModal(render, store);
  return true;
}

export function openTelemetryDisclosureModal(render, store) {
  state.telemetryDisclosureModal = {
    isOpen: true,
    enabled: isTelemetryEnabled(store),
  };
  render?.();
}

export function updateTelemetryDisclosureEnabled(enabled) {
  state.telemetryDisclosureModal = {
    ...state.telemetryDisclosureModal,
    enabled: enabled === true,
  };
}

export async function saveTelemetryDisclosureSettings(render, options = {}) {
  let store = options.store;
  const enabled = state.telemetryDisclosureModal?.enabled !== false;
  const invoke = globalThis.window?.__TAURI__?.core?.invoke;
  if (!store && invoke) {
    if (state.telemetryDisclosureModal.saving) return;
    if (!enabled) setTelemetryEnabled(false, { write: cachePersistentValue });
    state.telemetryDisclosureModal = { isOpen: true, enabled, saving: true };
    render?.();
    try {
      const installId = enabled ? resolveInstallId() : null;
      await invoke("save_error_reporting_settings", { enabled, installId });
    } catch {
      state.telemetryDisclosureModal = { isOpen: true, enabled, saveFailed: true };
      render?.();
      return;
    }
    store = { write: cachePersistentValue };
  }
  setTelemetryEnabled(enabled, store);
  markDisclosureShown(store);
  state.telemetryDisclosureModal = { isOpen: false, enabled };
  if (enabled) {
    await (options.initTelemetry ?? initTelemetry)();
  }
  (options.refreshTelemetryState ?? refreshTelemetryState)();
  render?.();
}

export function openTelemetryDisclosureSettings(render, store) {
  openTelemetryDisclosureModal(render, store);
  return true;
}
