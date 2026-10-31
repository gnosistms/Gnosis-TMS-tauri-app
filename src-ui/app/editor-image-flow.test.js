import test from "node:test";
import assert from "node:assert/strict";
import { installMockNavigator } from "../test/mock-navigator.mjs";

const localStorageState = new Map();
const invokeLog = [];
let invokeHandler = async () => null;
// The pre-insert reuse lookup is answered separately so write-command tests keep
// asserting only the commands they care about.
const IMAGE_REUSE_COMMANDS = new Set(["find_gtms_editor_image_reuse", "allow_gtms_editor_image_reuse"]);
const NO_IMAGE_REUSE = async () => ({ imageKey: "", chapters: [] });
const imageReuseLog = [];
let imageReuseHandler = NO_IMAGE_REUSE;

function deferred() {
  let resolve = null;
  let reject = null;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

const fakeApp = {
  addEventListener() {},
  firstElementChild: null,
  innerHTML: "",
};

const fakeDocument = {
  activeElement: null,
  querySelector(selector) {
    return selector === "#app" ? fakeApp : null;
  },
  querySelectorAll() {
    return [];
  },
  addEventListener() {},
  body: {
    append() {},
    contains() {
      return false;
    },
  },
  documentElement: {
    classList: {
      remove() {},
      toggle() {},
    },
  },
  hidden: false,
};

const fakeLocalStorage = {
  getItem(key) {
    return localStorageState.has(key) ? localStorageState.get(key) : null;
  },
  setItem(key, value) {
    localStorageState.set(key, String(value));
  },
  removeItem(key) {
    localStorageState.delete(key);
  },
  clear() {
    localStorageState.clear();
  },
};

globalThis.document = fakeDocument;
installMockNavigator({
  platform: "MacIntel",
  userAgentData: null,
});
globalThis.performance = {
  now() {
    return 0;
  },
};
globalThis.CSS = {
  escape(value) {
    return String(value);
  },
};
globalThis.HTMLElement = class {};
globalThis.HTMLTextAreaElement = class extends globalThis.HTMLElement {};
globalThis.window = {
  __TAURI__: {
    core: {
      invoke(command, payload = {}) {
        if (IMAGE_REUSE_COMMANDS.has(command)) {
          imageReuseLog.push({ command, payload });
          return imageReuseHandler(command, payload);
        }
        invokeLog.push({ command, payload });
        return invokeHandler(command, payload);
      },
    },
    event: {
      listen: async () => () => {},
    },
    opener: {
      openUrl() {},
    },
  },
  localStorage: fakeLocalStorage,
  navigator: globalThis.navigator,
  setTimeout(callback) {
    callback();
    return 1;
  },
  clearTimeout() {},
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame(callback) {
    callback();
    return 1;
  },
  cancelAnimationFrame() {},
  open() {},
};

const {
  createEditorChapterState,
  resetSessionState,
  state,
} = await import("./state.js");
const {
  normalizeEditorRows,
  updateEditorChapterRow,
} = await import("./editor-state-flow.js");
const {
  resetEditorOperationQueue,
} = await import("./editor-operation-queue.js");
const {
  resetRepoWriteQueue,
} = await import("./repo-write-queue.js");
const {
  dismissActiveIdleEditorImageUpload,
  cancelEditorImageDuplicateOverwrite,
  confirmEditorImageDuplicateOverwrite,
  copyEditorImageUrl,
  duplicateEditorLanguageImage,
  handleDroppedEditorImageFile,
  handleDroppedEditorImagePath,
  handleEditorImageCaptionEnrichedEvent,
  closeEditorImagePreview,
  openEditorImagePreview,
  openEditorImageUrl,
  submitEditorImageUrl,
  updateEditorImageUrlDraft,
} = await import("./editor-image-flow.js");
const {
  cancelEditorImageReuse,
  confirmEditorImageReuse,
  updateEditorImageReuseDontShowAgain,
} = await import("./editor-image-reuse-flow.js");

test.afterEach(() => {
  resetEditorOperationQueue();
  resetRepoWriteQueue();
});

function installEditorFixture() {
  resetSessionState();
  invokeLog.length = 0;
  invokeHandler = async () => null;
  imageReuseLog.length = 0;
  imageReuseHandler = NO_IMAGE_REUSE;
  state.selectedTeamId = "team-1";
  state.teams = [{
    id: "team-1",
    installationId: 7,
  }];
  state.projects = [{
    id: "project-1",
    name: "fixture-project",
    teamId: "team-1",
    chapters: [{
      id: "chapter-1",
      name: "Chapter 1",
      languages: [
        { code: "es", name: "Spanish", role: "source" },
        { code: "vi", name: "Vietnamese", role: "target" },
      ],
      selectedSourceLanguageCode: "es",
      selectedTargetLanguageCode: "vi",
      syncState: "synced",
    }],
    syncState: "synced",
  }];
  state.selectedProjectId = "project-1";
  state.selectedChapterId = "chapter-1";
  state.editorChapter = {
    ...createEditorChapterState(),
    status: "ready",
    projectId: "project-1",
    chapterId: "chapter-1",
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "vi", name: "Vietnamese", role: "target" },
    ],
    rows: normalizeEditorRows([{
      rowId: "row-1",
      orderKey: "0001",
      textStyle: "paragraph",
      fields: {
        es: "hola",
        vi: "",
      },
      footnotes: {
        es: "",
        vi: "",
      },
      images: {},
      fieldStates: {
        es: { reviewed: false, pleaseCheck: false },
        vi: { reviewed: false, pleaseCheck: false },
      },
    }]),
    imageEditor: {
      rowId: "row-1",
      languageCode: "vi",
      mode: "url",
      urlDraft: "",
      invalidUrl: false,
      urlErrorMessage: "",
      status: "idle",
    },
  };
}

