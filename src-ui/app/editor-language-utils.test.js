import test from "node:test";
import assert from "node:assert/strict";

import {
  appendDuplicateLanguage,
  languageBaseCode,
  numberDuplicateLanguageGroups,
} from "./editor-language-utils.js";

test("appendDuplicateLanguage creates a normal language for the first base column", () => {
  assert.deepEqual(appendDuplicateLanguage([], "zh-Hans"), [
    {
      code: "zh-Hans",
      name: "Chinese (Simplified)",
      role: "target",
    },
  ]);
});

test("appendDuplicateLanguage allocates and numbers duplicate base-language columns", () => {
  const languages = appendDuplicateLanguage([
    { code: "es", name: "Spanish", role: "source" },
    { code: "zh-Hans", name: "Chinese (Simplified)", role: "target" },
  ], "zh-Hans");

  assert.deepEqual(languages, [
    { code: "es", name: "Spanish", role: "source" },
    { code: "zh-Hans", name: "Chinese (Simplified) 1", role: "target", baseCode: "zh-Hans" },
    { code: "zh-Hans-x-2", name: "Chinese (Simplified) 2", role: "target", baseCode: "zh-Hans" },
  ]);
});

test("numberDuplicateLanguageGroups treats missing baseCode as code", () => {
  const languages = numberDuplicateLanguageGroups([
    { code: "vi", name: "Vietnamese", role: "target" },
    { code: "vi-x-2", name: "Vietnamese copy", role: "target", baseCode: "vi" },
  ]);

  assert.equal(languageBaseCode(languages[0]), "vi");
  assert.equal(languageBaseCode(languages[1]), "vi");
  assert.equal(languages[0].name, "Vietnamese 1");
  assert.equal(languages[1].name, "Vietnamese 2");
});

test("numberDuplicateLanguageGroups collapses singleton duplicate groups to the base display name", () => {
  assert.deepEqual(numberDuplicateLanguageGroups([
    { code: "en-x-2", name: "English 2", role: "target", baseCode: "en" },
  ]), [
    { code: "en-x-2", name: "English", role: "target", baseCode: "en" },
  ]);
});

test("numberDuplicateLanguageGroups keeps custom singleton labels without duplicate metadata", () => {
  assert.deepEqual(numberDuplicateLanguageGroups([
    { code: "en", name: "Project English", role: "target" },
  ]), [
    { code: "en", name: "Project English", role: "target" },
  ]);
});

test("appendDuplicateLanguage renumbers collapsed duplicate groups when a base language is added again", () => {
  const languages = appendDuplicateLanguage([
    { code: "en-x-2", name: "English", role: "target", baseCode: "en" },
  ], "en");

  assert.deepEqual(languages, [
    { code: "en-x-2", name: "English 1", role: "target", baseCode: "en" },
    { code: "en", name: "English 2", role: "target", baseCode: "en" },
  ]);
});
