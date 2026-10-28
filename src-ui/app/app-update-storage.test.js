import test from "node:test";
import assert from "node:assert/strict";
import { loadKnownAppUpdate, storeKnownAppUpdate } from "./app-update-storage.js";

test.afterEach(() => storeKnownAppUpdate({ available: false }));

for (const required of [false, true]) {
  test(`hydration discards an installed ${required ? "required" : "optional"} update before a network check`, () => {
    storeKnownAppUpdate({ available: true, required, version: "0.8.136", currentVersion: "0.8.135" });
    assert.equal(loadKnownAppUpdate("0.8.136"), null);
    assert.equal(loadKnownAppUpdate(), null, "the obsolete persistent record is removed");
  });
}

test("hydration preserves a newer repository requirement and refreshes the running version", () => {
  storeKnownAppUpdate({ available: true, version: "0.8.136", currentVersion: "0.8.135",
    requirement: { requiredVersion: "0.8.137", currentVersion: "0.8.135" } });
  const restored = loadKnownAppUpdate("0.8.136");
  assert.equal(restored.requirement.requiredVersion, "0.8.137");
  assert.equal(restored.currentVersion, "0.8.136");
  assert.equal(restored.available, false);
});

test("hydration keeps a genuinely newer optional update available offline", () => {
  storeKnownAppUpdate({ available: true, version: "0.8.137", currentVersion: "0.8.134" });
  const restored = loadKnownAppUpdate("0.8.136");
  assert.equal(restored.version, "0.8.137");
  assert.equal(restored.currentVersion, "0.8.136");
  assert.equal(restored.available, true);
});
