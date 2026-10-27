import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = globalThis.window ?? {};
globalThis.document = globalThis.document ?? { querySelector: () => null, querySelectorAll: () => [], documentElement: {} };

test("waiting for a paint ends even when the window is never repainted", async () => {
  const previous = window.requestAnimationFrame;
  window.requestAnimationFrame = () => {}; // a hidden window: frames never come
  const { waitForNextPaint } = await import("./runtime.js");
  const started = Date.now();
  await waitForNextPaint(30);
  assert.ok(Date.now() - started < 1000);
  window.requestAnimationFrame = previous;
});