// The reuse lookup (and the upload hash) settle on later event-loop turns, so
// wait for the write command instead of counting microtasks.
// A fixed number of turns was too few on slow CI runners, where the file read
// before the upload can take longer; wait by time and fail if it never comes.
async function waitForInvoke(command, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!invokeLog.some((entry) => entry.command === command)) {
    assert.ok(Date.now() < deadline, `${command} was not invoked within ${timeoutMs}ms`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function createRenderSpy() {
  const calls = [];
  const render = (...args) => {
    calls.push(args);
  };
  render.calls = calls;
  return render;
}

function installFixtureImage(url = "https://example.com/image.png") {
  state.editorChapter = {
    ...state.editorChapter,
    rows: state.editorChapter.rows.map((row) =>
      row.rowId === "row-1"
        ? {
            ...row,
            images: {
              ...row.images,
              vi: {
                kind: "url",
                url,
              },
            },
          }
        : row
    ),
  };
}

test("openEditorImagePreview renders only the overlay so editor scroll stays stable", () => {
  installEditorFixture();
  installFixtureImage();
  const render = createRenderSpy();

  openEditorImagePreview(render, "row-1", "vi");

  assert.deepEqual(state.editorChapter.imagePreviewOverlay, {
    isOpen: true,
    rowId: "row-1",
    languageCode: "vi",
    src: "https://example.com/image.png",
    imageUrl: "https://example.com/image.png",
  });
  assert.deepEqual(render.calls, [[{ scope: "translate-image-preview-overlay" }]]);
});

test("closeEditorImagePreview renders only the overlay so editor scroll stays stable", () => {
  installEditorFixture();
  const render = createRenderSpy();
  state.editorChapter = {
    ...state.editorChapter,
    imagePreviewOverlay: {
      isOpen: true,
      rowId: "row-1",
      languageCode: "vi",
      src: "https://example.com/image.png",
    },
  };

  closeEditorImagePreview(render);

  assert.deepEqual(state.editorChapter.imagePreviewOverlay, {
    isOpen: false,
    rowId: null,
    languageCode: null,
    src: "",
    imageUrl: "",
  });
  assert.deepEqual(render.calls, [[{ scope: "translate-image-preview-overlay" }]]);
});

test("WordPress caption enrichment preserves imported links in the background row", () => {
  installEditorFixture();
  const imageUrl = "https://example.com/wp-content/uploads/photo.jpg";
  installFixtureImage(imageUrl);
  const row = state.editorChapter.rows[0];
  state.editorChapter = {
    ...state.editorChapter,
    rows: [{
      ...row,
      imageCaptions: { ...row.imageCaptions, vi: "Previous image caption" },
      persistedImageCaptions: { ...row.persistedImageCaptions, vi: "Previous image caption" },
    }],
  };
  const render = createRenderSpy();
  const importedCaption = 'Xem mô hình tại <a href="https://chakras.gnosis-tms.com/">đây</a>, và các nguồn tại <a href="https://chakras.gnosis-tms.com/dau">đây</a>.';
  const payloadRow = {
    ...state.editorChapter.rows[0],
    imageCaptions: { ...state.editorChapter.rows[0].imageCaptions, vi: importedCaption },
    persistedImageCaptions: { ...state.editorChapter.rows[0].persistedImageCaptions, vi: importedCaption },
  };

  assert.equal(handleEditorImageCaptionEnrichedEvent({
    chapterId: "chapter-1",
    rowId: "row-1",
    languageCode: "vi",
    imageUrl,
    row: payloadRow,
    chapterBaseCommitSha: "caption-commit",
  }, render), true);

  assert.equal(state.editorChapter.rows[0].imageCaptions.vi, importedCaption);
  assert.equal(state.editorChapter.rows[0].persistedImageCaptions.vi, importedCaption);
  assert.equal(state.editorChapter.chapterBaseCommitSha, "caption-commit");
});

test("WordPress caption enrichment preserves a newer unsaved caption edit", () => {
  installEditorFixture();
  const imageUrl = "https://example.com/wp-content/uploads/photo.jpg";
  installFixtureImage(imageUrl);
  const row = state.editorChapter.rows[0];
  state.editorChapter = {
    ...state.editorChapter,
    rows: [{
      ...row,
      imageCaptions: { ...row.imageCaptions, vi: "New local caption" },
      persistedImageCaptions: { ...row.persistedImageCaptions, vi: "Previous image caption" },
    }],
  };
  const payloadRow = {
    ...state.editorChapter.rows[0],
    imageCaptions: { ...state.editorChapter.rows[0].imageCaptions, vi: "WordPress caption" },
    persistedImageCaptions: {
      ...state.editorChapter.rows[0].persistedImageCaptions,
      vi: "WordPress caption",
    },
  };

  assert.equal(handleEditorImageCaptionEnrichedEvent({
    chapterId: "chapter-1",
    rowId: "row-1",
    languageCode: "vi",
    imageUrl,
    row: payloadRow,
  }, createRenderSpy()), true);

  assert.equal(state.editorChapter.rows[0].imageCaptions.vi, "New local caption");
  assert.equal(state.editorChapter.rows[0].persistedImageCaptions.vi, "WordPress caption");
});

test("WordPress caption enrichment ignores an event for a replaced image", () => {
  installEditorFixture();
  installFixtureImage("https://example.com/wp-content/uploads/new.jpg");

  assert.equal(handleEditorImageCaptionEnrichedEvent({
    chapterId: "chapter-1",
    rowId: "row-1",
    languageCode: "vi",
    imageUrl: "https://example.com/wp-content/uploads/old.jpg",
    row: state.editorChapter.rows[0],
  }, createRenderSpy()), false);
});

test("duplicateEditorLanguageImage duplicates into an empty language immediately", async () => {
  installEditorFixture();
  installFixtureImage("https://example.com/duplicate.png");
  const render = createRenderSpy();
  invokeHandler = async (command, payload) => {
    assert.equal(command, "duplicate_gtms_editor_language_image");
    assert.equal(payload.input.sourceLanguageCode, "vi");
    assert.equal(payload.input.destinationLanguageCode, "es");
    assert.equal(payload.input.baseDestinationImage, null);
    return {
      status: "saved",
      row: {
        ...state.editorChapter.rows[0],
        images: {
          vi: { kind: "url", url: "https://example.com/duplicate.png" },
          es: { kind: "url", url: "https://example.com/duplicate.png" },
        },
      },
      chapterBaseCommitSha: "duplicate123",
    };
  };

  await duplicateEditorLanguageImage(
    render,
    "row-1",
    "vi",
    "es",
    { updateEditorChapterRow },
  );

  assert.equal(invokeLog.at(-1)?.command, "duplicate_gtms_editor_language_image");
  assert.deepEqual(state.editorChapter.rows[0].images.es, {
    kind: "url",
    url: "https://example.com/duplicate.png",
    path: null,
    filePath: null,
    fileName: null,
  });
  assert.equal(state.editorChapter.rows[0].images.vi.url, "https://example.com/duplicate.png");
});

test("duplicateEditorLanguageImage asks before replacing an occupied language", async () => {
  installEditorFixture();
  installFixtureImage("https://example.com/source.png");
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    images: {
      ...state.editorChapter.rows[0].images,
      es: { kind: "url", url: "https://example.com/existing.png" },
    },
  };
  const render = createRenderSpy();

  await duplicateEditorLanguageImage(
    render,
    "row-1",
    "vi",
    "es",
    { updateEditorChapterRow },
  );

  assert.equal(invokeLog.length, 0);
  assert.equal(state.editorChapter.imageDuplicateOverwriteModal.isOpen, true);
  assert.equal(state.editorChapter.imageDuplicateOverwriteModal.destinationLanguageName, "Spanish");
  assert.equal(state.editorChapter.rows[0].images.es.url, "https://example.com/existing.png");
  assert.deepEqual(render.calls, [[]]);
});

test("duplicateEditorLanguageImage closes a full-size preview before showing overwrite confirmation", async () => {
  installEditorFixture();
  installFixtureImage("https://example.com/source.png");
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    images: {
      ...state.editorChapter.rows[0].images,
      es: { kind: "url", url: "https://example.com/existing.png" },
    },
  };
  state.editorChapter = {
    ...state.editorChapter,
    imagePreviewOverlay: {
      isOpen: true,
      rowId: "row-1",
      languageCode: "vi",
      src: "https://example.com/source.png",
      imageUrl: "https://example.com/source.png",
    },
  };
  const render = createRenderSpy();

  await duplicateEditorLanguageImage(render, "row-1", "vi", "es", { updateEditorChapterRow });

  assert.equal(state.editorChapter.imagePreviewOverlay.isOpen, false);
  assert.equal(state.editorChapter.imageDuplicateOverwriteModal.isOpen, true);
  assert.deepEqual(render.calls[0], [{ scope: "translate-image-preview-overlay" }]);
});

