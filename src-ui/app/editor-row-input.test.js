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

test("filtered editor row input rerenders only the translate body", () => {
  const render = createSpy();
  const updateEditorRowFieldValue = createSpy();
  const syncEditorRowTextareaHeight = createSpy();
  const syncEditorVirtualizationRowLayout = createSpy();
  const syncEditorGlossaryHighlightRowDom = createSpy();

  applyEditorRowFieldInput({
    input: createInput(),
    filters: { searchQuery: "distintos", caseSensitive: false },
    render,
    updateEditorRowFieldValue,
    syncEditorRowTextareaHeight,
    syncEditorVirtualizationRowLayout,
    syncEditorGlossaryHighlightRowDom,
  });

  assert.deepEqual(updateEditorRowFieldValue.calls, [["row-1", "es", "nuevo texto"]]);
  assert.deepEqual(render.calls, [[{ scope: "translate-body" }]]);
  assert.equal(syncEditorRowTextareaHeight.calls.length, 0);
  assert.equal(syncEditorVirtualizationRowLayout.calls.length, 0);
  assert.equal(syncEditorGlossaryHighlightRowDom.calls.length, 0);
});

test("dropdown-only editor filters also rerender only the translate body", () => {
  const render = createSpy();
  const updateEditorRowFieldValue = createSpy();
  const syncEditorRowTextareaHeight = createSpy();
  const syncEditorVirtualizationRowLayout = createSpy();
  const syncEditorGlossaryHighlightRowDom = createSpy();

  applyEditorRowFieldInput({
    input: createInput(),
    filters: { searchQuery: "", caseSensitive: false, rowFilterMode: "reviewed" },
    render,
    updateEditorRowFieldValue,
    syncEditorRowTextareaHeight,
    syncEditorVirtualizationRowLayout,
    syncEditorGlossaryHighlightRowDom,
  });

  assert.deepEqual(updateEditorRowFieldValue.calls, [["row-1", "es", "nuevo texto"]]);
  assert.deepEqual(render.calls, [[{ scope: "translate-body" }]]);
  assert.equal(syncEditorRowTextareaHeight.calls.length, 0);
  assert.equal(syncEditorVirtualizationRowLayout.calls.length, 0);
  assert.equal(syncEditorGlossaryHighlightRowDom.calls.length, 0);
});

test("unfiltered editor row input keeps the local autosize and virtualization updates", () => {
  const render = createSpy();
  const updateEditorRowFieldValue = createSpy();
  const syncEditorRowTextareaHeight = createSpy();
  const syncEditorVirtualizationRowLayout = createSpy();
  const syncEditorGlossaryHighlightRowDom = createSpy();
  const input = createInput();

  applyEditorRowFieldInput({
    input,
    filters: { searchQuery: "", caseSensitive: false },
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
