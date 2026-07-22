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
const { clearActiveStorageLogin, setActiveStorageLogin } = await import("./team-storage.js");
const { saveStoredEditorExportPaperSize } = await import("./editor-export-defaults.js");
const {
  closeEditorExportOptions,
  editorExportCategories,
  findEditorExportOption,
  handleChapterPdfExportProgress,
  openEditorExportOptions,
  refreshPdfFontInspection,
  selectEditorExportPaperSize,
  selectEditorExportOption,
  submitEditorExport,
  toggleEditorExportCategory,
  toggleEditorExportFootnoteLinks,
  writeClipboardFormats,
} = await import("./editor-export-flow.js");

class TestClipboardItem {
  constructor(items) {
    this.items = items;
  }
}

function installNavigator(options = {}) {
  const hasNavigatorOptions = Object.hasOwn(options, "platform") || Object.hasOwn(options, "clipboard");
  const clipboard = hasNavigatorOptions ? options.clipboard : options;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      platform: options.platform ?? "MacIntel",
      clipboard,
    },
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
  saveStoredEditorExportPaperSize(null, "paper-size-tester");
  clearActiveStorageLogin();
  resetSessionState();
  globalThis.ClipboardItem = originalClipboardItem;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  });
});

test("the export catalog covers the three categories with stable option ids", () => {
  installNavigator({ platform: "MacIntel" });
  const categories = editorExportCategories();
  assert.deepEqual(categories.map((category) => category.id), ["file", "copy", "link"]);
  assert.ok(categories.find((category) => category.id === "copy")?.options.some((option) => option.id === "copy:vellum"));
  for (const category of categories) {
    for (const option of category.options) {
      assert.equal(option.id, `${category.id}:${option.format}`);
      assert.equal(findEditorExportOption(option.id), option);
    }
  }
  assert.equal(findEditorExportOption("file:unknown"), null);
});