test("image duplicate overwrite confirmation preserves the with-caption intent", async () => {
  installEditorFixture();
  installFixtureImage("https://example.com/source.png");
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    imageCaptions: { vi: "Source caption" },
    images: {
      ...state.editorChapter.rows[0].images,
      es: { kind: "url", url: "https://example.com/existing.png" },
    },
  };

  const result = await duplicateEditorLanguageImage(
    createRenderSpy(),
    "row-1",
    "vi",
    "es",
    { updateEditorChapterRow },
    { withCaption: true },
  );

  assert.equal(result.status, "confirmation-required");
  assert.equal(result.withCaption, true);
  assert.equal(state.editorChapter.imageDuplicateOverwriteModal.withCaption, true);
});

test("image duplicate overwrite modal cancels without changing either image", async () => {
  installEditorFixture();
  installFixtureImage("https://example.com/source.png");
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    images: {
      ...state.editorChapter.rows[0].images,
      es: { kind: "url", url: "https://example.com/existing.png" },
    },
  };
  const render = createRenderSpy();
  await duplicateEditorLanguageImage(render, "row-1", "vi", "es", { updateEditorChapterRow });

  cancelEditorImageDuplicateOverwrite(render);

  assert.equal(state.editorChapter.imageDuplicateOverwriteModal.isOpen, false);
  assert.equal(state.editorChapter.rows[0].images.vi.url, "https://example.com/source.png");
  assert.equal(state.editorChapter.rows[0].images.es.url, "https://example.com/existing.png");
  assert.equal(invokeLog.length, 0);
});

test("confirmed image duplicate overwrites only the destination image", async () => {
  installEditorFixture();
  installFixtureImage("https://example.com/source.png");
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    imageCaptions: {
      vi: "Source caption",
      es: "Destination caption",
    },
    images: {
      ...state.editorChapter.rows[0].images,
      es: { kind: "url", url: "https://example.com/existing.png" },
    },
  };
  const render = createRenderSpy();
  await duplicateEditorLanguageImage(render, "row-1", "vi", "es", { updateEditorChapterRow });
  invokeHandler = async (command) => {
    assert.equal(command, "duplicate_gtms_editor_language_image");
    return {
      status: "saved",
      row: {
        ...state.editorChapter.rows[0],
        images: {
          vi: { kind: "url", url: "https://example.com/source.png" },
          es: { kind: "url", url: "https://example.com/source.png" },
        },
      },
      chapterBaseCommitSha: "overwrite123",
    };
  };

  await confirmEditorImageDuplicateOverwrite(render, { updateEditorChapterRow });

  assert.equal(state.editorChapter.rows[0].images.vi.url, "https://example.com/source.png");
  assert.equal(state.editorChapter.rows[0].images.es.url, "https://example.com/source.png");
  assert.deepEqual(state.editorChapter.rows[0].imageCaptions, {
    vi: "Source caption",
    es: "Destination caption",
  });
});

test("confirmed image duplicate stops if the destination changes during readiness", async () => {
  installEditorFixture();
  installFixtureImage("https://example.com/source.png");
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    images: {
      ...state.editorChapter.rows[0].images,
      es: { kind: "url", url: "https://example.com/confirmed-destination.png" },
    },
  };
  const render = createRenderSpy();
  await duplicateEditorLanguageImage(render, "row-1", "vi", "es", { updateEditorChapterRow });

  const pendingConfirmation = confirmEditorImageDuplicateOverwrite(
    render,
    { updateEditorChapterRow },
  );
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    images: {
      ...state.editorChapter.rows[0].images,
      es: { kind: "url", url: "https://example.com/newer-destination.png" },
    },
  };
  await pendingConfirmation;

  assert.equal(invokeLog.length, 0);
  assert.equal(state.editorChapter.imageDuplicateOverwriteModal.isOpen, false);
  assert.equal(
    state.editorChapter.rows[0].images.es.url,
    "https://example.com/newer-destination.png",
  );
});

test("confirmed image duplicate closes confirmation when row readiness blocks the write", async () => {
  installEditorFixture();
  installFixtureImage("https://example.com/source.png");
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    images: {
      ...state.editorChapter.rows[0].images,
      es: { kind: "url", url: "https://example.com/existing.png" },
    },
  };
  const render = createRenderSpy();
  await duplicateEditorLanguageImage(render, "row-1", "vi", "es", { updateEditorChapterRow });
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    freshness: "conflict",
  };

  await confirmEditorImageDuplicateOverwrite(render, { updateEditorChapterRow });

  assert.equal(invokeLog.length, 0);
  assert.equal(state.editorChapter.imageDuplicateOverwriteModal.isOpen, false);
});

test("copyEditorImageUrl writes the original URL to the clipboard", async () => {
  installEditorFixture();
  const copied = [];
  const previousClipboard = globalThis.navigator.clipboard;
  globalThis.navigator.clipboard = {
    async writeText(value) {
      copied.push(value);
    },
  };

  try {
    await copyEditorImageUrl(createRenderSpy(), "https://example.com/original.png");
    assert.deepEqual(copied, ["https://example.com/original.png"]);
  } finally {
    globalThis.navigator.clipboard = previousClipboard;
  }
});

