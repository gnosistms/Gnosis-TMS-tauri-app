import test from "node:test";
import assert from "node:assert/strict";

const localStorageState = new Map();
const invokeLog = [];
let invokeHandler = async () => null;

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
globalThis.navigator = {
  platform: "MacIntel",
  userAgentData: null,
};
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
  dismissActiveIdleEditorImageUpload,
  handleDroppedEditorImageFile,
  handleDroppedEditorImagePath,
  closeEditorImagePreview,
  openEditorImagePreview,
  openEditorImageUrl,
  submitEditorImageUrl,
  updateEditorImageUrlDraft,
} = await import("./editor-image-flow.js");

function installEditorFixture() {
  resetSessionState();
  invokeLog.length = 0;
  invokeHandler = async () => null;
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
  });
  assert.deepEqual(render.calls, [[{ scope: "translate-image-preview-overlay" }]]);
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
  assert.deepEqual(render.calls, [[{ scope: "translate-body" }]]);
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
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(state.editorChapter.imageEditor.status, "submitting");
  assert.equal(state.editorChapter.imageEditor.mode, "url");
  assert.equal(render.calls.length, 1);
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
  await Promise.resolve();
  await Promise.resolve();
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
  assert.deepEqual(render.calls, [[{ scope: "translate-body" }]]);
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