test("the Vellum export option is hidden outside macOS", () => {
  installNavigator({ platform: "Win32" });

  assert.equal(findEditorExportOption("copy:vellum"), null);
  assert.equal(
    editorExportCategories().find((category) => category.id === "copy")
      ?.options.some((option) => option.id === "copy:vellum"),
    false,
  );
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
  assert.equal(state.editorChapter.exportModal.pdfPaperSize, "a4");
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
  assert.equal(state.editorChapter.exportModal.selectedOptionId, "copy:text");

  toggleEditorExportCategory(() => {}, "file");
  assert.deepEqual(state.editorChapter.exportModal.expandedCategoryIds, ["copy"]);
  assert.equal(state.editorChapter.exportModal.selectedOptionId, "copy:text");

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

test("submitEditorExport copy Vellum uses the native Vellum writer with fallbacks", async () => {
  installNavigator({ platform: "MacIntel" });
  installEditorExportFixture({
    rows: [{
      rowId: "row-1",
      lifecycleState: "active",
      textStyle: "heading1",
      fields: { vi: "Heading <strong>bold</strong>", es: "Titulo" },
      footnotes: {},
    }],
  });
  const vellumCalls = [];
  openExportModal("copy:vellum");

  await submitEditorExport(() => {}, {
    copyVellumTextEditorContent: async (input) => {
      vellumCalls.push(input);
    },
  });

  assert.equal(vellumCalls.length, 1);
  assert.match(vellumCalls[0].decodedPropertyListXml, /OGImagePreservingArchiver/);
  assert.match(vellumCalls[0].decodedPropertyListXml, /NSMutableAttributedString/);
  assert.match(vellumCalls[0].decodedPropertyListXml, /OGSubheadAttachmentCell/);
  assert.match(vellumCalls[0].decodedPropertyListXml, /<string>Heading bold<\/string>/);
  assert.match(vellumCalls[0].decodedPropertyListXml, /OGBoldText/);
  assert.match(vellumCalls[0].ogElementPrivateDecodedPropertyListXml, /OGTypedTextElement/);
  assert.match(vellumCalls[0].ogElementPrivateDecodedPropertyListXml, /<string>Heading bold<\/string>/);
  assert.doesNotMatch(vellumCalls[0].ogElementPrivateDecodedPropertyListXml, /OGSubheadAttachmentCell/);
  assert.doesNotMatch(vellumCalls[0].ogElementPrivateDecodedPropertyListXml, /NSMutableAttributedString/);
  assert.equal(vellumCalls[0].plainText, "Heading bold");
  assert.match(vellumCalls[0].html, /<!-- wp:heading/);
  assert.equal(state.editorChapter.exportModal.isOpen, false);
});

test("submitEditorExport copy Vellum prepares image resources before building the archive", async () => {
  installNavigator({ platform: "MacIntel" });
  installEditorExportFixture({
    rows: [{
      rowId: "row-image",
      lifecycleState: "active",
      textStyle: "paragraph",
      fields: { vi: "", es: "" },
      footnotes: {},
      imageCaptions: { vi: "Image caption" },
      images: {
        vi: {
          kind: "url",
          url: "https://example.com/images/Diogenes.webp",
        },
      },
    }],
  });
  const prepareCalls = [];
  const vellumCalls = [];
  openExportModal("copy:vellum");

  await submitEditorExport(() => {}, {
    prepareVellumImageResources: async (input) => {
      prepareCalls.push(input);
      return [{
        index: 1,
        fileName: "Diogenes.webp",
        imageKey: "diogenes",
        preservedUrl: "file:///tmp/co.180g.Vellum/preserved-images.abc123/Diogenes.webp",
        lastAbsolutePath: "/tmp/co.180g.Vellum/vellum-process-attachment.def456/Diogenes.webp",
        uti: "org.webmproject.webp",
        tooltip: "Diogenes.webp\n3840 × 2920 px",
        pixelWidth: 3840,
        pixelHeight: 2920,
        colorSpace: "sRGB",
        colorSpaceModel: "RGB",
        hasAlpha: false,
        canUpsize: false,
      }];
    },
    copyVellumTextEditorContent: async (input) => {
      vellumCalls.push(input);
    },
  });

  assert.deepEqual(prepareCalls, [{
    images: [{
      index: 1,
      source: "https://example.com/images/Diogenes.webp",
      fileName: "Diogenes.webp",
      uti: "org.webmproject.webp",
    }],
  }]);
  assert.equal(vellumCalls.length, 1);
  assert.match(vellumCalls[0].decodedPropertyListXml, /file:\/\/\/tmp\/co\.180g\.Vellum\/preserved-images\.abc123\/Diogenes\.webp/);
  assert.match(vellumCalls[0].decodedPropertyListXml, /\/tmp\/co\.180g\.Vellum\/vellum-process-attachment\.def456\/Diogenes\.webp/);
  assert.doesNotMatch(vellumCalls[0].decodedPropertyListXml, /https:\/\/example\.com\/images\/Diogenes\.webp/);
  assert.match(vellumCalls[0].ogElementPrivateDecodedPropertyListXml, /file:\/\/\/tmp\/co\.180g\.Vellum\/preserved-images\.abc123\/Diogenes\.webp/);
  assert.match(vellumCalls[0].ogElementPrivateDecodedPropertyListXml, /\/tmp\/co\.180g\.Vellum\/vellum-process-attachment\.def456\/Diogenes\.webp/);
  assert.doesNotMatch(vellumCalls[0].ogElementPrivateDecodedPropertyListXml, /https:\/\/example\.com\/images\/Diogenes\.webp/);
  assert.equal(vellumCalls[0].plainText, "Image caption");
  assert.equal(state.editorChapter.exportModal.isOpen, false);
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
      footnoteLinksAsPlainText: false,
      omitCustomHtml: false,
    },
  });
  assert.equal(state.editorChapter.exportModal.isOpen, false);
});

