import test from "node:test";
import assert from "node:assert/strict";

import {
  pendingTranslateAnchorRowId,
  queueTranslateRowAnchor,
} from "./scroll-state.js";
import {
  clearStoredEditorLocation,
  loadStoredEditorLocation,
  saveStoredEditorLocation,
} from "./editor-preferences.js";
import { setActiveStorageLogin } from "./team-storage.js";
import {
  prepareEditorLocationBeforeRender,
  queuePendingEditorLocationRestore,
  replaceCurrentEditorLocation,
  skipNextEditorLocationRestore,
} from "./editor-location.js";

class FakeElement {}

class FakeHTMLElement extends FakeElement {
  constructor(rect, options = {}) {
    super();
    this.rect = rect;
    this.dataset = options.dataset ?? {};
    this.scrollTop = options.scrollTop ?? 0;
  }

  getBoundingClientRect() {
    return this.rect;
  }
}

globalThis.Element = FakeElement;
globalThis.HTMLElement = FakeHTMLElement;
globalThis.CSS = {
  escape(value) {
    return String(value);
  },
};

function installVisibleEditorLocationFixture({ panelTop = 180, scrollTop = 345 } = {}) {
  const container = new FakeHTMLElement(
    {
      top: 100,
      bottom: 500,
      left: 0,
      right: 600,
      width: 600,
      height: 400,
    },
    {
      scrollTop,
    },
  );
  const panel = new FakeHTMLElement(
    {
      top: panelTop,
      bottom: panelTop + 60,
      left: 0,
      right: 600,
      width: 600,
      height: 60,
    },
    {
      dataset: {
        rowId: "row-visible",
        languageCode: "vi",
      },
    },
  );

  globalThis.document = {
    activeElement: null,
    querySelector(selector) {
      return selector === ".translate-main-scroll" ? container : null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-editor-language-panel]") {
        return [panel];
      }
      return [];
    },
  };
}

function readyTranslateState(chapterId) {
  return {
    screen: "translate",
    editorChapter: {
      status: "ready",
      chapterId,
      mode: "translate",
      rows: [{ rowId: "row-1" }],
    },
  };
}

test("queuePendingEditorLocationRestore queues the saved row when restore is enabled", () => {
  const login = "editor-location-restore";
  const chapterId = "chapter-restore";
  setActiveStorageLogin(login);
  queueTranslateRowAnchor(null);
  saveStoredEditorLocation(chapterId, {
    rowId: "row-saved",
    languageCode: "en",
    offsetTop: 12,
  }, login);

  queuePendingEditorLocationRestore(readyTranslateState(chapterId));

  assert.equal(pendingTranslateAnchorRowId(), "row-saved");

  queueTranslateRowAnchor(null);
  setActiveStorageLogin(null);
});

test("queuePendingEditorLocationRestore ignores preview mode", () => {
  const login = "editor-location-preview";
  const chapterId = "chapter-preview";
  setActiveStorageLogin(login);
  queueTranslateRowAnchor(null);
  saveStoredEditorLocation(chapterId, {
    rowId: "row-saved",
    languageCode: "en",
    offsetTop: 12,
  }, login);

  queuePendingEditorLocationRestore({
    screen: "translate",
    editorChapter: {
      status: "ready",
      chapterId,
      mode: "preview",
      rows: [{ rowId: "row-1" }],
    },
  });

  assert.equal(pendingTranslateAnchorRowId(), "");

  queueTranslateRowAnchor(null);
  setActiveStorageLogin(null);
});