test("submitEditorImageUrl clears an empty draft back to the pre-open state", async () => {
  installEditorFixture();
  const render = createRenderSpy();

  await submitEditorImageUrl(render, "row-1", "vi");

  assert.deepEqual(state.editorChapter.imageEditor, {
    rowId: null,
    languageCode: null,
    mode: null,
    urlDraft: "",
    invalidUrl: false,
    urlErrorMessage: "",
    status: "idle",
  });
  assert.deepEqual(render.calls, [[{
    scope: "translate-visible-rows",
    rowIds: ["row-1"],
    reason: render.calls[0][0].reason,
  }]]);
  assert.equal(invokeLog.length, 0);
});

test("submitEditorImageUrl closes the input while a non-empty draft is being saved", async () => {
  installEditorFixture();
  const render = createRenderSpy();
  state.editorChapter = {
    ...state.editorChapter,
    imageEditor: {
      rowId: "row-1",
      languageCode: "vi",
      mode: "url",
      urlDraft: "https://example.com/image.png",
      invalidUrl: false,
      urlErrorMessage: "",
      status: "idle",
    },
  };

  invokeHandler = async (command) => {
    assert.equal(command, "save_gtms_editor_language_image_url");
    return new Promise(() => {});
  };

  const submitPromise = submitEditorImageUrl(render, "row-1", "vi");
  await waitForInvoke("save_gtms_editor_language_image_url");

  assert.equal(state.editorChapter.imageEditor.status, "submitting");
  assert.equal(state.editorChapter.imageEditor.mode, "url");
  assert.equal(render.calls.length, 2);
  assert.equal(invokeLog.at(-1)?.command, "save_gtms_editor_language_image_url");

  submitPromise.catch(() => {});
});

test("openEditorImageUrl reopens a submitting URL draft for inspection", () => {
  installEditorFixture();
  const render = createRenderSpy();
  state.editorChapter = {
    ...state.editorChapter,
    imageEditor: {
      rowId: "row-1",
      languageCode: "vi",
      mode: "url",
      urlDraft: "https://example.com/image.png",
      invalidUrl: false,
      urlErrorMessage: "",
      status: "submitting",
    },
  };

  openEditorImageUrl(render, "row-1", "vi");

  assert.deepEqual(state.editorChapter.imageEditor, {
    rowId: "row-1",
    languageCode: "vi",
    mode: "url",
    urlDraft: "https://example.com/image.png",
    invalidUrl: false,
    urlErrorMessage: "",
    status: "idle",
  });
  assert.equal(render.calls.length, 1);
});

test("submitEditorImageUrl reports URL syntax errors without calling the image loader", async () => {
  installEditorFixture();
  const render = createRenderSpy();
  state.editorChapter = {
    ...state.editorChapter,
    imageEditor: {
      rowId: "row-1",
      languageCode: "vi",
      mode: "url",
      urlDraft: "notaurl",
      invalidUrl: false,
      urlErrorMessage: "",
      status: "idle",
    },
  };

  const originalImage = globalThis.Image;
  globalThis.Image = class {
    constructor() {
      throw new Error("Image loader should not be used for URL syntax validation.");
    }
  };

  try {
    await submitEditorImageUrl(render, "row-1", "vi");
  } finally {
    globalThis.Image = originalImage;
  }

  assert.deepEqual(state.editorChapter.imageEditor, {
    rowId: "row-1",
    languageCode: "vi",
    mode: null,
    urlDraft: "notaurl",
    invalidUrl: true,
    urlErrorMessage: "Enter a valid image URL.",
    status: "idle",
  });
  assert.equal(invokeLog.length, 0);
});

test("submitEditorImageUrl reports save failures as a clickable image URL error state", async () => {
  installEditorFixture();
  const render = createRenderSpy();
  state.editorChapter = {
    ...state.editorChapter,
    imageEditor: {
      rowId: "row-1",
      languageCode: "vi",
      mode: "url",
      urlDraft: "https://example.com/fail.png",
      invalidUrl: false,
      urlErrorMessage: "",
      status: "idle",
    },
  };

  invokeHandler = async () => {
    throw new Error("Image could not be loaded.");
  };

  await submitEditorImageUrl(render, "row-1", "vi");

  assert.deepEqual(state.editorChapter.imageEditor, {
    rowId: "row-1",
    languageCode: "vi",
    mode: null,
    urlDraft: "https://example.com/fail.png",
    invalidUrl: true,
    urlErrorMessage: "Image could not be loaded.",
    status: "idle",
  });
});

test("submitEditorImageUrl does not replace a URL editor reopened while the save was pending", async () => {
  installEditorFixture();
  const render = createRenderSpy();
  state.editorChapter = {
    ...state.editorChapter,
    imageEditor: {
      rowId: "row-1",
      languageCode: "vi",
      mode: "url",
      urlDraft: "https://example.com/slow.png",
      invalidUrl: false,
      urlErrorMessage: "",
      status: "idle",
    },
  };

  let rejectSave;
  invokeHandler = async () => new Promise((_resolve, reject) => {
    rejectSave = reject;
  });

  const submitPromise = submitEditorImageUrl(render, "row-1", "vi");
  await waitForInvoke("save_gtms_editor_language_image_url");
  openEditorImageUrl(render, "row-1", "vi");
  updateEditorImageUrlDraft("https://example.com/edited.png");
  rejectSave(new Error("Original image failed."));
  await submitPromise;

  assert.deepEqual(state.editorChapter.imageEditor, {
    rowId: "row-1",
    languageCode: "vi",
    mode: "url",
    urlDraft: "https://example.com/edited.png",
    invalidUrl: false,
    urlErrorMessage: "",
    status: "idle",
  });
});

test("submitEditorImageUrl stays clickable while marker save is pending", async () => {
  installEditorFixture();
  const render = createRenderSpy();
  state.editorChapter = {
    ...state.editorChapter,
    imageEditor: {
      rowId: "row-1",
      languageCode: "vi",
      mode: "url",
      urlDraft: "https://example.com/queued.png",
      invalidUrl: false,
      urlErrorMessage: "",
      status: "idle",
    },
    rows: state.editorChapter.rows.map((row) => ({
      ...row,
      markerSaveState: {
        status: "saving",
        languageCode: "vi",
        kind: "reviewed",
        error: "",
      },
    })),
  };

  invokeHandler = async (command, payload = {}) => {
    assert.equal(command, "save_gtms_editor_language_image_url");
    return {
      status: "saved",
      row: {
        ...state.editorChapter.rows[0],
        images: {
          vi: {
            kind: "url",
            url: payload.input?.url,
          },
        },
      },
      chapterBaseCommitSha: "abc123",
    };
  };

  await submitEditorImageUrl(render, "row-1", "vi", { updateEditorChapterRow });

  assert.equal(invokeLog.at(-1)?.command, "save_gtms_editor_language_image_url");
  assert.deepEqual(state.editorChapter.rows[0].images.vi, {
    kind: "url",
    url: "https://example.com/queued.png",
    path: null,
    filePath: null,
    fileName: null,
  });
});

