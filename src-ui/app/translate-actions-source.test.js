import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  path.join(currentDir, "actions/translate-actions.js"),
  "utf8",
);

function extractSetBody(name) {
  const match = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`).exec(source);
  assert.ok(match, `Expected ${name} to be defined`);
  return match[1];
}

function extractArrayBody(name) {
  const match = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(source);
  assert.ok(match, `Expected ${name} to be defined`);
  return match[1];
}

function assertBodyContains(body, ...items) {
  for (const item of items) {
    assert.ok(body.includes(`"${item}"`), `Expected body to include ${item}`);
  }
}

test("language visibility toggle has access to editor collapsed language state", () => {
  assert.match(source, /import \{ state \} from "\.\.\/state\.js";/);
  assert.match(source, /captureLanguageToggleVisibilityAnchor\([\s\S]*state\.editorChapter\?\.collapsedLanguageCodes/);
});

test("editor permission guard keeps setup actions session-scoped and writes current-scoped", () => {
  assertBodyContains(
    extractSetBody("SESSION_WRITE_ACTIONS"),
    "open-editor-footnote",
    "open-editor-image-url",
    "open-editor-ai-review-all",
  );
  assertBodyContains(
    extractSetBody("CURRENT_WRITE_ACTIONS"),
    "save-editor-comment",
    "confirm-editor-ai-review-all",
    "replace-selected-editor-rows",
  );
  assertBodyContains(
    extractArrayBody("SESSION_WRITE_PREFIXES"),
    "open-insert-editor-row:",
    "open-editor-conflict-resolution:",
  );
  assertBodyContains(
    extractArrayBody("CURRENT_WRITE_PREFIXES"),
    "restore-editor-history:",
    "delete-editor-comment:",
    "soft-delete-editor-row:",
    "restore-editor-row:",
  );
  assert.match(source, /editorActionPermissionMode\(action\) === "current"[\s\S]*\? assertCurrentEditorWritePermission[\s\S]*: assertEditorSessionWritePermission/);
});
