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
        footnoteLinksAsPlainText: true,
        omitCustomHtml: true,
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

  assert.match(html, /Export chapter/);
  assert.doesNotMatch(html, /Choose where this chapter should go/);
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

  assert.match(html, /Save this chapter as an HTML file\./);
  assert.match(html, /data-action="submit-editor-export"/);
  assert.match(html, /data-action="close-editor-export-options"/);
  assert.match(html, /aria-pressed="true"[^>]*>HTML</);
});

test("PDF pane explains the persistent serif fonts and shows job progress", () => {
  const html = renderEditorExportModal(exportState({
    selectedOptionId: "file:pdf",
    status: "exporting",
    pdfJobId: "pdf-job-1",
    pdfStage: "Downloading Noto Serif for PDF export…",
    pdfProgressCurrent: 2_000_000,
    pdfProgressTotal: 4_335_688,
    pdfProgressUnit: "bytes",
    pdfProgressIndeterminate: false,
    pdfFontStatus: "ready",
    pdfFontMissingBytes: 4_335_688,
    pdfFontFamilies: ["Noto Serif"],
  }));

  assert.match(html, /Noto Serif print fonts/);
  assert.match(html, /4\.1 MB \(4,335,688 bytes\)/);
  assert.match(html, /kept between app updates/);
  assert.match(html, /Downloading Noto Serif for PDF export/);
  assert.match(html, /data-editor-export-paper-size-select disabled/);
  assert.match(html, /1\.9 of 4\.1 MB/);
  assert.match(html, /role="progressbar"[^>]*aria-valuenow="46"/);
  assert.match(html, /data-action="close-editor-export-options"[^>]*>\s*Cancel export\s*</);
  assert.doesNotMatch(html, /data-action="close-editor-export-options" disabled/);
  assert.match(html, /Show links in footnotes as plain text/);
  assert.match(html, /Omit custom HTML/);
});

test("PDF pane shows indeterminate typesetting progress with cancellation enabled", () => {
  const html = renderEditorExportModal(exportState({
    selectedOptionId: "file:pdf",
    status: "exporting",
    pdfJobId: "pdf-job-2",
    pdfStage: "Typesetting the PDF…",
    pdfProgressIndeterminate: true,
    pdfFontStatus: "ready",
    pdfFontMissingBytes: 0,
  }));

  assert.match(html, /Typesetting the PDF/);
  assert.match(html, /editor-export-modal__pdf-progress-track is-indeterminate/);
  assert.match(html, /role="progressbar"/);
  assert.doesNotMatch(html, /aria-valuenow=/);
  assert.match(html, /data-action="close-editor-export-options"[^>]*>\s*Cancel export\s*</);
  assert.doesNotMatch(html, /data-action="close-editor-export-options" disabled/);
});

test("PDF cancellation is enabled while the export waits for the repository queue", () => {
  const html = renderEditorExportModal(exportState({
    selectedOptionId: "file:pdf",
    status: "exporting",
    pdfJobId: "pdf-job-queued",
    pdfStartPending: true,
    pdfStage: "Preparing the chapter…",
    pdfProgressIndeterminate: true,
    pdfFontStatus: "ready",
    pdfFontMissingBytes: 0,
  }));

  assert.match(html, /Cancel export/);
  assert.doesNotMatch(html, /data-action="close-editor-export-options" disabled/);
});

test("PDF pane reports cached fonts without offering another download", () => {
  const html = renderEditorExportModal(exportState({
    selectedOptionId: "file:pdf",
    pdfFontStatus: "ready",
    pdfFontMissingBytes: 0,
  }));

  assert.doesNotMatch(html, /PDF fonts are installed\. No download is required\./);
  assert.match(html, /data-editor-export-paper-size-select/);
  assert.match(html, /data-listbox-trigger/);
  assert.match(html, /aria-haspopup="listbox"/);
  assert.match(html, /listbox-control__chevron/);
  assert.match(html, /<option value="a4" selected>A4 \(210 × 297 mm\)<\/option>/);
  assert.match(html, /<option value="us-legal" >US Legal/);
  assert.match(html, /<option value="a3" >A3 \(297 × 420 mm\)<\/option>/);
  assert.match(html, /<option value="iso-b5" >B5 \/ ISO/);
  assert.match(html, /data-action="submit-editor-export"/);
});

