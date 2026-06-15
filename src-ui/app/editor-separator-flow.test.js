import test from "node:test";
import assert from "node:assert/strict";

import { applyInsertSeparatorToValue } from "./editor-separator-flow.js";

test("applyInsertSeparatorToValue inserts the separator at the caret", () => {
  const result = applyInsertSeparatorToValue("Alpha Beta", 5, 5);

  assert.equal(result.value, "Alpha<hr> Beta");
  assert.equal(result.selectionStart, "Alpha<hr>".length);
  assert.equal(result.selectionEnd, "Alpha<hr>".length);
});

test("applyInsertSeparatorToValue replaces the selected range", () => {
  const result = applyInsertSeparatorToValue("Alpha middle Beta", 6, 12);

  assert.equal(result.value, "Alpha <hr> Beta");
  assert.equal(result.selectionStart, "Alpha <hr>".length);
  assert.equal(result.selectionEnd, "Alpha <hr>".length);
});
