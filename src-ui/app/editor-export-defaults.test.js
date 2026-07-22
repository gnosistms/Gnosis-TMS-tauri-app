import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = globalThis.window ?? {};

const { setActiveStorageLogin, clearActiveStorageLogin } = await import("./team-storage.js");
const {
  loadStoredEditorExportDefault,
  loadStoredEditorExportPaperSize,
  saveStoredEditorExportDefault,
  saveStoredEditorExportPaperSize,
} = await import("./editor-export-defaults.js");

test.afterEach(() => {
  clearActiveStorageLogin();
});

test("export defaults round-trip per chapter and login", () => {
  setActiveStorageLogin("Tester");

  saveStoredEditorExportDefault("chapter-1", { optionId: "file:docx" });
  saveStoredEditorExportDefault("chapter-2", {
    optionId: "link:wordpress",
    wordpress: { postId: 24994, postTitle: "Chương 3" },
  });

  assert.deepEqual(loadStoredEditorExportDefault("chapter-1"), { optionId: "file:docx" });
  assert.deepEqual(loadStoredEditorExportDefault("chapter-2"), {
    optionId: "link:wordpress",
    wordpress: { postId: 24994, postTitle: "Chương 3" },
  });
  assert.equal(loadStoredEditorExportDefault("chapter-3"), null);

  // Another login sees its own (empty) map.
  setActiveStorageLogin("other");
  assert.equal(loadStoredEditorExportDefault("chapter-1"), null);
});

test("export defaults preserve remembered wordpress post across other export options", () => {
  setActiveStorageLogin("tester");

  saveStoredEditorExportDefault("chapter-1", {
    optionId: "link:wordpress",
    wordpress: { postId: 24994, postTitle: "Chương 3" },
  });
  saveStoredEditorExportDefault("chapter-1", { optionId: "copy:vellum" });

  assert.deepEqual(loadStoredEditorExportDefault("chapter-1"), {
    optionId: "copy:vellum",
    wordpress: { postId: 24994, postTitle: "Chương 3" },
  });
});

test("export defaults drop invalid wordpress entries and blank options", () => {
  setActiveStorageLogin("tester");

  saveStoredEditorExportDefault("chapter-1", {
    optionId: "link:wordpress",
    wordpress: { postId: "not-a-number", postTitle: "ignored" },
  });
  assert.deepEqual(loadStoredEditorExportDefault("chapter-1"), { optionId: "link:wordpress" });

  saveStoredEditorExportDefault("chapter-1", { optionId: "  " });
  assert.equal(loadStoredEditorExportDefault("chapter-1"), null);

  saveStoredEditorExportDefault("", { optionId: "file:html" });
  assert.equal(loadStoredEditorExportDefault(""), null);
});

test("PDF paper size preference round-trips per login and can be cleared", () => {
  saveStoredEditorExportPaperSize("a5", "Tester");

  assert.equal(loadStoredEditorExportPaperSize("tester"), "a5");
  assert.equal(loadStoredEditorExportPaperSize("other"), null);

  saveStoredEditorExportPaperSize(null, "tester");
  assert.equal(loadStoredEditorExportPaperSize("tester"), null);
});
