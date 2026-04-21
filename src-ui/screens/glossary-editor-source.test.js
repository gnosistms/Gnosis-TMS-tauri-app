import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const glossaryEditorSource = readFileSync(
  path.join(currentDir, "glossary-editor.js"),
  "utf8",
);

test("glossary editor rows open the term editor from the row itself", () => {
  assert.equal(
    glossaryEditorSource.includes('term-grid--row${canManageTerms ? " term-grid--row--interactive" : ""}'),
    true,
  );
  assert.equal(
    glossaryEditorSource.includes('data-action="edit-glossary-term:${term.termId}"'),
    true,
  );
});