test("submitEditorExport forwards the footnote-link-as-plain-text option for DOCX", async () => {
  installEditorExportFixture();
  openExportModal("file:docx");
  toggleEditorExportFootnoteLinks(() => {}, true);
  const invokeCalls = [];

  await submitEditorExport(() => {}, {
    saveDialog: async () => "/tmp/chapter-one.docx",
    invoke: async (command, payload) => {
      invokeCalls.push({ command, payload });
      return null;
    },
    waitForRepoQueue: async () => {},
  });

  assert.equal(invokeCalls.length, 1);
  assert.equal(invokeCalls[0].payload.input.format, "docx");
  assert.equal(invokeCalls[0].payload.input.footnoteLinksAsPlainText, true);
});

test("PDF export starts a background job and closes only after its completion event", async () => {
  installEditorExportFixture();
  openExportModal("file:pdf");
  const invokeCalls = [];
  let renders = 0;
  selectEditorExportPaperSize(() => { renders += 1; }, "a4");

  await submitEditorExport(() => { renders += 1; }, {
    saveDialog: async (options) => {
      assert.deepEqual(options.filters, [{ name: "PDF document", extensions: ["pdf"] }]);
      return "/tmp/chapter-one.pdf";
    },
    invoke: async (command, payload) => {
      invokeCalls.push({ command, payload });
      if (command === "inspect_gtms_chapter_pdf_fonts") {
        return {
          supported: true,
          requiredBytes: 4_335_688,
          missingBytes: 4_335_688,
          installed: false,
          fontFamilies: ["Noto Serif"],
        };
      }
      return payload.input.jobId;
    },
    waitForRepoQueue: async () => {},
  });

  assert.equal(invokeCalls[0].command, "inspect_gtms_chapter_pdf_fonts");
  assert.equal(invokeCalls[1].command, "start_gtms_chapter_pdf_export");
  assert.equal(invokeCalls[1].payload.input.format, "pdf");
  assert.equal(invokeCalls[1].payload.input.paperSize, "a4");
  assert.ok(invokeCalls[1].payload.input.jobId);
  assert.equal(state.editorChapter.exportModal.isOpen, true);
  assert.equal(state.editorChapter.exportModal.status, "exporting");

  handleChapterPdfExportProgress({
    jobId: invokeCalls[1].payload.input.jobId,
    status: "complete",
    message: "PDF export complete.",
  }, () => { renders += 1; });

  assert.equal(state.editorChapter.exportModal.isOpen, false);
  assert.equal(state.editorChapter.exportModal.status, "idle");
  assert.ok(renders >= 2);
});

test("PDF paper-size selection rejects values outside the export catalog", () => {
  installEditorExportFixture();
  openExportModal("file:pdf");

  selectEditorExportPaperSize(() => {}, "a5");
  assert.equal(state.editorChapter.exportModal.pdfPaperSize, "a5");

  selectEditorExportPaperSize(() => {}, "arbitrary-typst-source");
  assert.equal(state.editorChapter.exportModal.pdfPaperSize, "a5");
  assert.equal(createEditorExportModalState().pdfPaperSize, "a4");
});

test("PDF paper-size selection is remembered across fresh export modal sessions", () => {
  installEditorExportFixture();
  setActiveStorageLogin("paper-size-tester");
  openExportModal("file:pdf");

  assert.equal(state.editorChapter.exportModal.pdfPaperSize, "a4");
  selectEditorExportPaperSize(() => {}, "us-legal");
  assert.equal(state.editorChapter.exportModal.pdfPaperSize, "us-legal");

  installEditorExportFixture();
  setActiveStorageLogin("paper-size-tester");
  openExportModal("file:pdf");
  assert.equal(state.editorChapter.exportModal.pdfPaperSize, "us-legal");
});

test("an invalid stored PDF paper size falls back to A4", () => {
  saveStoredEditorExportPaperSize("not-a-paper-size", "paper-size-tester");
  installEditorExportFixture();
  setActiveStorageLogin("paper-size-tester");

  openExportModal("file:pdf");
  assert.equal(state.editorChapter.exportModal.pdfPaperSize, "a4");
});

