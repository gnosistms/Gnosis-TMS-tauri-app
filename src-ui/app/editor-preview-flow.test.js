import test from "node:test";
import assert from "node:assert/strict";

import { EDITOR_ROW_FILTER_MODE_SHOW_ALL } from "./editor-filters.js";
import { EDITOR_MODE_PREVIEW, EDITOR_MODE_TRANSLATE } from "./editor-preview.js";
import {
  buildTranslateAnchorForPreviewBlock,
  jumpFromPreviewBlockToTranslateMode,
  updateEditorPreviewLanguage,
} from "./editor-preview-flow.js";
import {
  pendingTranslateAnchorRowId,
  queueTranslateRowAnchor,
  readPendingTranslateAnchor,
} from "./scroll-state.js";
import {
  clearStoredEditorLocation,
  clearStoredEditorPreviewLanguageCode,
  loadStoredEditorLocation,
  loadStoredEditorPreviewLanguageCode,
} from "./editor-preferences.js";
import { setActiveStorageLogin } from "./team-storage.js";
import {
  createEditorChapterState,
  resetSessionState,
  state,
} from "./state.js";

const originalWindow = globalThis.window;
const originalElement = globalThis.Element;
const originalHTMLElement = globalThis.HTMLElement;

function installWindow() {
  globalThis.window = {
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
  };
}

class FakeElement {}

class FakeHTMLElement extends FakeElement {
  constructor({ dataset = {}, lang = "", rect = {}, scrollContainer = null } = {}) {
    super();
    this.dataset = dataset;
    this.lang = lang;
    this.rect = {
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      width: 0,
      height: 0,
      ...rect,
    };
    this.scrollContainer = scrollContainer;
  }

  getAttribute(name) {
    return name === "lang" ? this.lang : null;
  }

  closest(selector) {
    return selector === ".translate-main-scroll" ? this.scrollContainer : null;
  }

  getBoundingClientRect() {
    return this.rect;
  }
}

function installDomClasses() {
  globalThis.Element = FakeElement;
  globalThis.HTMLElement = FakeHTMLElement;
}

function previewBlockFixture({ rowId = "row-1", lang = "vi", blockTop = 180, containerTop = 100 } = {}) {
  const scrollContainer = new FakeHTMLElement({
    rect: {
      top: containerTop,
      bottom: containerTop + 400,
      left: 0,
      right: 600,
      width: 600,
      height: 400,
    },
  });
  return new FakeHTMLElement({
    dataset: {
      rowId,
    },
    lang,
    rect: {
      top: blockTop,
      bottom: blockTop + 40,
      left: 0,
      right: 600,
      width: 600,
      height: 40,
    },
    scrollContainer,
  });
}

test.afterEach(() => {
  queueTranslateRowAnchor(null);
  resetSessionState();
  globalThis.window = originalWindow;
  globalThis.Element = originalElement;
  globalThis.HTMLElement = originalHTMLElement;
  setActiveStorageLogin(null);
});

test("preview language selection can show every chapter language without changing editor selections", () => {
  installWindow();
  state.editorChapter = {
    ...createEditorChapterState(),
    mode: EDITOR_MODE_PREVIEW,
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "vi", name: "Vietnamese", role: "target" },
      { code: "ja", name: "Japanese", role: "target" },
    ],
    selectedSourceLanguageCode: "es",
    selectedTargetLanguageCode: "vi",
    rows: [{
      rowId: "row-1",
      lifecycleState: "active",
      textStyle: "paragraph",
      fields: {
        es: "Texto fuente",
        vi: "Translated text",
        ja: "Japanese preview text",
      },
    }],
  };

  for (const code of ["es", "vi", "ja"]) {
    updateEditorPreviewLanguage(() => {}, code);

    assert.equal(state.editorChapter.previewLanguageCode, code);
    assert.equal(state.editorChapter.selectedSourceLanguageCode, "es");
    assert.equal(state.editorChapter.selectedTargetLanguageCode, "vi");
  }

  updateEditorPreviewLanguage(() => {}, "not-a-language");
  assert.equal(state.editorChapter.previewLanguageCode, "ja");
});

