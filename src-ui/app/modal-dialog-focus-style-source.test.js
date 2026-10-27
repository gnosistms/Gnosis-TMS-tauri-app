import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const modalsCssSource = readFileSync(new URL("../styles/modals.css", import.meta.url), "utf8");
const baseCssSource = readFileSync(new URL("../styles/base.css", import.meta.url), "utf8");

test("focused modal dialogs do not draw the browser's default focus ring", () => {
  assert.match(
    modalsCssSource,
    /\[data-modal-dialog\]:focus\s*\{\s*outline:\s*none;\s*\}/s,
  );
});

test("buttons inside modal dialogs keep a visible keyboard focus style", () => {
  assert.match(
    baseCssSource,
    /\.button:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent-strong\);/s,
  );
});
