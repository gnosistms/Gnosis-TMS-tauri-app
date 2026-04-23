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

test("editor row render templates emit highlight layers for open editor fields", () => {
  assert.equal(editorRowRenderSource.includes("data-editor-search-highlight"), true);
  assert.equal(editorRowRenderSource.includes("data-editor-glossary-highlight"), true);
});
