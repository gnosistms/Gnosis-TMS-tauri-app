import test from "node:test";
import assert from "node:assert/strict";

import { applyEditorRowFieldInput } from "./editor-row-input.js";

function createSpy() {
  const calls = [];
  const fn = (...args) => {
    calls.push(args);
  };
  fn.calls = calls;
  return fn;
}

function createInput() {
  return {
    value: "nuevo texto",
    dataset: {
      rowId: "row-1",
      languageCode: "es",
    },
  };
}

test("filtered editor row input updates the focused field in place without a body re-render", () => {
  // Re-rendering the body on a keystroke rebuilds every row via innerHTML, which
  // recreates the focused textarea and wipes its native undo stack. With a search
  // filter active the input must still update in place so Cmd/Ctrl+Z keeps working.
  const render = createSpy();
  const updateEditorRowFieldValue = createSpy();
  const syncEditorRowTextareaHeight = createSpy();
  const syncEditorVirtualizationRowLayout = createSpy();
  const syncEditorGlossaryHighlightRowDom = createSpy();
  const cancelPendingTranslateViewportRestores = createSpy();
  const renderTranslateBodyPreservingViewport = createSpy();
  const input = createInput();

  applyEditorRowFieldInput({
    input,
    filters: { searchQuery: "distintos", caseSensitive: false },
    render,
    updateEditorRowFieldValue,
    syncEditorRowTextareaHeight,
    syncEditorVirtualizationRowLayout,
    syncEditorGlossaryHighlightRowDom,
    cancelPendingTranslateViewportRestores,
    renderTranslateBodyPreservingViewport,
  });

  assert.deepEqual(updateEditorRowFieldValue.calls, [["row-1", "es", "nuevo texto"]]);
  assert.deepEqual(cancelPendingTranslateViewportRestores.calls, [[]]);
  assert.equal(render.calls.length, 0);
  assert.equal(renderTranslateBodyPreservingViewport.calls.length, 0);
  assert.deepEqual(syncEditorRowTextareaHeight.calls, [[input]]);
  assert.deepEqual(syncEditorGlossaryHighlightRowDom.calls, [["row-1"]]);
  assert.deepEqual(syncEditorVirtualizationRowLayout.calls, [[input]]);
});

test("dropdown-only editor filters also update the focused field in place", () => {
  const render = createSpy();
  const updateEditorRowFieldValue = createSpy();
  const syncEditorRowTextareaHeight = createSpy();
  const syncEditorVirtualizationRowLayout = createSpy();
  const syncEditorGlossaryHighlightRowDom = createSpy();
  const input = createInput();

  applyEditorRowFieldInput({
    input,
    filters: { searchQuery: "", caseSensitive: false, rowFilterMode: "reviewed" },
    render,
    updateEditorRowFieldValue,
    syncEditorRowTextareaHeight,
    syncEditorVirtualizationRowLayout,
    syncEditorGlossaryHighlightRowDom,
  });

  assert.deepEqual(updateEditorRowFieldValue.calls, [["row-1", "es", "nuevo texto"]]);
  assert.equal(render.calls.length, 0);
  assert.deepEqual(syncEditorRowTextareaHeight.calls, [[input]]);
  assert.deepEqual(syncEditorVirtualizationRowLayout.calls, [[input]]);
  assert.deepEqual(syncEditorGlossaryHighlightRowDom.calls, [["row-1"]]);
});

test("unfiltered editor row input keeps the local autosize and virtualization updates", () => {
  const render = createSpy();
  const updateEditorRowFieldValue = createSpy();
  const callOrder = [];
  const cancelPendingTranslateViewportRestores = () => {
    callOrder.push(["cancel-viewport-restores"]);
  };
  const syncEditorRowTextareaHeight = (...args) => {
    callOrder.push(["autosize", ...args]);
  };
  syncEditorRowTextareaHeight.calls = [];
  const syncEditorVirtualizationRowLayout = (...args) => {
    callOrder.push(["virtualization", ...args]);
  };
  syncEditorVirtualizationRowLayout.calls = [];
  const syncEditorGlossaryHighlightRowDom = (...args) => {
    callOrder.push(["glossary", ...args]);
  };
  syncEditorGlossaryHighlightRowDom.calls = [];
  const input = createInput();

  applyEditorRowFieldInput({
    input,
    filters: { searchQuery: "", caseSensitive: false },
    render,
    updateEditorRowFieldValue,
    syncEditorRowTextareaHeight,
    syncEditorVirtualizationRowLayout,
    syncEditorGlossaryHighlightRowDom,
    cancelPendingTranslateViewportRestores,
  });

  assert.deepEqual(updateEditorRowFieldValue.calls, [["row-1", "es", "nuevo texto"]]);
  assert.equal(render.calls.length, 0);
  assert.deepEqual(callOrder, [
    ["cancel-viewport-restores"],
    ["autosize", input],
    ["glossary", "row-1"],
    ["virtualization", input],
  ]);
});

test("image caption editor input routes through the image-caption content kind", () => {
  const render = createSpy();
  const updateEditorRowFieldValueForContentKind = createSpy();
  const syncEditorRowTextareaHeight = createSpy();
  const syncEditorVirtualizationRowLayout = createSpy();
  const syncEditorGlossaryHighlightRowDom = createSpy();
  const input = createInput();
  input.dataset.contentKind = "image-caption";

  applyEditorRowFieldInput({
    input,
    filters: { searchQuery: "", caseSensitive: false },
    render,
    updateEditorRowFieldValueForContentKind,
    syncEditorRowTextareaHeight,
    syncEditorVirtualizationRowLayout,
    syncEditorGlossaryHighlightRowDom,
  });

  assert.deepEqual(updateEditorRowFieldValueForContentKind.calls, [[
    "row-1",
    "es",
    "nuevo texto",
    "image-caption",
  ]]);
});
