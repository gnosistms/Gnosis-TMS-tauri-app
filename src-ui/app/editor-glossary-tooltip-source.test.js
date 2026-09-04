import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tooltipSource = readFileSync(new URL("./events/glossary-tooltip.js", import.meta.url), "utf8");
const translateCssSource = readFileSync(new URL("../styles/translate.css", import.meta.url), "utf8");

test("glossary marks retain the standard arrow cursor", () => {
  const rule = translateCssSource.match(/\.translation-language-panel__glossary-mark\s*\{[^}]+\}/s)?.[0] ?? "";
  assert.match(rule, /cursor:\s*default;/);
  assert.doesNotMatch(rule, /cursor:\s*help;/);
});

test("pointer movement lets every glossary occurrence replace the active popover mark", () => {
  const handler = tooltipSource.match(
    /export function handleGlossaryTooltipPointerMove\(event\)\s*\{[\s\S]+?\n\}/,
  )?.[0] ?? "";
  assert.match(handler, /activeGlossaryTooltipMark !== mark/);
  assert.match(handler, /activateGlossaryTooltipMark\(mark\)/);
});

test("a stale leave cannot hide the popover for the newly active glossary mark", () => {
  const handler = tooltipSource.match(
    /function deactivateGlossaryTooltipMark\(mark = activeGlossaryTooltipMark\)\s*\{[\s\S]+?\n\}/,
  )?.[0] ?? "";
  assert.match(handler, /mark && activeGlossaryTooltipMark !== mark/);
  assert.match(handler, /return;/);
});