test("dismissActiveIdleEditorImageUpload clears an idle upload editor back to the pre-open state", () => {
  installEditorFixture();
  const render = createRenderSpy();
  state.editorChapter = {
    ...state.editorChapter,
    imageEditor: {
      rowId: "row-1",
      languageCode: "vi",
      mode: "upload",
      urlDraft: "",
      invalidUrl: false,
      urlErrorMessage: "",
      status: "idle",
    },
  };

  const dismissed = dismissActiveIdleEditorImageUpload(render);

  assert.equal(dismissed, true);
  assert.deepEqual(state.editorChapter.imageEditor, {
    rowId: null,
    languageCode: null,
    mode: null,
    urlDraft: "",
    invalidUrl: false,
    urlErrorMessage: "",
    status: "idle",
  });
  assert.deepEqual(render.calls, [[{
    scope: "translate-visible-rows",
    rowIds: ["row-1"],
    reason: render.calls[0][0].reason,
  }]]);
});

test("dismissActiveIdleEditorImageUpload keeps active upload work in place", () => {
  installEditorFixture();
  const render = createRenderSpy();
  state.editorChapter = {
    ...state.editorChapter,
    imageEditor: {
      rowId: "row-1",
      languageCode: "vi",
      mode: "upload",
      urlDraft: "",
      invalidUrl: false,
      urlErrorMessage: "",
      status: "saving",
    },
  };

  const dismissed = dismissActiveIdleEditorImageUpload(render);

  assert.equal(dismissed, false);
  assert.deepEqual(state.editorChapter.imageEditor, {
    rowId: "row-1",
    languageCode: "vi",
    mode: "upload",
    urlDraft: "",
    invalidUrl: false,
    urlErrorMessage: "",
    status: "saving",
  });
  assert.deepEqual(render.calls, []);
});

test("removeEditorLanguageImage refreshes an expired native login and completes deletion", async () => {
  installEditorFixture();
  const imageUrl = "https://gnosisvn.org/wp-content/uploads/2026/10/LuanXa.webp";
  installFixtureImage(imageUrl);
  state.auth.session = { sessionToken: "expired-token", login: "owner" };
  const render = createRenderSpy();
  let nativeToken = "expired-token";
  let deletionAttempts = 0;
  invokeHandler = async (command, payload = {}) => {
    if (command === "refresh_broker_auth_session") {
      assert.equal(payload.sessionToken, "expired-token");
      return { sessionToken: "renewed-token", login: "owner" };
    }
    if (command === "save_broker_auth_session") {
      nativeToken = payload.session.sessionToken;
      return;
    }
    assert.equal(command, "remove_gtms_editor_language_image");
    deletionAttempts += 1;
    assert.equal(payload.input.rowId, "row-1");
    assert.equal(payload.input.baseImage.url, imageUrl);
    if (nativeToken === "expired-token") {
      throw new Error("AUTH_RETRY_SAFE:AUTH_REQUIRED:Your GitHub session expired. Please sign in again.");
    }
    return { status: "saved", row: { ...state.editorChapter.rows[0], images: {} }, chapterBaseCommitSha: "image-removed" };
  };
  const { removeEditorLanguageImage } = await import("./editor-image-flow.js");
  await removeEditorLanguageImage(render, "row-1", "vi", { updateEditorChapterRow });
  assert.equal(deletionAttempts, 2);
  assert.equal(invokeLog.filter(({ command }) => command === "refresh_broker_auth_session").length, 1);
  assert.equal(state.auth.session.sessionToken, "renewed-token");
  assert.equal(state.editorChapter.rows[0].images.vi, undefined);
  assert.equal(state.editorChapter.chapterBaseCommitSha, "image-removed");
});

test("removeEditorLanguageImage stays clickable while row text save is pending", async () => {
  installEditorFixture();
  installFixtureImage("https://example.com/remove-me.png");
  const render = createRenderSpy();
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    saveStatus: "saving",
  };

  invokeHandler = async (command, payload = {}) => {
    assert.equal(command, "remove_gtms_editor_language_image");
    assert.equal(payload.input?.rowId, "row-1");
    return {
      status: "saved",
      row: {
        ...state.editorChapter.rows[0],
        images: {},
      },
      chapterBaseCommitSha: "abc123",
    };
  };

  const {
    removeEditorLanguageImage,
  } = await import("./editor-image-flow.js");

  await removeEditorLanguageImage(render, "row-1", "vi", { updateEditorChapterRow });

  assert.equal(invokeLog.at(-1)?.command, "remove_gtms_editor_language_image");
  assert.equal(state.editorChapter.rows[0].images.vi, undefined);
});

test("removeEditorLanguageImage renders only the affected row and never writes scroll", async () => {
  installEditorFixture();
  installFixtureImage("https://example.com/remove-me.png");

  // Row patching preserves the viewport by construction: the flow must not
  // remount the body or write the scroll container's scrollTop at all.
  const scrollWrites = [];
  const container = new (class extends globalThis.HTMLElement {
    constructor() {
      super();
      this._scrollTop = 240;
      this.scrollLeft = 0;
      this.clientHeight = 600;
    }

    get scrollTop() {
      return this._scrollTop;
    }

    set scrollTop(value) {
      scrollWrites.push(value);
      this._scrollTop = value;
    }

    getBoundingClientRect() {
      return { top: 0, bottom: 600, height: 600 };
    }
  })();
  const originalQuerySelector = fakeDocument.querySelector;
  fakeDocument.querySelector = (selector) => {
    if (selector === ".translate-main-scroll") {
      return container;
    }
    return selector === "#app" ? fakeApp : null;
  };

  const render = createRenderSpy();

  invokeHandler = async (command) => {
    assert.equal(command, "remove_gtms_editor_language_image");
    return {
      status: "saved",
      row: {
        ...state.editorChapter.rows[0],
        images: {},
      },
      chapterBaseCommitSha: "abc123",
    };
  };

  const {
    removeEditorLanguageImage,
  } = await import("./editor-image-flow.js");

  try {
    await removeEditorLanguageImage(render, "row-1", "vi", { updateEditorChapterRow });

    assert.ok(render.calls.length > 0);
    for (const [options] of render.calls) {
      if (options?.scope === "translate-sidebar") {
        continue;
      }
      assert.equal(options?.scope, "translate-visible-rows");
      assert.deepEqual(options?.rowIds, ["row-1"]);
    }
    assert.deepEqual(scrollWrites, []);
    assert.equal(container.scrollTop, 240);
  } finally {
    fakeDocument.querySelector = originalQuerySelector;
  }
});

