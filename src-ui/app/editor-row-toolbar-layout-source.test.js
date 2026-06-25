import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const translateCssSource = readFileSync(new URL("../styles/translate.css", import.meta.url), "utf8");

test("translation row text style actions use the full editor field width", () => {
  const rule = translateCssSource.match(/\.translation-row-text-style-actions\s*{[\s\S]*?^}/m)?.[0] ?? "";

  assert.match(rule, /padding:\s*8px 0 10px;/);
});
