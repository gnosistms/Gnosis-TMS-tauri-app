import test from "node:test";
import assert from "node:assert/strict";

globalThis.document = {
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
  },
};

globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async () => null,
    },
    dialog: {
      save: async () => null,
    },
  },
  __TAURI_INTERNALS__: null,
  open() {},
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame(callback) {
    callback?.();
    return 1;
  },
  setTimeout() {
    return 1;
  },
  clearTimeout() {},
};

const originalClipboardItem = globalThis.ClipboardItem;
const originalNavigator = globalThis.navigator;

const {
  createEditorChapterState,
  createEditorExportModalState,
  createStatusBadgesState,
  resetSessionState,
  state,
} = await import("./state.js");
const { EDITOR_MODE_PREVIEW } = await import("./editor-preview.js");
const { updateEditorPreviewLanguage } = await import("./editor-preview-flow.js");
const {
  EDITOR_EXPORT_CATEGORIES,
  closeEditorExportOptions,
  findEditorExportOption,
  openEditorExportOptions,
  selectEditorExportOption,
  submitEditorExport,
  toggleEditorExportCategory,
  writeClipboardFormats,
} = await import("./editor-export-flow.js");

class TestClipboardItem {
  constructor(items) {
    this.items = items;
  }
}

function installNavigator(clipboard) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard },
  });
}

function installEditorExportFixture(editorChapterOverrides = {}) {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.teams = [{
    id: "team-1",
    installationId: 42,
  }];
  state.projects = [{
    id: "project-1",
    title: "Project",
    name: "project-repo",
    fullName: "org/project-repo",
    chapters: [{
      id: "chapter-1",
      name: "Chapter One",
      status: "active",
      languages: [
        { code: "es", name: "Spanish", role: "source" },
        { code: "vi", name: "Vietnamese", role: "target" },
      ],
    }],
  }];
  state.deletedProjects = [];
  state.statusBadges = createStatusBadgesState();
  state.editorChapter = {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    projectId: "project-1",
    fileTitle: "Chapter One",
    mode: EDITOR_MODE_PREVIEW,
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "vi", name: "Vietnamese", role: "target" },
    ],
    selectedSourceLanguageCode: "es",
    selectedTargetLanguageCode: "vi",
    rows: [{
      rowId: "row-1",
      lifecycleState: "active",
      textStyle: "paragraph",
      fields: { vi: "Text one[1]", es: "Texto uno" },
      footnotes: { vi: "footnote 1" },
    }],
    ...editorChapterOverrides,
  };
}

function openExportModal(optionId) {
  openEditorExportOptions(() => {});
  if (optionId) {
    state.editorChapter = {
      ...state.editorChapter,
      exportModal: {
        ...state.editorChapter.exportModal,
        selectedOptionId: optionId,
      },
    };
  }
}

test.afterEach(() => {
  resetSessionState();
  globalThis.ClipboardItem = originalClipboardItem;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  });
});

test("the export catalog covers the three categories with stable option ids", () => {
  assert.deepEqual(EDITOR_EXPORT_CATEGORIES.map((category) => category.id), ["file", "copy", "link"]);
  for (const category of EDITOR_EXPORT_CATEGORIES) {
    for (const option of category.options) {
      assert.equal(option.id, `${category.id}:${option.format}`);
      assert.equal(findEditorExportOption(option.id), option);
    }
  }
  assert.equal(findEditorExportOption("file:unknown"), null);
});

test("openEditorExportOptions opens the modal with the default selection", () => {
  installEditorExportFixture();
  let renderCount = 0;

  openEditorExportOptions(() => {
    renderCount += 1;
  });

  assert.equal(renderCount, 1);
  assert.equal(state.editorChapter.exportModal.isOpen, true);
  assert.equal(state.editorChapter.exportModal.selectedOptionId, "file:html");
  assert.deepEqual(state.editorChapter.exportModal.expandedCategoryIds, ["file"]);
});

test("openEditorExportOptions does nothing without an open chapter", () => {
  resetSessionState();
  state.editorChapter = createEditorChapterState();
  let renderCount = 0;

  openEditorExportOptions(() => {
    renderCount += 1;
  });

  assert.equal(renderCount, 0);
  assert.equal(state.editorChapter.exportModal.isOpen, false);
});

test("toggleEditorExportCategory expands and collapses categories", () => {
  installEditorExportFixture();
  openExportModal();

  toggleEditorExportCategory(() => {}, "copy");
  assert.deepEqual(state.editorChapter.exportModal.expandedCategoryIds, ["file", "copy"]);

  toggleEditorExportCategory(() => {}, "file");
  assert.deepEqual(state.editorChapter.exportModal.expandedCategoryIds, ["copy"]);

  toggleEditorExportCategory(() => {}, "not-a-category");
  assert.deepEqual(state.editorChapter.exportModal.expandedCategoryIds, ["copy"]);
});

