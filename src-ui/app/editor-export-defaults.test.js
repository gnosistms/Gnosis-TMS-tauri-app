import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = globalThis.window ?? {};

const { setActiveStorageLogin, clearActiveStorageLogin } = await import("./team-storage.js");
const {
  loadStoredEditorExportDefault,
  saveStoredEditorExportDefault,
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
