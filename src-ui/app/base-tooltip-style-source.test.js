import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const baseCssSource = readFileSync(new URL("../styles/base.css", import.meta.url), "utf8");

test("shared tooltips wrap long unbroken text and clamp at four lines", () => {
  const tooltipRule = baseCssSource.match(/\[data-tooltip\]::before\s*{[\s\S]*?^}/m)?.[0] ?? "";

  assert.match(tooltipRule, /overflow-wrap:\s*anywhere;/);
  assert.match(tooltipRule, /word-break:\s*break-word;/);
  assert.match(tooltipRule, /-webkit-line-clamp:\s*4;/);
  assert.match(tooltipRule, /text-overflow:\s*ellipsis;/);
});