test("selectEditorExportOption switches the selected option and clears errors", () => {
  installEditorExportFixture();
  openExportModal();
  state.editorChapter.exportModal.error = "old error";

  selectEditorExportOption(() => {}, "copy:text");
  assert.equal(state.editorChapter.exportModal.selectedOptionId, "copy:text");
  assert.equal(state.editorChapter.exportModal.error, "");

  selectEditorExportOption(() => {}, "copy:bogus");
  assert.equal(state.editorChapter.exportModal.selectedOptionId, "copy:text");
});

test("closeEditorExportOptions closes the modal but keeps the selection for reopening", () => {
  installEditorExportFixture();
  openExportModal("copy:html");

  closeEditorExportOptions(() => {});
  assert.equal(state.editorChapter.exportModal.isOpen, false);

  openEditorExportOptions(() => {});
  assert.equal(state.editorChapter.exportModal.isOpen, true);
  assert.equal(state.editorChapter.exportModal.selectedOptionId, "copy:html");
});

test("writeClipboardFormats writes every flavor through rich clipboard writes", async () => {
  const writes = [];
  installNavigator({
    async write(items) {
      writes.push(items);
    },
  });
  globalThis.ClipboardItem = TestClipboardItem;

  await writeClipboardFormats({
    "text/html": "<p>Text one</p>",
    "text/plain": "Text one",
  });

  assert.equal(writes.length, 1);
  const clipboardItem = writes[0][0];
  assert.deepEqual(Object.keys(clipboardItem.items).sort(), ["text/html", "text/plain"]);
  assert.equal(await clipboardItem.items["text/html"].text(), "<p>Text one</p>");
  assert.equal(await clipboardItem.items["text/plain"].text(), "Text one");
});

test("writeClipboardFormats falls back to writeText with the plain flavor", async () => {
  const writes = [];
  installNavigator({
    async writeText(text) {
      writes.push(text);
    },
  });
  globalThis.ClipboardItem = undefined;

  await writeClipboardFormats({
    "text/html": "<p>Fallback</p>",
    "text/plain": "Fallback",
  });

  assert.deepEqual(writes, ["Fallback"]);
});

test("submitEditorExport copy HTML publishes WordPress block markup and plain text, then closes", async () => {
  installEditorExportFixture();
  const writes = [];
  installNavigator({
    async write(items) {
      writes.push(items);
    },
  });
  globalThis.ClipboardItem = TestClipboardItem;
  openExportModal("copy:html");

  await submitEditorExport(() => {});

  assert.equal(writes.length, 1);
  const html = await writes[0][0].items["text/html"].text();
  assert.match(html, /^<meta charset='utf-8'>/);
  assert.match(html, /<!-- wp:paragraph -->/);
  assert.match(html, /<p>Text one<sup/);
  assert.match(html, /<sup data-fn="[0-9a-f-]{36}" class="fn"><a id="[0-9a-f-]{36}-link" href="#[0-9a-f-]{36}">1<\/a><\/sup>/);
  assert.match(html, /<!-- wp:footnotes \/-->/);
  assert.doesNotMatch(html, /<ol class="wp-block-footnotes">/);
  const plain = await writes[0][0].items["text/plain"].text();
  assert.equal(plain, "Text one[1]\n\n[1] footnote 1");
  assert.equal(state.editorChapter.exportModal.isOpen, false);
});

test("submitEditorExport copy plain text publishes only the plain flavor", async () => {
  installEditorExportFixture();
  const writes = [];
  installNavigator({
    async write(items) {
      writes.push(items);
    },
  });
  globalThis.ClipboardItem = TestClipboardItem;
  openExportModal("copy:text");

  await submitEditorExport(() => {});

  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0][0].items), ["text/plain"]);
  assert.equal(await writes[0][0].items["text/plain"].text(), "Text one[1]\n\n[1] footnote 1");
});

test("copy exports follow the preview language without changing editor selections", async () => {
  installEditorExportFixture();
  const writes = [];
  installNavigator({
    async write(items) {
      writes.push(items);
    },
  });
  globalThis.ClipboardItem = TestClipboardItem;

  updateEditorPreviewLanguage(() => {}, "es");
  openExportModal("copy:html");
  await submitEditorExport(() => {});

  assert.equal(state.editorChapter.previewLanguageCode, "es");
  assert.equal(state.editorChapter.selectedSourceLanguageCode, "es");
  assert.equal(state.editorChapter.selectedTargetLanguageCode, "vi");
  const html = await writes.at(-1)[0].items["text/html"].text();
  assert.match(html, /Texto uno/);
  assert.doesNotMatch(html, /Text one/);
});

