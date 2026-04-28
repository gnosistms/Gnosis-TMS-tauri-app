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
  assert.match(html, /data-project-export-format-select/);
  assert.match(html, /data-action="submit-project-export" disabled/);
  assert.doesNotMatch(html, /data-project-export-language-select/);
});

test("project export modal shows export language for implemented formats", () => {
  const html = renderProjectExportModal(exportState({ format: "docx" }));

  assert.match(html, /Export language/);
  assert.match(html, /data-project-export-language-select/);
  assert.match(html, /<option value="en" selected>English \(en\)<\/option>/);
  assert.doesNotMatch(html, /data-action="submit-project-export" disabled/);
});

test("project export modal shows unsupported function state", () => {
  const html = renderProjectExportModal(exportState({ unsupportedFormat: "xlsx" }));

  assert.match(html, /Unsupported function/);
  assert.match(html, /This feature is not implemented yet\./);
  assert.match(html, /Contact the developers if you need this feature and ask them to implement it\./);
  assert.match(html, /data-action="close-project-export-unsupported"/);
});