test("replaceCurrentEditorLocation saves a preview-mode anchor without stale scrollTop", () => {
  const login = "editor-location-replace-preview";
  const chapterId = "chapter-replace-preview";
  setActiveStorageLogin(login);
  queueTranslateRowAnchor(null);
  saveStoredEditorLocation(chapterId, {
    type: "row",
    rowId: "old-row",
    languageCode: "en",
    offsetTop: 14,
    scrollTop: 999,
  }, login);

  const replaced = replaceCurrentEditorLocation({
    screen: "translate",
    editorChapter: {
      status: "ready",
      chapterId,
      mode: "preview",
      rows: [{ rowId: "row-1" }],
    },
  }, {
    type: "language-panel",
    rowId: "row-1",
    languageCode: "vi",
    offsetTop: 72,
    scrollTop: 123,
  });

  assert.equal(replaced, true);
  assert.deepEqual(loadStoredEditorLocation(chapterId, login), {
    type: "language-panel",
    rowId: "row-1",
    languageCode: "vi",
    offsetTop: 72,
  });

  clearStoredEditorLocation(chapterId, login);
  setActiveStorageLogin(null);
});

test("skipNextEditorLocationRestore bypasses the saved row restore for that chapter", () => {
  const login = "editor-location-skip";
  const chapterId = "chapter-skip";
  setActiveStorageLogin(login);
  queueTranslateRowAnchor(null);
  saveStoredEditorLocation(chapterId, {
    rowId: "row-saved",
    languageCode: "en",
    offsetTop: 12,
  }, login);

  skipNextEditorLocationRestore(chapterId);
  queuePendingEditorLocationRestore(readyTranslateState(chapterId));

  assert.equal(pendingTranslateAnchorRowId(), "");

  queueTranslateRowAnchor(null);
  setActiveStorageLogin(null);
});

test("prepareEditorLocationBeforeRender saves the latest visible location when leaving the editor", () => {
  const login = "editor-location-leave";
  const chapterId = "chapter-leave";
  setActiveStorageLogin(login);
  clearStoredEditorLocation(chapterId, login);
  installVisibleEditorLocationFixture();

  prepareEditorLocationBeforeRender("translate", {
    screen: "glossaryEditor",
    editorChapter: {
      status: "ready",
      chapterId,
      mode: "translate",
      rows: [{ rowId: "row-visible" }],
    },
  });

  assert.deepEqual(loadStoredEditorLocation(chapterId, login), {
    type: "language-panel",
    rowId: "row-visible",
    languageCode: "vi",
    offsetTop: 80,
    scrollTop: 345,
  });

  clearStoredEditorLocation(chapterId, login);
  setActiveStorageLogin(null);
});

test("prepareEditorLocationBeforeRender preserves partially scrolled offsets when leaving the editor", () => {
  const login = "editor-location-leave-partial";
  const chapterId = "chapter-leave-partial";
  setActiveStorageLogin(login);
  clearStoredEditorLocation(chapterId, login);
  installVisibleEditorLocationFixture({ panelTop: 72, scrollTop: 456 });

  prepareEditorLocationBeforeRender("translate", {
    screen: "glossaryEditor",
    editorChapter: {
      status: "ready",
      chapterId,
      mode: "translate",
      rows: [{ rowId: "row-visible" }],
    },
  });

  assert.deepEqual(loadStoredEditorLocation(chapterId, login), {
    type: "language-panel",
    rowId: "row-visible",
    languageCode: "vi",
    offsetTop: -28,
    scrollTop: 456,
  });

  clearStoredEditorLocation(chapterId, login);
  setActiveStorageLogin(null);
});

test("prepareEditorLocationBeforeRender does not overwrite pending restore during editor rerenders", () => {
  const login = "editor-location-same-screen";
  const chapterId = "chapter-same-screen";
  setActiveStorageLogin(login);
  clearStoredEditorLocation(chapterId, login);
  saveStoredEditorLocation(chapterId, {
    rowId: "row-saved",
    languageCode: "en",
    offsetTop: 12,
  }, login);
  installVisibleEditorLocationFixture();

  prepareEditorLocationBeforeRender("translate", {
    screen: "translate",
    editorChapter: {
      status: "ready",
      chapterId,
      mode: "translate",
      rows: [{ rowId: "row-visible" }],
    },
  });

  assert.deepEqual(loadStoredEditorLocation(chapterId, login), {
    rowId: "row-saved",
    languageCode: "en",
    offsetTop: 12,
  });

  clearStoredEditorLocation(chapterId, login);
  setActiveStorageLogin(null);
});
