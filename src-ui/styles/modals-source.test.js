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
