import test from "node:test";
import assert from "node:assert/strict";

import { renderGlossaryImportModal } from "./glossary-import-modal.js";

test("glossary import modal renders the shared drop target copy", () => {
  const html = renderGlossaryImportModal({
    glossaryImport: {
      isOpen: true,
      status: "idle",
      error: "",
    },
  });

  assert.match(html, /data-glossary-import-dropzone/);
  assert.match(html, /Drop a file here or click to open a file selector\./);
  assert.match(html, /Supported format: \.tmx\./);
});

test("glossary import modal renders centered importing copy without a drop target spinner", () => {
  const html = renderGlossaryImportModal({
    glossaryImport: {
      isOpen: true,
      status: "importing",
      error: "",
    },
  });

  assert.match(html, /Importing glossary; please wait\./);
  assert.doesNotMatch(html, /button__spinner/);
});

test("glossary import modal renders validation errors above the drop target", () => {
  const html = renderGlossaryImportModal({
    glossaryImport: {
      isOpen: true,
      status: "error",
      error: "Unsupported file type for notes.txt.",
    },
  });

  assert.match(html, /project-import-modal__error-badge/);
  assert.match(html, /Unsupported file type for notes\.txt\./);
  assert.ok(
    html.indexOf("project-import-modal__error-badge")
      < html.indexOf("data-glossary-import-dropzone"),
  );
});
