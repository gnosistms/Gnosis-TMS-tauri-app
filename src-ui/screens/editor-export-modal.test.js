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

test("editor export modal shows the save pane for the Phase 2 file formats", () => {
  for (const { selectedOptionId, label } of [
    { selectedOptionId: "file:xlsx", label: "XLSX" },
    { selectedOptionId: "file:rtf", label: "RTF" },
    { selectedOptionId: "file:md", label: "Markdown" },
  ]) {
    const html = renderEditorExportModal(exportState({ selectedOptionId }));

    assert.match(html, new RegExp(`Click Save to export a ${label} file\\.`));
    assert.match(html, /data-action="submit-editor-export"/);
  }
});

test("editor export modal hides the submit button for unavailable options", () => {
  for (const selectedOptionId of ["copy:docx", "link:team"]) {
    const html = renderEditorExportModal(exportState({ selectedOptionId }));

    assert.match(html, /This export option is not available yet\./);
    assert.doesNotMatch(html, /data-action="submit-editor-export"/);
    assert.match(html, /data-action="close-editor-export-options"/);
  }
});

function wordpressState(wordpressOverrides = {}, modalOverrides = {}) {
  return exportState({
    expandedCategoryIds: ["link"],
    selectedOptionId: "link:wordpress",
    wordpress: {
      connectionStatus: "connected",
      connection: { blogId: "12345", blogUrl: "https://example.wordpress.com" },
      mode: "create",
      title: "Chapter One",
      searchQuery: "",
      searchStatus: "idle",
      searchResults: [],
      selectedPostId: null,
      exportStage: "",
      jobId: "",
      ...wordpressOverrides,
    },
    ...modalOverrides,
  });
}

test("editor export modal shows the WordPress connect pane while disconnected", () => {
  const html = renderEditorExportModal(wordpressState({
    connectionStatus: "disconnected",
    connection: null,
  }));

  assert.match(html, /Connect your WordPress\.com account/);
  assert.match(html, /data-action="connect-wordpress"/);
  assert.doesNotMatch(html, /data-action="submit-editor-export"/);
});

test("editor export modal shows the WordPress create pane with a title field", () => {
  const html = renderEditorExportModal(wordpressState());

  assert.match(html, /Connected to <strong>https:\/\/example\.wordpress\.com<\/strong>/);
  assert.match(html, /data-action="disconnect-wordpress"/);
  assert.match(html, /data-wordpress-mode-input checked[^>]*\/>\s*<span>Create a new draft post<\/span>/);
  assert.match(html, /data-wordpress-title-input/);
  assert.match(html, /value="Chapter One"/);
  assert.match(html, /A new draft post will be created\./);
  assert.match(html, /Export draft/);
  assert.match(html, /data-action="submit-editor-export"/);
});

test("editor export modal shows the WordPress overwrite pane with search and warning", () => {
  const html = renderEditorExportModal(wordpressState({
    mode: "overwrite",
    searchQuery: "hello",
    searchStatus: "done",
    searchResults: [
      { id: 7, title: "Hello World", status: "publish", link: "", modified: "" },
      { id: 9, title: "Draft Post", status: "draft", link: "", modified: "" },
    ],
    selectedPostId: 7,
  }));

  assert.match(html, /data-wordpress-search-input/);
  assert.match(html, /data-action="search-wordpress-posts"/);
  assert.match(html, /data-action="select-wordpress-post:7"[^>]*aria-pressed="true"/);
  assert.match(html, /data-action="select-wordpress-post:9"[^>]*aria-pressed="false"/);
  assert.match(html, /Draft Post <span class="editor-export-modal__wordpress-post-status">draft<\/span>/);
  assert.match(html, /Exporting will replace the content of/);
  assert.match(html, /Hello World/);
  assert.match(html, /This cannot be undone\./);
  assert.match(html, /Overwrite post/);
});

test("editor export modal requires choosing a post before the overwrite warning", () => {
  const html = renderEditorExportModal(wordpressState({
    mode: "overwrite",
    searchStatus: "done",
    searchResults: [{ id: 7, title: "Hello World", status: "publish", link: "", modified: "" }],
    selectedPostId: null,
  }));

  assert.match(html, /Search for the post to overwrite, then choose it from the results\./);
  assert.doesNotMatch(html, /This cannot be undone\./);
});

test("editor export modal shows the WordPress export stage while exporting", () => {
  const html = renderEditorExportModal(wordpressState(
    { exportStage: "Uploading image 1 of 3..." },
    { status: "exporting" },
  ));

  assert.match(html, /Uploading image 1 of 3\.\.\./);
  assert.match(html, /Exporting\.\.\./);
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
