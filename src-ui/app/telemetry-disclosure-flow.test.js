import test from "node:test";
import assert from "node:assert/strict";

import {
  allowTelemetryReports,
  denyTelemetryReports,
  openTelemetryDisclosureIfNeeded,
  shouldShowTelemetryDisclosure,
} from "./telemetry-disclosure-flow.js";
import {
  isDisclosureShown,
  isTelemetryEnabled,
} from "./telemetry-consent.js";
import { state } from "./state.js";

function createMemoryStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    read(key, fallback = null) {
      return map.has(key) ? map.get(key) : fallback;
    },
    write(key, value) {
      map.set(key, value);
    },
  };
}

function resetModal() {
  state.telemetryDisclosureModal = { isOpen: false };
}

test("telemetry disclosure opens only until disclosure has been persisted", () => {
  resetModal();
  const store = createMemoryStore();
  let renderCount = 0;

  assert.equal(shouldShowTelemetryDisclosure(store), true);
  assert.equal(openTelemetryDisclosureIfNeeded(() => { renderCount += 1; }, store), true);
  assert.equal(state.telemetryDisclosureModal.isOpen, true);
  assert.equal(renderCount, 1);

  store.write("telemetry-disclosure-shown", true);
  resetModal();
  assert.equal(shouldShowTelemetryDisclosure(store), false);
  assert.equal(openTelemetryDisclosureIfNeeded(() => { renderCount += 1; }, store), false);
  assert.equal(state.telemetryDisclosureModal.isOpen, false);
  assert.equal(renderCount, 1);
});

test("allowing telemetry persists opt-in disclosure state and initializes telemetry", async () => {
  resetModal();
  state.telemetryDisclosureModal = { isOpen: true };
  const store = createMemoryStore();
  let renderCount = 0;
  let initCount = 0;
  let refreshCount = 0;

  await allowTelemetryReports(() => { renderCount += 1; }, {
    store,
    initTelemetry: async () => { initCount += 1; },
    refreshTelemetryState: () => { refreshCount += 1; },
  });

  assert.equal(isDisclosureShown(store), true);
  assert.equal(isTelemetryEnabled(store), true);
  assert.equal(state.telemetryDisclosureModal.isOpen, false);
  assert.equal(initCount, 1);
  assert.equal(refreshCount, 1);
  assert.equal(renderCount, 1);
});

test("denying telemetry persists opt-out disclosure state without initializing telemetry", () => {
  resetModal();
  state.telemetryDisclosureModal = { isOpen: true };
  const store = createMemoryStore();
  let renderCount = 0;
  let refreshCount = 0;

  denyTelemetryReports(() => { renderCount += 1; }, {
    store,
    refreshTelemetryState: () => { refreshCount += 1; },
  });

  assert.equal(isDisclosureShown(store), true);
  assert.equal(isTelemetryEnabled(store), false);
  assert.equal(state.telemetryDisclosureModal.isOpen, false);
  assert.equal(refreshCount, 1);
  assert.equal(renderCount, 1);
});