test("PDF font inspection records the exact missing download before export", async () => {
  installEditorExportFixture();
  openExportModal("file:pdf");

  await refreshPdfFontInspection(() => {}, {
    invoke: async () => ({
      supported: true,
      requiredBytes: 17_910_040,
      missingBytes: 13_574_352,
      installed: false,
      fontFamilies: ["Noto Serif", "Noto Serif JP"],
    }),
  });

  assert.equal(state.editorChapter.exportModal.pdfFontStatus, "ready");
  assert.equal(state.editorChapter.exportModal.pdfFontMissingBytes, 13_574_352);
  assert.deepEqual(state.editorChapter.exportModal.pdfFontFamilies, ["Noto Serif", "Noto Serif JP"]);
});

test("Cancel remains available for a running PDF job and requests backend cancellation", async () => {
  installEditorExportFixture();
  openExportModal("file:pdf");
  state.editorChapter.exportModal.status = "exporting";
  state.editorChapter.exportModal.pdfJobId = "pdf-job-1";
  const calls = [];

  closeEditorExportOptions(() => {}, {
    invoke: async (command, payload) => calls.push({ command, payload }),
  });
  await Promise.resolve();

  assert.equal(state.editorChapter.exportModal.status, "cancelling");
  assert.deepEqual(calls, [{
    command: "cancel_gtms_chapter_pdf_export",
    payload: { jobId: "pdf-job-1" },
  }]);

  handleChapterPdfExportProgress({
    jobId: "pdf-job-1",
    status: "cancelled",
    message: "PDF export cancelled.",
  }, () => {});
  assert.equal(state.editorChapter.exportModal.isOpen, false);
});

test("cancelling while the repo queue is pending prevents the PDF job from starting", async () => {
  installEditorExportFixture();
  openExportModal("file:pdf");
  let releaseQueue;
  const queue = new Promise((resolve) => { releaseQueue = resolve; });
  const calls = [];

  const submission = submitEditorExport(() => {}, {
    saveDialog: async () => "/tmp/chapter-one.pdf",
    invoke: async (command) => {
      calls.push(command);
      if (command === "inspect_gtms_chapter_pdf_fonts") {
        return {
          supported: true,
          requiredBytes: 4_335_688,
          missingBytes: 0,
          installed: true,
          fontFamilies: ["Noto Serif"],
        };
      }
      return null;
    },
    waitForRepoQueue: async () => queue,
  });
  for (let attempt = 0; attempt < 10 && !state.editorChapter.exportModal.pdfStartPending; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.equal(state.editorChapter.exportModal.pdfStartPending, true);
  closeEditorExportOptions(() => {});
  assert.equal(state.editorChapter.exportModal.isOpen, false);

  releaseQueue();
  await submission;
  assert.deepEqual(calls, ["inspect_gtms_chapter_pdf_fonts"]);
});

test("PDF export progress ignores events from another job", () => {
  installEditorExportFixture();
  openExportModal("file:pdf");
  state.editorChapter.exportModal.status = "exporting";
  state.editorChapter.exportModal.pdfJobId = "current-job";

  handleChapterPdfExportProgress({
    jobId: "other-job",
    status: "error",
    message: "wrong error",
  }, () => {});

  assert.equal(state.editorChapter.exportModal.status, "exporting");
  assert.equal(state.editorChapter.exportModal.error, "");
});

test("PDF export progress records determinate image preparation progress", () => {
  installEditorExportFixture();
  openExportModal("file:pdf");
  state.editorChapter.exportModal.status = "exporting";
  state.editorChapter.exportModal.pdfJobId = "current-job";

  handleChapterPdfExportProgress({
    jobId: "current-job",
    status: "exporting",
    stage: "images",
    message: "Preparing images (2 of 5)…",
    progressCurrent: 2,
    progressTotal: 5,
    progressUnit: "items",
    progressIndeterminate: false,
  }, () => {});

  const modal = state.editorChapter.exportModal;
  assert.equal(modal.pdfStage, "Preparing images (2 of 5)…");
  assert.equal(modal.pdfProgressCurrent, 2);
  assert.equal(modal.pdfProgressTotal, 5);
  assert.equal(modal.pdfProgressUnit, "items");
  assert.equal(modal.pdfProgressIndeterminate, false);
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
