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

  assert.match(html, /<p class="card__eyebrow">ADD FILES<\/p>/);
  assert.match(html, /<h2 class="modal__title">Add new files to the project<\/h2>/);
  assert.match(html, /Choose how to add content to Translation Project\./);
  assert.match(html, /data-action="select-project-import-input-mode:upload"[\s\S]*Upload/);
  assert.match(html, /data-action="select-project-import-input-mode:pasteLink"[\s\S]*Paste link/);
  assert.match(html, /data-action="select-project-import-input-mode:pasteText"[\s\S]*Paste text/);
  assert.match(html, /data-project-import-dropzone/);
  assert.match(html, /Drop files here or click to open the file selector\./);
  assert.match(html, /Select files/);
  assert.match(html, /Supported formats: \.xlsx, \.txt, \.docx, \.html, or \.htm\./);
});

test("project import modal renders paste link input state", () => {
  const html = renderProjectImportModal({
    projectImport: {
      isOpen: true,
      projectTitle: "Translation Project",
      inputMode: "pasteLink",
      linkUrl: "",
      status: "idle",
      error: "",
    },
  });

  assert.match(html, /class="segmented-control__button is-active"[\s\S]*data-action="select-project-import-input-mode:pasteLink"/);
  assert.match(html, /data-project-import-link-input/);
  assert.match(html, /Paste link here\. Supports Google Docs, Google Sheets, HTML web pages, and local file paths\./);
  assert.match(html, /Continue/);
  assert.match(html, /data-action="submit-project-import-link" disabled/);
  assert.doesNotMatch(html, /data-project-import-dropzone/);
  assert.doesNotMatch(html, /Select files/);
});

test("project import modal enables paste link continue after a link is entered", () => {
  const html = renderProjectImportModal({
    projectImport: {
      isOpen: true,
      projectTitle: "Translation Project",
      inputMode: "pasteLink",
      linkUrl: "https://example.com/article",
      status: "idle",
      error: "",
    },
  });

  assert.match(html, /value="https:\/\/example\.com\/article"/);
  assert.match(html, /data-action="submit-project-import-link">Continue<\/button>/);
  assert.doesNotMatch(html, /data-action="submit-project-import-link" disabled/);
});

test("project import modal disables paste link controls while resolving", () => {
  const html = renderProjectImportModal({
    projectImport: {
      isOpen: true,
      projectTitle: "Translation Project",
      inputMode: "pasteLink",
      linkUrl: "https://example.com/article",
      status: "resolvingLink",
      error: "",
    },
  });

  assert.match(html, /data-project-import-link-input[\s\S]*disabled/);
  assert.match(html, /data-action="submit-project-import-link" disabled[\s\S]*Opening\.\.\.<\/button>/);
  assert.match(html, /data-action="cancel-project-import"[\s\S]*disabled/);
});

test("project import modal renders Google access denied link error", () => {
  const html = renderProjectImportModal({
    projectImport: {
      isOpen: true,
      linkErrorModal: "accessDenied",
    },
  });

  assert.match(html, /FILE NOT SHARED PUBLICLY/);
  assert.match(html, /Please share this file with everyone/);
  assert.match(html, /Anyone with the link/);
  assert.match(html, /data-action="close-project-import-link-error"[\s\S]*Cancel/);
  assert.match(html, /data-action="retry-project-import-link"[\s\S]*Retry/);
});

test("project import modal renders invalid link error", () => {
  const html = renderProjectImportModal({
    projectImport: {
      isOpen: true,
      linkErrorModal: "invalid",
    },
  });

  assert.match(html, /INVALID LINK/);
  assert.match(html, /This link can not be opened/);
  assert.match(html, /only Google Docs, Google Sheets, HTML website links, and local file paths are supported/);
  assert.match(html, /data-action="close-project-import-link-error"[\s\S]*Cancel/);
});

test("project import modal renders paste text input state", () => {
  const html = renderProjectImportModal({
    projectImport: {
      isOpen: true,
      projectTitle: "Translation Project",
      inputMode: "pasteText",
      pastedText: "",
      status: "idle",
      error: "",
    },
  });

  assert.match(html, /class="segmented-control__button is-active"[\s\S]*data-action="select-project-import-input-mode:pasteText"/);
  assert.match(html, /class="field__textarea"/);
  assert.match(html, /data-project-import-paste-textarea/);
  assert.match(html, /placeholder="Paste text here\."/);
  assert.match(html, /Paste plain text here\. You will choose its source language before importing\./);
  assert.match(html, /Continue/);
  assert.match(html, /data-action="submit-project-import-pasted-text" disabled/);
  assert.doesNotMatch(html, /data-project-import-dropzone/);
  assert.doesNotMatch(html, /Select files/);
});

test("project import modal enables paste text continue after text is pasted", () => {
  const html = renderProjectImportModal({
    projectImport: {
      isOpen: true,
      projectTitle: "Translation Project",
      inputMode: "pasteText",
      pastedText: "Line one\nLine two",
      status: "idle",
      error: "",
    },
  });

  assert.match(html, />Line one\nLine two<\/textarea>/);
  assert.match(html, /data-action="submit-project-import-pasted-text">Continue<\/button>/);
  assert.doesNotMatch(html, /data-action="submit-project-import-pasted-text" disabled/);
});

test("project import modal disables paste text controls while importing", () => {
  const html = renderProjectImportModal({
    projectImport: {
      isOpen: true,
      projectTitle: "Translation Project",
      inputMode: "pasteText",
      pastedText: "Line one",
      status: "importing",
      error: "",
    },
  });

  assert.match(html, /data-project-import-paste-textarea[\s\S]*disabled/);
  assert.match(html, /data-action="submit-project-import-pasted-text" disabled[\s\S]*Importing\.\.\.<\/button>/);
});

test("project import modal renders upload progress step while importing upload files", () => {
  const html = renderProjectImportModal({
    projectImport: {
      isOpen: true,
      projectTitle: "Translation Project",
      inputMode: "upload",
      status: "importing",
      uploadProgress: {
        current: 2,
        total: 5,
      },
      error: "",
    },
  });

  assert.match(html, /<p class="card__eyebrow">Uploading<\/p>/);
  assert.match(html, /Importing files to Translation Project/);
  assert.match(html, /Importing 2 of 5/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuemax="5"/);
  assert.match(html, /aria-valuenow="2"/);
  assert.match(html, /style="width: 40%;"/);
  assert.match(html, /data-action="cancel-project-import">Cancel<\/button>/);
  assert.doesNotMatch(html, /data-project-import-dropzone/);
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
  assert.match(html, /class="language-picker-modal__list-frame"[\s\S]*data-project-import-source-language-list/);
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
