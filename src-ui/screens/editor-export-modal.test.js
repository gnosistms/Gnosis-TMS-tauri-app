import test from "node:test";
import assert from "node:assert/strict";

import { renderEditorExportModal } from "./editor-export-modal.js";

function exportState(overrides = {}) {
  return {
    editorChapter: {
      exportModal: {
        isOpen: true,
        expandedCategoryIds: ["file"],
        selectedOptionId: "file:html",
        status: "idle",
        error: "",
        ...overrides,
      },
    },
  };
}

test("editor export modal renders nothing while closed", () => {
  assert.equal(renderEditorExportModal(exportState({ isOpen: false })), "");
  assert.equal(renderEditorExportModal({}), "");
});

test("editor export modal lists categories and expands only opened ones", () => {
  const html = renderEditorExportModal(exportState());

  assert.match(html, /Export options/);
  assert.match(html, /Save to file/);
  assert.match(html, /Copy and paste/);
  assert.match(html, /Link and transfer/);
  assert.match(html, /data-action="toggle-editor-export-category:file"[^>]*aria-expanded="true"/);
  assert.match(html, /data-action="toggle-editor-export-category:copy"[^>]*aria-expanded="false"/);
  assert.match(html, /data-action="select-editor-export-option:file:html"/);
  assert.doesNotMatch(html, /data-action="select-editor-export-option:copy:text"/);
});

test("editor export modal shows the save pane for available file formats", () => {
  const html = renderEditorExportModal(exportState());

  assert.match(html, /Click Save to export a HTML file\./);
  assert.match(html, /data-action="submit-editor-export"/);
  assert.match(html, /data-action="close-editor-export-options"/);
  assert.match(html, /aria-pressed="true"[^>]*>HTML</);
});

test("editor export modal shows the copy pane for clipboard options", () => {
  const html = renderEditorExportModal(exportState({
    expandedCategoryIds: ["copy"],
    selectedOptionId: "copy:text",
  }));

  assert.match(html, /Click Copy to export plain text data to the clipboard for pasting into other apps\./);
  assert.match(html, /data-action="submit-editor-export"/);
});

test("editor export modal hides the submit button for unavailable options", () => {
  for (const selectedOptionId of ["file:xlsx", "copy:docx", "link:wordpress", "link:team"]) {
    const html = renderEditorExportModal(exportState({ selectedOptionId }));

    assert.match(html, /This export option is not available yet\./);
    assert.doesNotMatch(html, /data-action="submit-editor-export"/);
    assert.match(html, /data-action="close-editor-export-options"/);
  }
});

test("editor export modal shows errors and the busy submit state", () => {
  const html = renderEditorExportModal(exportState({
    status: "exporting",
    error: "export failed",
  }));

  assert.match(html, /export failed/);
  assert.match(html, /Saving\.\.\./);
  assert.match(html, /data-action="close-editor-export-options" disabled/);
});
