import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./glossary-term-editor-modal.js", import.meta.url),
  "utf8",
);

test("glossary term editor modal keeps variant textarea values escaped as raw markup", () => {
  assert.match(source, />\$\{escapeHtml\(value\)\}<\/textarea>/);
});

test("glossary term editor modal includes one ruby button per lane next to the add button", () => {
  assert.match(source, /data-glossary-inline-style-button/);
  assert.match(source, /data-action="toggle-glossary-term-inline-style:ruby:\$\{escapeHtml\(side\)\}"/);
  assert.match(source, /data-inline-style="ruby"/);
  assert.match(source, /data-variant-side="\$\{escapeHtml\(side\)\}"/);
  assert.match(
    source,
    /data-glossary-inline-style-button[\s\S]*?term-lane__add-button[\s\S]*?data-action="add-glossary-term-variant:\$\{escapeHtml\(side\)\}"/,
  );
});

test("glossary term editor modal annotates variant textareas with language codes", () => {
  assert.match(source, /data-language-code="\$\{escapeHtml\(languageCode\)\}"/);
});
