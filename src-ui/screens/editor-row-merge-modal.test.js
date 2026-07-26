import assert from "node:assert/strict";
import test from "node:test";

import { renderEditorRowMergeModal } from "./editor-row-merge-modal.js";

function mergeState(status = "idle", error = "") {
  return {
    editorChapter: {
      rows: [
        { rowId: "row-1", lifecycleState: "active" },
        { rowId: "row-2", lifecycleState: "active" },
        { rowId: "row-3", lifecycleState: "active" },
      ],
      mergeRowModal: {
        isOpen: true,
        rowId: "row-2",
        status,
        error,
      },
    },
  };
}

test("row merge modal keeps its two directional actions while idle", () => {
  const html = renderEditorRowMergeModal(mergeState());
  assert.match(html, /data-action="confirm-merge-editor-rows-previous"/);
  assert.match(html, /data-action="confirm-merge-editor-rows-next"/);
  assert.doesNotMatch(html, /data-loading-spinner-key/);
});

test("row merge loading state uses one neutral keyed operation button", () => {
  const html = renderEditorRowMergeModal(mergeState("loading"));
  assert.match(html, /Merging\.\.\./);
  assert.match(html, /data-action="noop"/);
  assert.match(html, /data-loading-spinner-key="merge-editor-rows"/);
  assert.match(html, /disabled aria-busy="true"/);
  assert.doesNotMatch(html, /confirm-merge-editor-rows-previous/);
  assert.doesNotMatch(html, /confirm-merge-editor-rows-next/);
});

test("row merge error state restores directional actions", () => {
  const html = renderEditorRowMergeModal(mergeState("idle", "Merge failed."));
  assert.match(html, /Merge failed\./);
  assert.match(html, /confirm-merge-editor-rows-previous/);
  assert.match(html, /confirm-merge-editor-rows-next/);
  assert.doesNotMatch(html, /data-loading-spinner-key/);
});

test("row merge keeps unavailable adjacency disabled", () => {
  const state = mergeState();
  state.editorChapter.mergeRowModal.rowId = "row-1";
  const html = renderEditorRowMergeModal(state);
  assert.match(
    html,
    /data-action="confirm-merge-editor-rows-previous"[\s\S]*?disabled aria-disabled="true"/,
  );
  assert.match(html, /data-action="confirm-merge-editor-rows-next"/);
});