test("preview language selection saves a chapter-scoped non-default override", () => {
  installWindow();
  const login = "preview-language-flow";
  const chapterId = "chapter-preview-language";
  setActiveStorageLogin(login);
  clearStoredEditorPreviewLanguageCode(chapterId, login);
  state.editorChapter = {
    ...createEditorChapterState(),
    chapterId,
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
      fields: {
        es: "Texto fuente",
        vi: "Translated text",
      },
    }],
  };

  try {
    updateEditorPreviewLanguage(() => {}, "es");

    assert.equal(state.editorChapter.previewLanguageCode, "es");
    assert.equal(loadStoredEditorPreviewLanguageCode(chapterId, login), "es");

    updateEditorPreviewLanguage(() => {}, "vi");

    assert.equal(state.editorChapter.previewLanguageCode, "vi");
    assert.equal(loadStoredEditorPreviewLanguageCode(chapterId, login), null);
  } finally {
    clearStoredEditorPreviewLanguageCode(chapterId, login);
  }
});

test("buildTranslateAnchorForPreviewBlock maps preview metadata to a translate language-panel anchor", () => {
  installDomClasses();
  state.editorChapter = {
    ...createEditorChapterState(),
    mode: EDITOR_MODE_PREVIEW,
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "vi", name: "Vietnamese", role: "target" },
    ],
    selectedTargetLanguageCode: "vi",
  };

  assert.deepEqual(
    buildTranslateAnchorForPreviewBlock(previewBlockFixture({
      rowId: "row-target",
      lang: "vi",
      blockTop: 175,
      containerTop: 95,
    })),
    {
      rowId: "row-target",
      type: "language-panel",
      languageCode: "vi",
      offsetTop: 80,
    },
  );
});

test("buildTranslateAnchorForPreviewBlock falls back to a row anchor for unavailable languages", () => {
  installDomClasses();
  state.editorChapter = {
    ...createEditorChapterState(),
    mode: EDITOR_MODE_PREVIEW,
    languages: [
      { code: "vi", name: "Vietnamese", role: "target" },
    ],
    selectedTargetLanguageCode: "vi",
  };

  assert.deepEqual(
    buildTranslateAnchorForPreviewBlock(previewBlockFixture({
      rowId: "row-target",
      lang: "missing",
    })),
    {
      rowId: "row-target",
      type: "row",
      languageCode: null,
      offsetTop: 80,
    },
  );
});

test("jumpFromPreviewBlockToTranslateMode switches to translate and replaces the saved anchor", () => {
  installWindow();
  installDomClasses();
  const login = "editor-preview-jump";
  const chapterId = "chapter-preview-jump";
  setActiveStorageLogin(login);
  clearStoredEditorLocation(chapterId, login);
  let renderCount = 0;
  state.screen = "translate";
  state.editorChapter = {
    ...createEditorChapterState(),
    status: "ready",
    chapterId,
    mode: EDITOR_MODE_PREVIEW,
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "vi", name: "Vietnamese", role: "target" },
    ],
    selectedTargetLanguageCode: "vi",
    filters: {
      searchQuery: "filtered",
      caseSensitive: false,
      rowFilterMode: "needs-review",
    },
    rows: [
      { rowId: "row-target", lifecycleState: "active", fields: { vi: "Target" } },
    ],
  };

  const jumped = jumpFromPreviewBlockToTranslateMode(
    () => {
      renderCount += 1;
    },
    previewBlockFixture({
      rowId: "row-target",
      lang: "vi",
      blockTop: 210,
      containerTop: 90,
    }),
  );

  assert.equal(jumped, true);
  assert.equal(renderCount, 1);
  assert.equal(state.editorChapter.mode, EDITOR_MODE_TRANSLATE);
  assert.equal(state.editorChapter.filters.searchQuery, "");
  assert.equal(state.editorChapter.filters.rowFilterMode, EDITOR_ROW_FILTER_MODE_SHOW_ALL);
  assert.equal(pendingTranslateAnchorRowId(), "row-target");
  assert.deepEqual(readPendingTranslateAnchor(), {
    rowId: "row-target",
    languageCode: "vi",
    offsetTop: 120,
    type: "language-panel",
  });
  assert.deepEqual(loadStoredEditorLocation(chapterId, login), {
    type: "language-panel",
    rowId: "row-target",
    languageCode: "vi",
    offsetTop: 120,
  });

  clearStoredEditorLocation(chapterId, login);
});
