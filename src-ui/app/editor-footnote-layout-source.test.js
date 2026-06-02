import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const translateCssSource = readFileSync(new URL("../styles/translate.css", import.meta.url), "utf8");

test("static footnotes do not add extra bottom spacing at the end of row cards", () => {
  const rule =
    translateCssSource.match(/\.translation-language-panel__field-static--footnote\s*{[\s\S]*?^}/m)?.[0]
    ?? "";

  assert.match(rule, /grid-area:\s*auto;/);
  assert.match(rule, /min-height:\s*0;/);
  assert.match(rule, /padding-bottom:\s*0;/);
});

test("static inline footnote markers render as superscripts without link affordance", () => {
  const rule =
    translateCssSource.match(/\.translation-language-panel__inline-footnote\s*{[\s\S]*?^}/m)?.[0]
    ?? "";

  assert.match(rule, /vertical-align:\s*super;/);
  assert.match(rule, /text-decoration:\s*none;/);
  assert.match(rule, /cursor:\s*text;/);
});
