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