test("handleDroppedEditorImageFile applies a saved uploaded image to the editor row", async () => {
  installEditorFixture();
  const render = createRenderSpy();
  state.editorChapter = {
    ...state.editorChapter,
    activeRowId: "row-1",
    activeLanguageCode: "vi",
    imageEditor: {
      rowId: "row-1",
      languageCode: "vi",
      mode: "upload",
      urlDraft: "",
      invalidUrl: false,
      urlErrorMessage: "",
      status: "idle",
    },
  };

  const originalImage = globalThis.Image;
  const originalFileReader = globalThis.FileReader;
  const originalSetTimeout = globalThis.window.setTimeout;
  const originalCreateObjectUrl = globalThis.URL.createObjectURL;
  const originalRevokeObjectUrl = globalThis.URL.revokeObjectURL;

  globalThis.Image = class {
    set onload(callback) {
      this._onload = callback;
    }

    set onerror(_callback) {}

    set src(_value) {
      this._onload?.();
    }
  };

  globalThis.FileReader = class {
    constructor() {
      this.result = null;
      this.error = null;
      this.onload = null;
      this.onerror = null;
    }

    readAsDataURL(blob) {
      void blob.arrayBuffer().then((buffer) => {
        const base64 = Buffer.from(buffer).toString("base64");
        this.result = `data:${blob.type || "application/octet-stream"};base64,${base64}`;
        this.onload?.();
      }).catch((error) => {
        this.error = error;
        this.onerror?.();
      });
    }
  };
  globalThis.window.setTimeout = () => 1;
  globalThis.URL.createObjectURL = () => "blob:test-image";
  globalThis.URL.revokeObjectURL = () => {};

  invokeHandler = async (command) => {
    assert.equal(command, "upload_gtms_editor_language_image");
    return {
      status: "saved",
      rowId: "row-1",
      languageCode: "vi",
      chapterBaseCommitSha: "abc123",
      row: {
        rowId: "row-1",
        orderKey: "0001",
        textStyle: "paragraph",
        fields: {
          es: "hola",
          vi: "",
        },
        footnotes: {
          es: "",
          vi: "",
        },
        images: {
          vi: {
            kind: "upload",
            path: "chapters/chapter-1/images/row-row-1-vi-upload/row-1-vi.png",
            filePath: "/tmp/row-row-1-vi-upload/row-1-vi.png",
            fileName: "row-1-vi.png",
          },
        },
        fieldStates: {
          es: { reviewed: false, pleaseCheck: false },
          vi: { reviewed: false, pleaseCheck: false },
        },
      },
    };
  };

  try {
    await handleDroppedEditorImageFile(
      render,
      "row-1",
      "vi",
      {
        name: "row-1-vi.png",
        type: "image/png",
        async arrayBuffer() {
          return Uint8Array.from([137, 80, 78, 71]).buffer;
        },
      },
      { updateEditorChapterRow },
    );
  } finally {
    globalThis.Image = originalImage;
    globalThis.FileReader = originalFileReader;
    globalThis.window.setTimeout = originalSetTimeout;
    globalThis.URL.createObjectURL = originalCreateObjectUrl;
    globalThis.URL.revokeObjectURL = originalRevokeObjectUrl;
  }

  assert.deepEqual(state.editorChapter.imageEditor, {
    rowId: null,
    languageCode: null,
    mode: null,
    urlDraft: "",
    invalidUrl: false,
    urlErrorMessage: "",
    status: "idle",
  });
  assert.equal(state.editorChapter.chapterBaseCommitSha, "abc123");
  assert.deepEqual(state.editorChapter.rows[0].images.vi, {
    kind: "upload",
    url: null,
    path: "chapters/chapter-1/images/row-row-1-vi-upload/row-1-vi.png",
    filePath: "/tmp/row-row-1-vi-upload/row-1-vi.png",
    fileName: "row-1-vi.png",
  });
  assert.ok(render.calls.length >= 2);
  assert.equal(invokeLog.at(-1)?.command, "upload_gtms_editor_language_image");
});

test("handleDroppedEditorImageFile shows uploaded filename in optimistic history", async () => {
  installEditorFixture();
  const render = createRenderSpy();
  state.editorChapter = {
    ...state.editorChapter,
    activeRowId: "row-1",
    activeLanguageCode: "vi",
    history: {
      ...state.editorChapter.history,
      status: "ready",
      rowId: "row-1",
      languageCode: "vi",
      entries: [{
        commitSha: "commit-1",
        plainText: "",
        footnote: "",
        imageCaption: "",
        image: null,
        textStyle: "paragraph",
        reviewed: false,
        pleaseCheck: false,
      }],
    },
    imageEditor: {
      rowId: "row-1",
      languageCode: "vi",
      mode: "upload",
      urlDraft: "",
      invalidUrl: false,
      urlErrorMessage: "",
      status: "idle",
    },
  };

  const originalImage = globalThis.Image;
  const originalFileReader = globalThis.FileReader;
  const originalSetTimeout = globalThis.window.setTimeout;
  const originalCreateObjectUrl = globalThis.URL.createObjectURL;
  const originalRevokeObjectUrl = globalThis.URL.revokeObjectURL;

  globalThis.Image = class {
    set onload(callback) {
      this._onload = callback;
    }

    set onerror(_callback) {}

    set src(_value) {
      this._onload?.();
    }
  };

  globalThis.FileReader = class {
    constructor() {
      this.result = null;
      this.error = null;
      this.onload = null;
      this.onerror = null;
    }

    readAsDataURL(blob) {
      void blob.arrayBuffer().then((buffer) => {
        const base64 = Buffer.from(buffer).toString("base64");
        this.result = `data:${blob.type || "application/octet-stream"};base64,${base64}`;
        this.onload?.();
      }).catch((error) => {
        this.error = error;
        this.onerror?.();
      });
    }
  };
  globalThis.window.setTimeout = () => 1;
  globalThis.URL.createObjectURL = () => "blob:test-image";
  globalThis.URL.revokeObjectURL = () => {};

  const uploadDeferred = deferred();
  invokeHandler = async (command) => {
    assert.equal(command, "upload_gtms_editor_language_image");
    return uploadDeferred.promise;
  };

  let uploadPromise;
  try {
    uploadPromise = handleDroppedEditorImageFile(
      render,
      "row-1",
      "vi",
      {
        name: "pending-upload.png",
        type: "image/png",
        async arrayBuffer() {
          return Uint8Array.from([137, 80, 78, 71]).buffer;
        },
      },
      { updateEditorChapterRow },
    );
    await waitForInvoke("upload_gtms_editor_language_image");

    assert.equal(state.editorChapter.history.entries[0].optimistic, true);
    assert.deepEqual(state.editorChapter.history.entries[0].image, {
      kind: "upload",
      url: null,
      path: "pending/pending-upload.png",
      filePath: null,
      fileName: "pending-upload.png",
    });

    uploadDeferred.resolve({
      status: "saved",
      rowId: "row-1",
      languageCode: "vi",
      chapterBaseCommitSha: "abc123",
      row: state.editorChapter.rows[0],
    });
    await uploadPromise;
  } finally {
    globalThis.Image = originalImage;
    globalThis.FileReader = originalFileReader;
    globalThis.window.setTimeout = originalSetTimeout;
    globalThis.URL.createObjectURL = originalCreateObjectUrl;
    globalThis.URL.revokeObjectURL = originalRevokeObjectUrl;
  }
});

