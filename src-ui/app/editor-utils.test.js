import test from "node:test";
import assert from "node:assert/strict";

import { editorImageEditorCanCollapse } from "./editor-utils.js";

test("editorImageEditorCanCollapse keeps the image editor open while the picker is active", () => {
  assert.equal(editorImageEditorCanCollapse({
    rowId: "row-1",
    languageCode: "vi",
    mode: "upload",
    status: "picking",
    invalidUrl: false,
    urlDraft: "",
  }), false);
});

test("editorImageEditorCanCollapse keeps an idle upload editor open", () => {
  assert.equal(editorImageEditorCanCollapse({
    rowId: "row-1",
    languageCode: "vi",
    mode: "upload",
    status: "idle",
    invalidUrl: false,
    urlDraft: "",
  }), false);
});

test("editorImageEditorCanCollapse keeps invalid-url and drafted-url states open", () => {
  assert.equal(editorImageEditorCanCollapse({
    rowId: "row-1",
    languageCode: "vi",
    mode: null,
    status: "idle",
    invalidUrl: true,
    urlDraft: "https://example.com/nope.png",
  }), false);

  assert.equal(editorImageEditorCanCollapse({
    rowId: "row-1",
    languageCode: "vi",
    mode: "url",
    status: "idle",
    invalidUrl: false,
    urlDraft: " https://example.com/image.png ",
  }), false);
});

test("editorImageEditorCanCollapse allows empty idle editors to close", () => {
  assert.equal(editorImageEditorCanCollapse({
    rowId: "row-1",
    languageCode: "vi",
    mode: "url",
    status: "idle",
    invalidUrl: false,
    urlDraft: "",
  }), true);
});
