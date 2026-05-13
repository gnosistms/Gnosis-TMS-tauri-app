import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const baseCssSource = readFileSync(new URL("../styles/base.css", import.meta.url), "utf8");
const fontsCssSource = readFileSync(new URL("../styles/fonts-variable.css", import.meta.url), "utf8");

function cssVariable(name) {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(baseCssSource);
  return match?.[1]?.trim() ?? "";
}

test("primary app font uses full Inter WOFF2 before subsetted variable fallbacks", () => {
  assert.match(fontsCssSource, /font-family:\s*"Inter App";/);
  assert.match(fontsCssSource, /InterVariable\.woff2/);
  assert.match(fontsCssSource, /format\("woff2-variations"\)/);
  assert.doesNotMatch(fontsCssSource, /Inter-\d+\.ttf/);

  assert.match(cssVariable("font-sans"), /^"Inter App", "Inter Variable"/);
});

test("language sans stacks keep Inter App ahead of subsetted script fonts", () => {
  for (const name of ["font-ja", "font-zh-hans", "font-zh-hant", "font-fa", "font-ko"]) {
    assert.match(cssVariable(name), /^"Inter App", /, `${name} should start with Inter App`);
  }
});

test("editor serif stacks prefer bundled Noto families for consistent shaping", () => {
  assert.equal(
    cssVariable("font-serif"),
    '"Noto Serif Variable", "Noto Serif JP Variable", "Noto Serif SC Variable", "Noto Serif TC Variable", "Noto Serif KR Variable", "Noto Naskh Arabic Variable", serif',
  );
  assert.equal(cssVariable("font-serif-ja"), '"Noto Serif JP Variable", serif');
  assert.equal(cssVariable("font-serif-zh-hans"), '"Noto Serif SC Variable", serif');
  assert.equal(cssVariable("font-serif-zh-hant"), '"Noto Serif TC Variable", serif');
  assert.equal(cssVariable("font-serif-fa"), '"Noto Naskh Arabic Variable", serif');
  assert.equal(cssVariable("font-serif-ko"), '"Noto Serif KR Variable", serif');
});
