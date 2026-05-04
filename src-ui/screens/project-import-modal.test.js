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
  assert.match(html, /Drop files here or click to open the file selector\./);
  assert.match(html, /Select files/);
  assert.match(html, /Supported formats: \.xlsx, \.txt, or \.docx\./);
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

test("project import modal renders source language selection step for text-like files", () => {
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
  assert.match(html, /data-action="select-project-import-source-language:zh-Hans"/);
  assert.match(html, /data-action="select-project-import-source-language:zh-Hant"/);
  assert.doesNotMatch(html, /data-action="select-project-import-source-language:zh"/);
  assert.match(html, /data-action="continue-project-import-text" disabled/);
});

test("project import modal renders batch source language copy", () => {
  const html = renderProjectImportModal({
    projectImport: {
      isOpen: true,
      projectTitle: "Translation Project",
      status: "selectingSourceLanguage",
      error: "",
      isBatch: true,
      selectedSourceLanguageCode: "",
    },
  });

  assert.match(html, /What is the language of these files\?/);
  assert.match(html, /Select the language of these files from the list below\. This will be the source language\./);
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

test("project import source language step canonicalizes selected Chinese script code", () => {
  const html = renderProjectImportModal({
    projectImport: {
      isOpen: true,
      projectTitle: "Translation Project",
      status: "selectingSourceLanguage",
      error: "",
      selectedSourceLanguageCode: "zh-hant",
    },
  });

  assert.match(html, /class="language-picker-modal__option is-selected"[\s\S]*data-action="select-project-import-source-language:zh-Hant"/);
  assert.doesNotMatch(html, /data-action="continue-project-import-text" disabled/);
});

test("project import modal renders grouped upload failures", () => {
  const html = renderProjectImportModal({
    projectImport: {
      isOpen: false,
      failedFileNames: ["bad.docx", "<bad>.xlsx"],
    },
  });

  assert.match(html, /FILE UPLOAD ERROR/);
  assert.match(html, /Some files were not uploaded/);
  assert.match(html, /The following files did not upload successfully:/);
  assert.match(html, /bad\.docx/);
  assert.match(html, /&lt;bad&gt;\.xlsx/);
  assert.match(html, /data-action="close-project-import-upload-error"/);
});
