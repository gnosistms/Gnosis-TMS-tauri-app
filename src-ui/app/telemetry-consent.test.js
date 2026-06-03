import test from "node:test";
import assert from "node:assert/strict";

const {
  resolveInstallId,
  isTelemetryEnabled,
  setTelemetryEnabled,
  isDisclosureShown,
  markDisclosureShown,
  isTelemetrySendAllowed,
} = await import("./telemetry-consent.js");

function createMemoryStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    read(key, fallback = null) {
      return map.has(key) ? map.get(key) : fallback;
    },
    write(key, value) {
      map.set(key, value);
    },
    raw: map,
  };
}

test("resolveInstallId generates a stable, persisted id", () => {
  const store = createMemoryStore();
  const first = resolveInstallId(store);
  assert.equal(typeof first, "string");
  assert.ok(first.length > 0);
  // Second call returns the same persisted id.
  assert.equal(resolveInstallId(store), first);
});

test("isTelemetryEnabled defaults to true (opt-out) and honors an explicit choice", () => {
  const store = createMemoryStore();
  assert.equal(isTelemetryEnabled(store), true);

  setTelemetryEnabled(false, store);
  assert.equal(isTelemetryEnabled(store), false);

  setTelemetryEnabled(true, store);
  assert.equal(isTelemetryEnabled(store), true);
});

test("disclosure is not shown until explicitly marked", () => {
  const store = createMemoryStore();
  assert.equal(isDisclosureShown(store), false);
  markDisclosureShown(store);
  assert.equal(isDisclosureShown(store), true);
});

test("send gate stays closed until disclosure is shown, even when enabled", () => {
  const store = createMemoryStore();
  // Enabled by default, but disclosure not yet shown.
  assert.equal(isTelemetryEnabled(store), true);
  assert.equal(isTelemetrySendAllowed(store), false);

  markDisclosureShown(store);
  assert.equal(isTelemetrySendAllowed(store), true);
});

test("send gate closes when the user opts out after disclosure", () => {
  const store = createMemoryStore();
  markDisclosureShown(store);
  assert.equal(isTelemetrySendAllowed(store), true);

  setTelemetryEnabled(false, store);
  assert.equal(isTelemetrySendAllowed(store), false);
});
