import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./modals.css", import.meta.url), "utf8");

test("chapter language manager rows reserve top paint room for first-row tooltips", () => {
  assert.match(
    source,
    /\.chapter-language-manager-modal \.term-lane__rows \{\s*position: relative;\s*z-index: 1;\s*max-height: min\(52vh, 420px\);\s*overflow-y: auto;\s*margin-top: -48px;\s*padding-top: 48px;\s*padding-right: 6px;\s*\}/s,
  );
});

test("language picker keeps actions visible and uses compact option spacing", () => {
  assert.match(
    source,
    /\.modal-card--language-picker \{\s*width: min\(420px, 100%\);\s*max-height: calc\(100vh - 56px\);\s*overflow: hidden;\s*\}/s,
  );
  assert.match(
    source,
    /\.language-picker-modal \{\s*gap: 12px;\s*display: flex;\s*flex-direction: column;\s*max-height: inherit;\s*min-height: 0;\s*\}/s,
  );
  assert.match(
    source,
    /\.language-picker-modal__list \{\s*display: grid;\s*gap: 4px;\s*flex: 1 1 auto;\s*min-height: 0;\s*max-height: none;\s*overflow-y: auto;\s*padding-right: 4px;\s*\}/s,
  );
  assert.match(source, /\.language-picker-modal__option \{\s*min-height: 32\.2px;/);
});
