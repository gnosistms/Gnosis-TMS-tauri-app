import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const editorRowRenderSource = readFileSync(
  path.join(currentDir, "editor-row-render.js"),
  "utf8",
);

test("editor row render templates no longer emit invisible highlight layers", () => {
  assert.equal(editorRowRenderSource.includes("data-editor-search-highlight"), false);
  assert.equal(editorRowRenderSource.includes("data-editor-glossary-highlight"), false);
});
