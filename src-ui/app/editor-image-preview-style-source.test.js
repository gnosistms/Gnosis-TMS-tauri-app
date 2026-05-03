import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const translateCssSource = readFileSync(new URL("../styles/translate.css", import.meta.url), "utf8");

test("image preview loading placeholder keeps unloaded frames legible", () => {
  const previewRule =
    translateCssSource.match(/\.translation-language-panel__image-preview\s*{[\s\S]*?^}/m)?.[0] ?? "";
  const loadingRule =
    translateCssSource.match(/\.translation-language-panel__image-preview\.is-loading\s*{[\s\S]*?^}/m)?.[0] ?? "";
  const placeholderRule =
    translateCssSource.match(/\.translation-language-panel__image-loading-placeholder\s*{[\s\S]*?^}/m)?.[0] ?? "";
  const visiblePlaceholderRule =
    translateCssSource.match(
      /\.translation-language-panel__image-preview\.is-loading \.translation-language-panel__image-loading-placeholder\s*{[\s\S]*?^}/m,
    )?.[0] ?? "";

  assert.match(previewRule, /flex:\s*0 0 auto;/);
  assert.match(loadingRule, /width:\s*var\(--editor-image-preview-width,\s*178px\);/);
  assert.match(loadingRule, /height:\s*var\(--editor-image-preview-height,\s*118px\);/);
  assert.match(placeholderRule, /position:\s*absolute;/);
  assert.match(placeholderRule, /text-align:\s*center;/);
  assert.match(visiblePlaceholderRule, /display:\s*flex;/);
});