test("handleDroppedEditorImagePath applies a native dropped file to the active upload editor", async () => {
  installEditorFixture();
  const render = createRenderSpy();
  state.editorChapter = {
    ...state.editorChapter,
    activeRowId: "row-1",
    activeLanguageCode: "vi",
    imageEditor: {
      rowId: "row-1",
      languageCode: "vi",
      mode: "upload",
      urlDraft: "",
      invalidUrl: false,
      urlErrorMessage: "",
      status: "idle",
    },
  };

  const originalImage = globalThis.Image;
  const originalSetTimeout = globalThis.window.setTimeout;
  const originalCreateObjectUrl = globalThis.URL.createObjectURL;
  const originalRevokeObjectUrl = globalThis.URL.revokeObjectURL;

  globalThis.Image = class {
    set onload(callback) {
      this._onload = callback;
    }

    set onerror(_callback) {}

    set src(_value) {
      this._onload?.();
    }
  };

  globalThis.window.setTimeout = () => 1;
  globalThis.URL.createObjectURL = () => "blob:test-image";
  globalThis.URL.revokeObjectURL = () => {};

  invokeHandler = async (command) => {
    if (command === "read_local_dropped_file") {
      return {
        name: "row-1-vi.png",
        mimeType: "image/png",
        dataBase64: Buffer.from(Uint8Array.from([137, 80, 78, 71])).toString("base64"),
      };
    }

    assert.equal(command, "upload_gtms_editor_language_image");
    return {
      status: "saved",
      rowId: "row-1",
      languageCode: "vi",
      chapterBaseCommitSha: "abc123",
      row: {
        rowId: "row-1",
        orderKey: "0001",
        textStyle: "paragraph",
        fields: {
          es: "hola",
          vi: "",
        },
        footnotes: {
          es: "",
          vi: "",
        },
        images: {
          vi: {
            kind: "upload",
            path: "chapters/chapter-1/images/row-row-1-vi-upload/row-1-vi.png",
            filePath: "/tmp/row-row-1-vi-upload/row-1-vi.png",
            fileName: "row-1-vi.png",
          },
        },
        fieldStates: {
          es: { reviewed: false, pleaseCheck: false },
          vi: { reviewed: false, pleaseCheck: false },
        },
      },
    };
  };

  try {
    await handleDroppedEditorImagePath(
      render,
      "/Users/hans/Desktop/test.png",
      { updateEditorChapterRow },
    );
  } finally {
    globalThis.Image = originalImage;
    globalThis.window.setTimeout = originalSetTimeout;
    globalThis.URL.createObjectURL = originalCreateObjectUrl;
    globalThis.URL.revokeObjectURL = originalRevokeObjectUrl;
  }

  assert.deepEqual(state.editorChapter.imageEditor, {
    rowId: null,
    languageCode: null,
    mode: null,
    urlDraft: "",
    invalidUrl: false,
    urlErrorMessage: "",
    status: "idle",
  });
  assert.equal(state.editorChapter.chapterBaseCommitSha, "abc123");
  assert.deepEqual(invokeLog.map((entry) => entry.command), [
    "read_local_dropped_file",
    "upload_gtms_editor_language_image",
  ]);
});

const REUSED_URL = "https://example.com/separator.png";

function installUrlDraft(url = REUSED_URL) {
  state.editorChapter = {
    ...state.editorChapter,
    imageEditor: {
      rowId: "row-1",
      languageCode: "vi",
      mode: "url",
      urlDraft: url,
      invalidUrl: false,
      urlErrorMessage: "",
      status: "idle",
    },
  };
}

function reportImageReuse(imageKey, chapters) {
  imageReuseHandler = async (command) => (
    command === "find_gtms_editor_image_reuse" ? { imageKey, chapters } : null
  );
}

async function withUploadMocks(run) {
  const originalImage = globalThis.Image;
  const originalFileReader = globalThis.FileReader;
  const originalSetTimeout = globalThis.window.setTimeout;
  const originalCreateObjectUrl = globalThis.URL.createObjectURL;
  const originalRevokeObjectUrl = globalThis.URL.revokeObjectURL;
  globalThis.Image = class {
    set onload(callback) {
      this._onload = callback;
    }

    set onerror(_callback) {}

    set src(_value) {
      this._onload?.();
    }
  };
  globalThis.FileReader = class {
    readAsDataURL(blob) {
      void blob.arrayBuffer().then((buffer) => {
        this.result = `data:image/png;base64,${Buffer.from(buffer).toString("base64")}`;
        this.onload?.();
      });
    }
  };
  globalThis.window.setTimeout = () => 1;
  globalThis.URL.createObjectURL = () => "blob:test-image";
  globalThis.URL.revokeObjectURL = () => {};
  try {
    await run();
  } finally {
    globalThis.Image = originalImage;
    globalThis.FileReader = originalFileReader;
    globalThis.window.setTimeout = originalSetTimeout;
    globalThis.URL.createObjectURL = originalCreateObjectUrl;
    globalThis.URL.revokeObjectURL = originalRevokeObjectUrl;
  }
}

function separatorUpload() {
  return {
    name: "separator.png",
    type: "image/png",
    size: 4,
    async arrayBuffer() {
      return Uint8Array.from([137, 80, 78, 71]).buffer;
    },
  };
}

function installUploadEditor() {
  state.editorChapter = {
    ...state.editorChapter,
    imageEditor: {
      rowId: "row-1",
      languageCode: "vi",
      mode: "upload",
      urlDraft: "",
      invalidUrl: false,
      urlErrorMessage: "",
      status: "idle",
    },
  };
}