test("submitEditorExport saves a file through the native dialog and export command", async () => {
  installEditorExportFixture();
  openExportModal("file:html");
  const saveDialogCalls = [];
  const invokeCalls = [];
  const repoQueueWaits = [];

  await submitEditorExport(() => {}, {
    saveDialog: async (options) => {
      saveDialogCalls.push(options);
      return "/tmp/chapter-one.html";
    },
    invoke: async (command, payload) => {
      invokeCalls.push({ command, payload });
      return null;
    },
    waitForRepoQueue: async (scope) => {
      repoQueueWaits.push(scope);
    },
  });

  assert.equal(saveDialogCalls.length, 1);
  assert.equal(saveDialogCalls[0].defaultPath, "Chapter One-vi.html");
  assert.deepEqual(saveDialogCalls[0].filters, [{ name: "HTML document", extensions: ["html"] }]);
  assert.equal(repoQueueWaits.length, 1);
  assert.equal(invokeCalls.length, 1);
  assert.equal(invokeCalls[0].command, "export_gtms_chapter_file");
  assert.deepEqual(invokeCalls[0].payload, {
    input: {
      installationId: 42,
      repoName: "project-repo",
      projectId: "project-1",
      projectFullName: "org/project-repo",
      chapterId: "chapter-1",
      languageCode: "vi",
      format: "html",
      outputPath: "/tmp/chapter-one.html",
    },
  });
  assert.equal(state.editorChapter.exportModal.isOpen, false);
});

test("submitEditorExport keeps the modal open with an error when the command fails", async () => {
  installEditorExportFixture();
  openExportModal("file:docx");

  await submitEditorExport(() => {}, {
    saveDialog: async () => "/tmp/chapter-one.docx",
    invoke: async () => {
      throw new Error("export failed");
    },
    waitForRepoQueue: async () => {},
  });

  assert.equal(state.editorChapter.exportModal.isOpen, true);
  assert.equal(state.editorChapter.exportModal.status, "idle");
  assert.match(state.editorChapter.exportModal.error, /export failed/);
});

test("submitEditorExport does nothing when the file dialog is cancelled", async () => {
  installEditorExportFixture();
  openExportModal("file:txt");
  const invokeCalls = [];

  await submitEditorExport(() => {}, {
    saveDialog: async () => null,
    invoke: async (command) => {
      invokeCalls.push(command);
    },
    waitForRepoQueue: async () => {},
  });

  assert.equal(invokeCalls.length, 0);
  assert.equal(state.editorChapter.exportModal.isOpen, true);
  assert.equal(state.editorChapter.exportModal.error, "");
});

test("submitEditorExport exports the Phase 2 file formats with matching filters", async () => {
  installEditorExportFixture();
  const expected = [
    { optionId: "file:xlsx", format: "xlsx", filter: { name: "XLSX workbook", extensions: ["xlsx"] } },
    { optionId: "file:rtf", format: "rtf", filter: { name: "RTF document", extensions: ["rtf"] } },
    { optionId: "file:md", format: "md", filter: { name: "Markdown document", extensions: ["md"] } },
  ];

  for (const { optionId, format, filter } of expected) {
    openExportModal(optionId);
    const saveDialogCalls = [];
    const invokeCalls = [];

    await submitEditorExport(() => {}, {
      saveDialog: async (options) => {
        saveDialogCalls.push(options);
        return `/tmp/chapter-one.${format}`;
      },
      invoke: async (command, payload) => {
        invokeCalls.push({ command, payload });
        return null;
      },
      waitForRepoQueue: async () => {},
    });

    assert.equal(saveDialogCalls.length, 1);
    assert.equal(saveDialogCalls[0].defaultPath, `Chapter One-vi.${format}`);
    assert.deepEqual(saveDialogCalls[0].filters, [filter]);
    assert.equal(invokeCalls.length, 1);
    assert.equal(invokeCalls[0].payload.input.format, format);
    assert.equal(state.editorChapter.exportModal.isOpen, false);
  }
});

test("submitEditorExport ignores options that are not available yet", async () => {
  installEditorExportFixture();
  const invokeCalls = [];
  for (const optionId of ["copy:docx"]) {
    openExportModal(optionId);

    await submitEditorExport(() => {}, {
      saveDialog: async () => "/tmp/never.bin",
      invoke: async (command) => {
        invokeCalls.push(command);
      },
      waitForRepoQueue: async () => {},
    });

    assert.equal(state.editorChapter.exportModal.isOpen, true);
  }

  assert.equal(invokeCalls.length, 0);
  assert.equal(createEditorExportModalState().selectedOptionId, "file:html");
});
