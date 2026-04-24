import test from "node:test";
import assert from "node:assert/strict";

import { renderProjectImportModal } from "./project-import-modal.js";

test("project import modal renders the requested drop target copy", () => {
  const html = renderProjectImportModal({
    projectImport: {
      isOpen: true,
      projectTitle: "Translation Project",
      status: "idle",
      error: "",
    },
  });

  assert.match(html, /data-project-import-dropzone/);
  assert.match(html, /Drop a file here or click to open a file selector\./);
  assert.match(html, /Supported formats: \.xlsx or \.txt\./);
});

test("project import modal renders validation errors above the drop target", () => {
  const html = renderProjectImportModal({
    projectImport: {
      isOpen: true,
      projectTitle: "Translation Project",
      status: "error",
      error: "Unsupported file type for notes.txt.",
    },
  });

  assert.match(html, /project-import-modal__error-badge/);
  assert.match(html, /Unsupported file type for notes\.txt\./);
  assert.ok(
    html.indexOf("project-import-modal__error-badge")
      < html.indexOf("data-project-import-dropzone"),
  );
});

test("project import modal renders source language selection step for text files", () => {
  const html = renderProjectImportModal({
    projectImport: {
      isOpen: true,
      projectTitle: "Translation Project",
      status: "selectingSourceLanguage",
      error: "",
      selectedSourceLanguageCode: "",
    },
  });

  assert.match(html, /SOURCE LANGUAGE/);
  assert.match(html, /What is the language of this file\?/);
  assert.match(html, /Select the language of this file from the list below\. This will be the source language\./);
  assert.match(html, /data-action="select-project-import-source-language:en"/);
  assert.match(html, /data-action="continue-project-import-text" disabled/);
});

test("project import source language step enables continue after selection", () => {
  const html = renderProjectImportModal({
    projectImport: {
      isOpen: true,
      projectTitle: "Translation Project",
      status: "selectingSourceLanguage",
      error: "",
      selectedSourceLanguageCode: "en",
    },
  });

  assert.match(html, /class="language-picker-modal__option is-selected"/);
  assert.doesNotMatch(html, /data-action="continue-project-import-text" disabled/);
});