test("PDF pane reflects the selected paper size", () => {
  const html = renderEditorExportModal(exportState({
    selectedOptionId: "file:pdf",
    pdfPaperSize: "a4",
    pdfFontStatus: "ready",
    pdfFontMissingBytes: 0,
  }));

  assert.match(html, /<option value="a4" selected>A4 \(210 × 297 mm\)<\/option>/);
  assert.doesNotMatch(html, /<option value="us-letter" selected>/);
});

test("PDF pane falls back to A4 when no paper-size preference is present", () => {
  const html = renderEditorExportModal(exportState({
    selectedOptionId: "file:pdf",
    pdfPaperSize: "",
    pdfFontStatus: "ready",
  }));

  assert.match(html, /<option value="a4" selected>A4 \(210 × 297 mm\)<\/option>/);
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
  for (const { selectedOptionId, description } of [
    { selectedOptionId: "file:xlsx", description: "Save this chapter as an XLSX file." },
    { selectedOptionId: "file:rtf", description: "Save this chapter as an RTF file." },
    { selectedOptionId: "file:md", description: "Save this chapter as a Markdown (.md) file." },
  ]) {
    const html = renderEditorExportModal(exportState({ selectedOptionId }));

    assert.match(html, new RegExp(description.replace(/[().]/g, "\\$&")));
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
  assert.match(html, /editor-export-modal__wordpress-mode is-selected/);
  assert.match(html, /data-wordpress-mode-input checked/);
  assert.match(html, /editor-export-modal__wordpress-mode-title">Create a new draft post/);
  assert.match(html, /data-wordpress-title-input/);
  assert.match(html, /value="Chapter One"/);
  assert.match(html, /Start a new draft that you can review and publish in WordPress\.com\./);
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
  assert.match(html, /editor-export-modal__wordpress-mode is-selected[\s\S]*value="overwrite"/);
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

test("print-oriented file options offer the footnote-links-as-plain-text checkbox", () => {
  const docx = renderEditorExportModal(projectsPageExportState({ selectedOptionId: "file:docx" }));
  assert.match(docx, /data-editor-export-footnote-links-toggle/);
  assert.match(docx, /Show links in footnotes as plain text/);

  // HTML and XLSX are not print formats, so no checkbox.
  const html = renderEditorExportModal(projectsPageExportState({ selectedOptionId: "file:html" }));
  assert.doesNotMatch(html, /data-editor-export-footnote-links-toggle/);
  const xlsx = renderEditorExportModal(projectsPageExportState({ selectedOptionId: "file:xlsx" }));
  assert.doesNotMatch(xlsx, /data-editor-export-footnote-links-toggle/);
});

test("the footnote-links checkbox reflects the modal state", () => {
  const unchecked = renderEditorExportModal(projectsPageExportState({
    selectedOptionId: "file:docx",
    footnoteLinksAsPlainText: false,
  }));
  assert.doesNotMatch(unchecked, /data-editor-export-footnote-links-toggle[^>]*checked/);

  // On by default for print formats.
  const checked = renderEditorExportModal(projectsPageExportState({ selectedOptionId: "file:docx" }));
  assert.match(checked, /data-editor-export-footnote-links-toggle[^>]*checked/);
});

test("formats that cannot render HTML offer the omit-custom-html checkbox, checked by default", () => {
  for (const selectedOptionId of ["file:docx", "file:txt", "file:md", "file:xlsx"]) {
    const html = renderEditorExportModal(projectsPageExportState({ selectedOptionId }));
    assert.match(html, /data-editor-export-omit-custom-html-toggle/);
    assert.match(html, /Omit custom HTML/);
    // Default-on: the box is checked unless explicitly turned off.
    assert.match(html, /data-editor-export-omit-custom-html-toggle[^>]*checked/);
  }

  // HTML export carries raw custom HTML verbatim, so no omit checkbox.
  const htmlFile = renderEditorExportModal(projectsPageExportState({ selectedOptionId: "file:html" }));
  assert.doesNotMatch(htmlFile, /data-editor-export-omit-custom-html-toggle/);
});

test("the omit-custom-html checkbox reflects the modal state", () => {
  const off = renderEditorExportModal(projectsPageExportState({
    selectedOptionId: "file:docx",
    omitCustomHtml: false,
  }));
  assert.doesNotMatch(off, /data-editor-export-omit-custom-html-toggle[^>]*checked/);
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
