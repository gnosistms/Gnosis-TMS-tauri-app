import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const translateCssSource = readFileSync(new URL("../styles/translate.css", import.meta.url), "utf8");

test("image context menu stacks above the full-size preview overlay", () => {
  const overlayZIndex = Number.parseInt(
    /\.editor-image-preview-overlay\s*\{[\s\S]*?z-index:\s*(\d+)/.exec(translateCssSource)?.[1] ?? "",
    10,
  );
  const menuZIndex = Number.parseInt(
    /\.editor-image-context-menu\s*\{[\s\S]*?z-index:\s*(\d+)/.exec(translateCssSource)?.[1] ?? "",
    10,
  );

  assert.equal(Number.isFinite(overlayZIndex), true);
  assert.equal(Number.isFinite(menuZIndex), true);
  assert.ok(menuZIndex > overlayZIndex);
});
