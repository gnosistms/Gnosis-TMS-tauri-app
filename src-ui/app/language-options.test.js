import test from "node:test";
import assert from "node:assert/strict";

import {
  findIsoLanguageOption,
  isoLanguageOptions,
  normalizeSupportedLanguageCode,
} from "../lib/language-options.js";

test("supported language options split Chinese by script without bare Chinese fallback", () => {
  assert.deepEqual(findIsoLanguageOption("zh-Hans"), {
    code: "zh-Hans",
    name: "Chinese (Simplified)",
  });
  assert.deepEqual(findIsoLanguageOption("zh-hant"), {
    code: "zh-Hant",
    name: "Chinese (Traditional)",
  });
  assert.equal(findIsoLanguageOption("zh"), null);
  assert.equal(normalizeSupportedLanguageCode("ZH_HANS"), "zh-Hans");
  assert.equal(normalizeSupportedLanguageCode("zh"), "");
  assert.equal(isoLanguageOptions.some((option) => option.code === "zh"), false);
});
