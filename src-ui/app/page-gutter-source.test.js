import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const baseCssSource = readFileSync(new URL("../styles/base.css", import.meta.url), "utf8");
const contentCssSource = readFileSync(new URL("../styles/content.css", import.meta.url), "utf8");
const translateCssSource = readFileSync(new URL("../styles/translate.css", import.meta.url), "utf8");

test("page header and body gutters use the shared page gutter variable", () => {
  assert.match(baseCssSource, /--page-gutter:\s*16px;/);
  assert.match(baseCssSource, /--page-gutter-half:\s*calc\(var\(--page-gutter\) \/ 2\);/);
  assert.match(baseCssSource, /--page-gutter-width:\s*calc\(var\(--page-gutter\) \+ var\(--page-gutter\)\);/);
  assert.match(baseCssSource, /--page-gutter-negative:\s*calc\(0px - var\(--page-gutter\)\);/);
  assert.match(baseCssSource, /\.page-header\s*\{[\s\S]*padding:\s*18px var\(--page-gutter\) 20px;/);
  assert.match(baseCssSource, /\.page-header__detail\s*\{[\s\S]*padding:\s*var\(--page-gutter\) var\(--page-gutter\) 0;/);
  assert.match(baseCssSource, /\.page-header__nav\s*\{[\s\S]*padding-left:\s*0;/);
  assert.match(contentCssSource, /width:\s*min\(var\(--page-width\), calc\(100% - var\(--page-gutter-width\)\)\);/);
  assert.match(contentCssSource, /margin:\s*var\(--page-gutter\) auto 0;/);
});

test("editor toolbar gutter bleed follows the shared page gutter variable", () => {
  assert.match(translateCssSource, /\.translate-toolbar__body--editor\s*\{[\s\S]*width:\s*calc\(100% \+ var\(--page-gutter-width\)\);/);
  assert.match(translateCssSource, /\.translate-toolbar__body--editor\s*\{[\s\S]*margin-left:\s*var\(--page-gutter-negative\);/);
  assert.match(translateCssSource, /\.translate-toolbar__body--editor\s*\{[\s\S]*margin-right:\s*var\(--page-gutter-negative\);/);
});

test("editor content gutters follow the shared page gutter variable", () => {
  assert.match(translateCssSource, /\.translate-main\s*\{[\s\S]*padding:\s*var\(--page-gutter\) var\(--page-gutter-half\) 44px var\(--page-gutter\);/);
  assert.match(translateCssSource, /\.translate-sidebar-scroll\s*\{[\s\S]*padding:\s*var\(--page-gutter\) var\(--page-gutter\) var\(--page-gutter\) var\(--page-gutter-half\);/);
});
