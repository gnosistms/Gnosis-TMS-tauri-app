import {
  isDisclosureShown,
  isTelemetryEnabled,
  markDisclosureShown,
  setTelemetryEnabled,
} from "./telemetry-consent.js";
import { initTelemetry, refreshTelemetryState } from "./telemetry.js";
import { state } from "./state.js";

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
  const store = options.store;
  const enabled = state.telemetryDisclosureModal?.enabled !== false;
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
