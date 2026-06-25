import test from "node:test";
import assert from "node:assert/strict";

import { renderEditorExportModal } from "./editor-export-modal.js";

const originalNavigator = globalThis.navigator;

function installNavigatorPlatform(platform) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { platform },
  });
}

function exportState(overrides = {}) {
  return {
    editorChapter: {
      chapterId: "chapter-1",
      exportModal: {
        isOpen: true,
        expandedCategoryIds: ["file"],
        selectedOptionId: "file:html",
        chapterId: "chapter-1",
        languageCode: "",
        status: "idle",
        error: "",
        ...overrides,
      },
    },
  };
}

test.afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  });
});

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

test("editor export modal lists Vellum only on macOS", () => {
  installNavigatorPlatform("MacIntel");
  const macHtml = renderEditorExportModal(exportState({
    expandedCategoryIds: ["copy"],
    selectedOptionId: "copy:text",
  }));
  assert.match(macHtml, /data-action="select-editor-export-option:copy:vellum"/);

  installNavigatorPlatform("Win32");
  const windowsHtml = renderEditorExportModal(exportState({
    expandedCategoryIds: ["copy"],
    selectedOptionId: "copy:text",
  }));
  assert.doesNotMatch(windowsHtml, /data-action="select-editor-export-option:copy:vellum"/);
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
  for (const selectedOptionId of ["copy:docx"]) {
    const html = renderEditorExportModal(exportState({ selectedOptionId }));

    assert.match(html, /This export option is not available yet\./);
    assert.doesNotMatch(html, /data-action="submit-editor-export"/);
    assert.match(html, /data-action="close-editor-export-options"/);
  }
});

function teamCopyState(teamCopyOverrides = {}, modalOverrides = {}, stateOverrides = {}) {
  const base = exportState({
    expandedCategoryIds: ["link"],
    selectedOptionId: "link:team",
    teamCopy: {
      targetTeamId: "",
      projectsStatus: "idle",
      projects: [],
      targetProjectId: "",
      copyStage: "",
      jobId: "",
      ...teamCopyOverrides,
    },
    ...modalOverrides,
  });
  return {
    ...base,
    selectedTeamId: "team-1",
    teams: [
      { id: "team-1", installationId: 42, name: "Home Team", membershipRole: "owner" },
      { id: "team-2", installationId: 77, name: "Other Team", membershipRole: "translator" },
      { id: "team-3", installationId: 88, name: "Read Only", membershipRole: "viewer" },
    ],
    ...stateOverrides,
  };
}

test("team copy pane explains when no writable team exists", () => {
  const html = renderEditorExportModal(teamCopyState({}, {}, {
    teams: [{ id: "team-3", installationId: 88, name: "Read Only", membershipRole: "viewer" }],
  }));

  assert.match(html, /not a member of a team where you can add files/);
  assert.doesNotMatch(html, /data-action="submit-editor-export"/);
});

test("team copy pane lists every writable team including the current one", () => {
  const html = renderEditorExportModal(teamCopyState());

  assert.match(html, /data-team-copy-team-select/);
  assert.match(html, /<option value="team-1" >Home Team<\/option>/);
  assert.match(html, /<option value="team-2" >Other Team<\/option>/);
  assert.doesNotMatch(html, /Read Only/);
  assert.match(html, /Choose the team to copy this chapter to\./);
  assert.match(html, /data-action="submit-editor-export"/);
});

test("team copy pane shows the project select once projects load", () => {
  const loading = renderEditorExportModal(teamCopyState({
    targetTeamId: "team-2",
    projectsStatus: "loading",
  }));
  assert.match(loading, /Loading that team&#39;s projects\.\.\./);

  const empty = renderEditorExportModal(teamCopyState({
    targetTeamId: "team-2",
    projectsStatus: "done",
    projects: [],
  }));
  assert.match(empty, /That team has no projects yet\./);

  const loaded = renderEditorExportModal(teamCopyState({
    targetTeamId: "team-2",
    projectsStatus: "done",
    projects: [{ id: "project-9", name: "other-repo", title: "Other Project" }],
    targetProjectId: "project-9",
  }));
  assert.match(loaded, /data-team-copy-project-select/);
  assert.match(loaded, /<option value="project-9" selected>Other Project<\/option>/);
  assert.match(loaded, /data-team-copy-title-input/);
  assert.match(loaded, /The copy will appear as a new file in Other Project \(Other Team\)\./);
});

test("team copy pane shows the copy stage while exporting", () => {
  const html = renderEditorExportModal(teamCopyState(
    { targetTeamId: "team-2", copyStage: "Copying the chapter..." },
    { status: "exporting" },
  ));

  assert.match(html, /Copying the chapter\.\.\./);
  assert.match(html, /Copying\.\.\./);
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
  assert.doesNotMatch(html, /This cannot be undone\./);
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

function projectsPageExportState(modalOverrides = {}) {
  const base = exportState({
    chapterId: "chapter-2",
    languageCode: "vi",
    ...modalOverrides,
  });
  return {
    ...base,
    editorChapter: { ...base.editorChapter, chapterId: "" },
    projects: [{
      id: "project-1",
      chapters: [{
        id: "chapter-2",
        name: "Chapter Two",
        languages: [
          { code: "es", name: "Spanish", role: "source" },
          { code: "vi", name: "Vietnamese", role: "target" },
        ],
      }],
    }],
  };
}

test("file panes opened from the projects page offer an export language select", () => {
  const html = renderEditorExportModal(projectsPageExportState());

  assert.match(html, /data-editor-export-language-select/);
  assert.match(html, /<option value="vi" selected>Vietnamese \(vi\)<\/option>/);
  assert.match(html, /<option value="es" >Spanish \(es\)<\/option>/);
  assert.match(html, /data-action="submit-editor-export"/);

  // XLSX exports every language column at once, so no language select.
  const xlsx = renderEditorExportModal(projectsPageExportState({ selectedOptionId: "file:xlsx" }));
  assert.doesNotMatch(xlsx, /data-editor-export-language-select/);
});

test("file panes opened from the editor keep following the preview language", () => {
  const html = renderEditorExportModal(exportState());

  assert.doesNotMatch(html, /data-editor-export-language-select/);
});

test("clipboard and WordPress panes require the chapter open in the editor", () => {
  for (const selectedOptionId of ["copy:text", "copy:html", "link:wordpress"]) {
    const html = renderEditorExportModal(projectsPageExportState({
      selectedOptionId,
      expandedCategoryIds: ["copy", "link"],
    }));

    assert.match(html, /Open the file in the editor to use this export option\./);
    assert.doesNotMatch(html, /data-action="submit-editor-export"/);
  }
});
