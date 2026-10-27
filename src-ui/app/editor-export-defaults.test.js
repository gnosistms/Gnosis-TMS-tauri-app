import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = globalThis.window ?? {};

const { setActiveStorageLogin, clearActiveStorageLogin } = await import("./team-storage.js");
const {
  clearStoredWordPressAssociationsForSite,
  findStoredWordPressDestination,
  lastStoredWordPressDestination,
  loadStoredEditorExportDefault,
  loadStoredEditorExportPaperSize,
  saveStoredEditorExportDefault,
  saveStoredEditorExportPaperSize,
  upsertStoredWordPressDestination,
} = await import("./editor-export-defaults.js");

test("WordPress associations can be unlinked across one site", () => {
  setActiveStorageLogin("association-unlink-test");
  for (const [chapterId, siteId] of [["chapter-1", "wpcom:1"], ["chapter-2", "wpcom:1"], ["chapter-3", "wpcom:2"]]) {
    saveStoredEditorExportDefault(chapterId, {
      optionId: "link:wordpress",
      wordpress: { siteId, siteKind: "wordpressCom", siteUrl: `https://${siteId}.example`, postId: 7, postTitle: "Post" },
    });
  }
  clearStoredWordPressAssociationsForSite("wpcom:1");
  assert.deepEqual(loadStoredEditorExportDefault("chapter-1"), { optionId: "link:wordpress" });
  assert.deepEqual(loadStoredEditorExportDefault("chapter-2"), { optionId: "link:wordpress" });
  assert.equal(loadStoredEditorExportDefault("chapter-3").wordpress.lastSiteId, "wpcom:2");
});

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
    wordpress: {
      destinations: [],
      legacyDestination: { postId: 24994, postTitle: "Chương 3" },
    },
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
    wordpress: {
      destinations: [],
      legacyDestination: { postId: 24994, postTitle: "Chương 3" },
    },
  });
});

test("WordPress destinations round-trip per site and upserts preserve other sites", () => {
  setActiveStorageLogin("tester");
  upsertStoredWordPressDestination("chapter-1", {
    siteId: "wpcom:1", siteKind: "wordpressCom", siteUrl: "https://one.example",
    postId: 7, postTitle: "One",
  });
  upsertStoredWordPressDestination("chapter-1", {
    siteId: "wpcom:2", siteKind: "wordpressCom", siteUrl: "https://two.example",
    postId: 8, postTitle: "Two",
  });

  const stored = loadStoredEditorExportDefault("chapter-1");
  assert.equal(stored.wordpress.lastSiteId, "wpcom:2");
  assert.equal(findStoredWordPressDestination(stored.wordpress, "wpcom:1").postId, 7);
  assert.equal(findStoredWordPressDestination(stored.wordpress, "wpcom:2").postId, 8);
  assert.equal(lastStoredWordPressDestination(stored.wordpress).postTitle, "Two");

  upsertStoredWordPressDestination("chapter-1", {
    siteId: "wpcom:1", siteKind: "wordpressCom", siteUrl: "https://one.example",
    postId: 9, postTitle: "One updated",
  });
  const updated = loadStoredEditorExportDefault("chapter-1");
  assert.equal(updated.wordpress.lastSiteId, "wpcom:1");
  assert.equal(updated.wordpress.destinations.length, 2);
  assert.equal(findStoredWordPressDestination(updated.wordpress, "wpcom:1").postId, 9);
  assert.equal(findStoredWordPressDestination(updated.wordpress, "wpcom:2").postId, 8);
});

test("forgetting one site preserves other site destinations and clears a forgotten default", () => {
  setActiveStorageLogin("tester");
  for (const destination of [
    { siteId: "wpcom:1", siteKind: "wordpressCom", siteUrl: "https://one.example", postId: 7, postTitle: "One" },
    { siteId: "wpcom:2", siteKind: "wordpressCom", siteUrl: "https://two.example", postId: 8, postTitle: "Two" },
  ]) upsertStoredWordPressDestination("chapter-1", destination);

  clearStoredWordPressAssociationsForSite("wpcom:2");
  const stored = loadStoredEditorExportDefault("chapter-1");
  assert.equal(stored.wordpress.lastSiteId, undefined);
  assert.equal(findStoredWordPressDestination(stored.wordpress, "wpcom:1").postId, 7);
  assert.equal(findStoredWordPressDestination(stored.wordpress, "wpcom:2"), null);
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
