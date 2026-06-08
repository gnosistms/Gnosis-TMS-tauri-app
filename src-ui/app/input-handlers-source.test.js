import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const inputHandlersSource = readFileSync(path.join(currentDir, "input-handlers.js"), "utf8");

function sourceBetween(start, end) {
  const startIndex = inputHandlersSource.indexOf(start);
  const endIndex = inputHandlersSource.indexOf(end, startIndex);
  assert.ok(startIndex >= 0, `Missing source marker: ${start}`);
  assert.ok(endIndex > startIndex, `Missing source marker: ${end}`);
  return inputHandlersSource.slice(startIndex, endIndex);
}

test("active editor row input schedules coalesced review sidebar renders only", () => {
  const handlerSource = sourceBetween(
    "function handleEditorRowFieldInput",
    "function handleEditorCommentDraftInput",
  );

  assert.match(inputHandlersSource, /let liveReviewSidebarRenderPending = false;/);
  assert.match(inputHandlersSource, /requestAnimationFrame/);
  assert.match(inputHandlersSource, /render\(\{ scope: "translate-sidebar" \}\);/);
  assert.match(handlerSource, /scheduleLiveReviewSidebarRender\(render\);/);
  assert.doesNotMatch(handlerSource, /render\?\.\(\{ scope: "translate-sidebar" \}\);/);
  assert.doesNotMatch(handlerSource, /render\?\.\(\);/);
});

test("editor source and target language handlers open the language manager instead of changing selection", () => {
  assert.match(
    inputHandlersSource,
    /function handleEditorSourceLanguageInput[\s\S]*input\.value === MANAGE_CHAPTER_LANGUAGES_OPTION_VALUE[\s\S]*openTargetLanguageManager\(render\)[\s\S]*return true;[\s\S]*updateEditorSourceLanguage\(render, input\.value\);/,
  );
  assert.match(
    inputHandlersSource,
    /function handleEditorTargetLanguageInput[\s\S]*input\.value === MANAGE_CHAPTER_LANGUAGES_OPTION_VALUE[\s\S]*openTargetLanguageManager\(render\)[\s\S]*return true;[\s\S]*updateEditorTargetLanguage\(render, input\.value\);/,
  );
});

test("add translation paste input sync clears all disabled button state", () => {
  const handlerSource = sourceBetween(
    "function syncProjectAddTranslationPasteControls",
    "function handleProjectAddTranslationInput",
  );

  assert.match(handlerSource, /continueButton\.disabled = disabled;/);
  assert.match(handlerSource, /classList\?\.toggle\?\.\("is-disabled", disabled\)/);
  assert.match(handlerSource, /setAttribute\?\.\("aria-disabled", "true"\)/);
  assert.match(handlerSource, /setAttribute\?\.\("data-offline-blocked", "true"\)/);
  assert.match(handlerSource, /removeAttribute\?\.\("aria-disabled"\)/);
  assert.match(handlerSource, /removeAttribute\?\.\("data-offline-blocked"\)/);
});
