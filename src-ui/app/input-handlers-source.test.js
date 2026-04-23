import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./input-handlers.js", import.meta.url), "utf8");

test("editor source and target language handlers open the language manager instead of changing selection", () => {
  assert.match(
    source,
    /function handleEditorSourceLanguageInput[\s\S]*input\.value === MANAGE_CHAPTER_LANGUAGES_OPTION_VALUE[\s\S]*openTargetLanguageManager\(\)[\s\S]*return true;[\s\S]*updateEditorSourceLanguage\(render, input\.value\);/,
  );
  assert.match(
    source,
    /function handleEditorTargetLanguageInput[\s\S]*input\.value === MANAGE_CHAPTER_LANGUAGES_OPTION_VALUE[\s\S]*openTargetLanguageManager\(\)[\s\S]*return true;[\s\S]*updateEditorTargetLanguage\(render, input\.value\);/,
  );
});
