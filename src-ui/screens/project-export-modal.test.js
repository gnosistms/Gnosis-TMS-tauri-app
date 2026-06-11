import test from "node:test";
import assert from "node:assert/strict";

import { renderProjectExportModal } from "./project-export-modal.js";

function exportState(overrides = {}) {
  return {
    projectExport: {
      isOpen: true,
      chapterId: "chapter-1",
      projectId: "project-1",
      repoName: "project-repo",
      projectFullName: "org/project-repo",
      chapterName: "Chapter",
      languages: [
        { code: "es", name: "Spanish", role: "source" },
        { code: "en", name: "English", role: "target" },
      ],
      format: "",
      languageCode: "en",
      status: "idle",
      error: "",
      unsupportedFormat: "",
      ...overrides,
    },
  };
}

test("project export modal disables Save until a supported format is selected", () => {
  const html = renderProjectExportModal(exportState());

  assert.match(html, /Export/);
  assert.match(html, /Select file format/);
  assert.match(html, /project-export-modal__label">File format<\/span>/);
  assert.match(html, /data-project-export-format-select/);
  assert.doesNotMatch(html, /select-pill__label">File format/);
  assert.match(html, /data-action="submit-project-export" disabled/);
  assert.doesNotMatch(html, /data-project-export-language-select/);
});

test("project export modal shows export language for implemented formats", () => {
  const html = renderProjectExportModal(exportState({ format: "docx" }));

  assert.match(html, /Export language/);
  assert.match(html, /project-export-modal__label">Export language<\/span>/);
  assert.match(html, /data-project-export-language-select/);
  assert.doesNotMatch(html, /select-pill__label">Export language/);
  assert.match(html, /<option value="en" selected>English \(en\)<\/option>/);
  assert.doesNotMatch(html, /data-action="submit-project-export" disabled/);
});

test("project export modal lists the Phase 2 formats as selectable options", () => {
  const html = renderProjectExportModal(exportState());

  assert.match(html, /<option value="xlsx" >XLSX<\/option>/);
  assert.match(html, /<option value="rtf" >RTF<\/option>/);
  assert.match(html, /<option value="md" >MD<\/option>/);
});

test("project export modal shows export language for rtf and md formats", () => {
  for (const format of ["rtf", "md"]) {
    const html = renderProjectExportModal(exportState({ format }));

    assert.match(html, /data-project-export-language-select/);
    assert.doesNotMatch(html, /data-action="submit-project-export" disabled/);
  }
});

test("project export modal hides the language select for xlsx exports", () => {
  const html = renderProjectExportModal(exportState({ format: "xlsx" }));

  assert.doesNotMatch(html, /data-project-export-language-select/);
  assert.doesNotMatch(html, /data-action="submit-project-export" disabled/);
});

test("project export modal shows unsupported function state", () => {
  const html = renderProjectExportModal(exportState({ unsupportedFormat: "srt" }));

  assert.match(html, /Unsupported function/);
  assert.match(html, /Export option unavailable/);
  assert.match(html, /This export option is not available yet\./);
  assert.match(html, /data-action="close-project-export-unsupported"/);
});