test("submitEditorImageUrl asks before inserting a URL already used in the project", async () => {
  installEditorFixture();
  state.projects[0].chapters.push({ id: "chapter-2", name: "Appendix" });
  installUrlDraft();
  const render = createRenderSpy();
  reportImageReuse(`url:${REUSED_URL}`, [
    { chapterId: "chapter-1", title: "Chapter 1" },
    { chapterId: "chapter-2", title: "appendix-on-disk" },
  ]);
  invokeHandler = async () => ({ status: "saved", rowId: "row-1", languageCode: "vi" });

  await submitEditorImageUrl(render, "row-1", "vi");

  assert.equal(invokeLog.length, 0);
  assert.deepEqual(imageReuseLog.map((entry) => entry.payload.input), [{
    installationId: 7,
    projectId: "project-1",
    repoName: "fixture-project",
    chapterId: "chapter-1",
    rowId: "row-1",
    image: { kind: "url", url: REUSED_URL },
  }]);
  assert.equal(state.editorChapter.imageReuseModal.isOpen, true);
  assert.deepEqual(state.editorChapter.imageReuseModal.chapterTitles, ["Appendix", "Chapter 1"]);
  assert.equal(state.editorChapter.imageEditor.status, "submitting");

  await confirmEditorImageReuse(render);
  await waitForInvoke("save_gtms_editor_language_image_url");

  assert.equal(state.editorChapter.imageReuseModal.isOpen, false);
  assert.equal(invokeLog.at(-1)?.command, "save_gtms_editor_language_image_url");
  assert.equal(invokeLog.at(-1)?.payload.input.url, REUSED_URL);
  assert.equal(imageReuseLog.length, 1);
});

test("confirming a reused image with don't-show-again remembers it for the project", async () => {
  installEditorFixture();
  installUrlDraft();
  const render = createRenderSpy();
  reportImageReuse(`url:${REUSED_URL}`, [{ chapterId: "chapter-1", title: "Chapter 1" }]);
  invokeHandler = async () => ({ status: "saved", rowId: "row-1", languageCode: "vi" });

  await submitEditorImageUrl(render, "row-1", "vi");
  updateEditorImageReuseDontShowAgain(true);
  await confirmEditorImageReuse(render);
  await waitForInvoke("save_gtms_editor_language_image_url");

  assert.deepEqual(imageReuseLog.at(-1), {
    command: "allow_gtms_editor_image_reuse",
    payload: {
      input: {
        installationId: 7,
        projectId: "project-1",
        repoName: "fixture-project",
        imageKey: `url:${REUSED_URL}`,
      },
    },
  });
  assert.equal(invokeLog.at(-1)?.command, "save_gtms_editor_language_image_url");
});

test("cancelling a reused image URL closes the URL editor without saving", async () => {
  installEditorFixture();
  installUrlDraft();
  const render = createRenderSpy();
  reportImageReuse(`url:${REUSED_URL}`, [{ chapterId: "chapter-1", title: "Chapter 1" }]);

  await submitEditorImageUrl(render, "row-1", "vi");
  cancelEditorImageReuse(render);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(state.editorChapter.imageReuseModal.isOpen, false);
  assert.equal(state.editorChapter.imageEditor.mode, null);
  assert.equal(state.editorChapter.imageEditor.status, "idle");
  assert.equal(invokeLog.length, 0);
  assert.equal(render.calls.at(-1)?.length, 0);
});

test("submitEditorImageUrl skips the reuse check when the URL is already this field's image", async () => {
  installEditorFixture();
  installFixtureImage(REUSED_URL);
  installUrlDraft();
  const render = createRenderSpy();
  reportImageReuse(`url:${REUSED_URL}`, [{ chapterId: "chapter-1", title: "Chapter 1" }]);
  invokeHandler = async () => ({ status: "saved", rowId: "row-1", languageCode: "vi" });

  await submitEditorImageUrl(render, "row-1", "vi");
  await waitForInvoke("save_gtms_editor_language_image_url");

  assert.equal(imageReuseLog.length, 0);
  assert.equal(state.editorChapter.imageReuseModal.isOpen, false);
  assert.equal(invokeLog.at(-1)?.command, "save_gtms_editor_language_image_url");
});

test("a failed reuse check never blocks inserting the image", async () => {
  installEditorFixture();
  installUrlDraft();
  const render = createRenderSpy();
  imageReuseHandler = async () => {
    throw new Error("The local project repo is not available yet.");
  };
  invokeHandler = async () => ({ status: "saved", rowId: "row-1", languageCode: "vi" });

  await submitEditorImageUrl(render, "row-1", "vi");
  await waitForInvoke("save_gtms_editor_language_image_url");

  assert.equal(state.editorChapter.imageReuseModal.isOpen, false);
  assert.equal(invokeLog.at(-1)?.command, "save_gtms_editor_language_image_url");
});

test("uploads are checked by name, size and SHA-256 and inserted after confirmation", async () => {
  installEditorFixture();
  installUploadEditor();
  const render = createRenderSpy();
  const { createHash } = await import("node:crypto");
  const sha256 = createHash("sha256").update(Uint8Array.from([137, 80, 78, 71])).digest("hex");
  reportImageReuse(`upload:${sha256}`, [{ chapterId: "chapter-1", title: "Chapter 1" }]);
  invokeHandler = async () => ({ status: "saved", rowId: "row-1", languageCode: "vi" });

  await withUploadMocks(async () => {
    await handleDroppedEditorImageFile(render, "row-1", "vi", separatorUpload(), { updateEditorChapterRow });

    assert.deepEqual(imageReuseLog[0]?.payload.input.image, {
      kind: "upload",
      fileName: "separator.png",
      byteLength: 4,
      sha256,
    });
    assert.equal(state.editorChapter.imageReuseModal.isOpen, true);
    assert.equal(state.editorChapter.imageEditor.status, "saving");
    assert.equal(invokeLog.length, 0);

    await confirmEditorImageReuse(render);
    await waitForInvoke("upload_gtms_editor_language_image");
  });

  assert.equal(invokeLog.at(-1)?.command, "upload_gtms_editor_language_image");
  assert.equal(invokeLog.at(-1)?.payload.input.filename, "separator.png");
});

test("cancelling a reused upload returns to the idle upload editor without uploading", async () => {
  installEditorFixture();
  installUploadEditor();
  const render = createRenderSpy();
  reportImageReuse("upload:abc", [{ chapterId: "chapter-1", title: "Chapter 1" }]);

  await withUploadMocks(async () => {
    await handleDroppedEditorImageFile(render, "row-1", "vi", separatorUpload(), { updateEditorChapterRow });
    cancelEditorImageReuse(render);
  });

  assert.equal(state.editorChapter.imageReuseModal.isOpen, false);
  assert.equal(state.editorChapter.imageEditor.mode, "upload");
  assert.equal(state.editorChapter.imageEditor.status, "idle");
  assert.equal(invokeLog.length, 0);
});
