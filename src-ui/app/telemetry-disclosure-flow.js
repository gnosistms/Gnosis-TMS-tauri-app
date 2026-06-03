import {
  isDisclosureShown,
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
  state.telemetryDisclosureModal = { isOpen: true };
  render?.();
  return true;
}

export async function allowTelemetryReports(render, options = {}) {
  const store = options.store;
  setTelemetryEnabled(true, store);
  markDisclosureShown(store);
  state.telemetryDisclosureModal = { isOpen: false };
  await (options.initTelemetry ?? initTelemetry)();
  (options.refreshTelemetryState ?? refreshTelemetryState)();
  render?.();
}

export function denyTelemetryReports(render, options = {}) {
  const store = options.store;
  setTelemetryEnabled(false, store);
  markDisclosureShown(store);
  state.telemetryDisclosureModal = { isOpen: false };
  (options.refreshTelemetryState ?? refreshTelemetryState)();
  render?.();
}
