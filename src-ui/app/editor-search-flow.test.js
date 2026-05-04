import test from "node:test";
import assert from "node:assert/strict";

import { buildEditorShowRowInContextChapterState } from "./editor-show-context.js";
import {
  updateEditorRowFilterMode,
  updateEditorSearchFilterQuery,
} from "./editor-search-flow.js";
import { createEditorChapterState, state } from "./state.js";

class FakeElement {
  constructor(options = {}) {
    this.dataset = options.dataset ?? {};
    this.scrollTop = options.scrollTop ?? 0;
    this.scrollLeft = options.scrollLeft ?? 0;
    this.clientHeight = options.clientHeight ?? 600;
    this.rect = options.rect ?? {
      top: 0,
      bottom: this.clientHeight,
      height: this.clientHeight,
    };
  }

  getBoundingClientRect() {
    return this.rect;
  }

  closest() {
    return null;
  }
}

function installTranslateScrollDom(options = {}) {
  const previousGlobals = {
    CSS: globalThis.CSS,
    document: globalThis.document,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    window: globalThis.window,
  };
  const container = new FakeElement({
    scrollTop: options.scrollTop ?? 480,
    scrollLeft: options.scrollLeft ?? 0,
    clientHeight: 600,
    rect: {
      top: 0,
      bottom: 600,
      height: 600,
    },
  });
  const rowTop = options.rowTop ?? 80;
  const row = new FakeElement({
    dataset: {
      rowId: options.rowId ?? "row-10",
    },
    rect: {
      top: rowTop,
      bottom: rowTop + 60,
      height: 60,
    },
  });

  globalThis.CSS = {
    escape(value) {
      return String(value);
    },
  };
  globalThis.Element = FakeElement;
  globalThis.HTMLElement = FakeElement;
  globalThis.document = {
    activeElement: null,
    querySelector(selector) {
      if (selector === ".translate-main-scroll") {
        return container;
      }
      if (selector.includes("[data-editor-row-card]")) {
        return row;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-editor-row-card]") {
        return [row];
      }
      if (
        selector === "[data-editor-language-panel]"
        || selector === "[data-editor-deleted-group]"
      ) {
        return [];
      }
      return [];
    },
  };
  globalThis.window = {
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
  };

  return {
    container,
    restore() {
      if (previousGlobals.CSS === undefined) {
        delete globalThis.CSS;
      } else {
        globalThis.CSS = previousGlobals.CSS;
      }
      if (previousGlobals.document === undefined) {
        delete globalThis.document;
      } else {
        globalThis.document = previousGlobals.document;
      }
      if (previousGlobals.Element === undefined) {
        delete globalThis.Element;
      } else {
        globalThis.Element = previousGlobals.Element;
      }
      if (previousGlobals.HTMLElement === undefined) {
        delete globalThis.HTMLElement;
      } else {
        globalThis.HTMLElement = previousGlobals.HTMLElement;
      }
      if (previousGlobals.window === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = previousGlobals.window;
      }
    },
  };
}

async function flushPaintWork() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

test("buildEditorShowRowInContextChapterState clears filters and disables replace", () => {
  const chapterState = {
    ...createEditorChapterState(),
    filters: {
      searchQuery: "distintos",
      caseSensitive: true,
      rowFilterMode: "reviewed",
    },
    replace: {
      enabled: true,
      replaceQuery: "nuevos",
      selectedRowIds: new Set(["row-1", "row-2"]),
      status: "saving",
      error: "old error",
    },
  };

  const nextState = buildEditorShowRowInContextChapterState(chapterState);

  assert.equal(nextState.filters.searchQuery, "");
  assert.equal(nextState.filters.caseSensitive, true);
  assert.equal(nextState.filters.rowFilterMode, "show-all");
  assert.equal(nextState.replace.enabled, false);
  assert.equal(nextState.replace.replaceQuery, "nuevos");
  assert.deepEqual([...nextState.replace.selectedRowIds], []);
  assert.equal(nextState.replace.status, "idle");
  assert.equal(nextState.replace.error, "");
});

test("updateEditorSearchFilterQuery restores the pre-search viewport when search is cleared", async () => {
  const previousEditorChapter = state.editorChapter;
  const dom = installTranslateScrollDom({ scrollTop: 480 });
  try {
    state.editorChapter = {
      ...createEditorChapterState(),
      chapterId: "chapter-1",
      filters: {
        searchQuery: "",
        caseSensitive: false,
        rowFilterMode: "show-all",
      },
    };

    let renderCount = 0;
    updateEditorSearchFilterQuery(() => {
      renderCount += 1;
    }, "needle");
    await flushPaintWork();

    assert.equal(renderCount, 1);
    assert.equal(dom.container.scrollTop, 0);

    dom.container.scrollTop = 25;
    updateEditorSearchFilterQuery(() => {
      renderCount += 1;
    }, "");
    await flushPaintWork();

    assert.equal(renderCount, 2);
    assert.equal(dom.container.scrollTop, 480);
  } finally {
    state.editorChapter = previousEditorChapter;
    dom.restore();
  }
});

test("updateEditorRowFilterMode restores the pre-filter viewport when returning to show all", async () => {
  const previousEditorChapter = state.editorChapter;
  const dom = installTranslateScrollDom({ scrollTop: 520 });
  try {
    state.editorChapter = {
      ...createEditorChapterState(),
      chapterId: "chapter-2",
      filters: {
        searchQuery: "",
        caseSensitive: false,
        rowFilterMode: "show-all",
      },
    };

    let renderCount = 0;
    updateEditorRowFilterMode(() => {
      renderCount += 1;
    }, "reviewed");
    await flushPaintWork();

    assert.equal(renderCount, 1);
    assert.equal(dom.container.scrollTop, 0);

    dom.container.scrollTop = 33;
    updateEditorRowFilterMode(() => {
      renderCount += 1;
    }, "show-all");
    await flushPaintWork();

    assert.equal(renderCount, 2);
    assert.equal(dom.container.scrollTop, 520);
  } finally {
    state.editorChapter = previousEditorChapter;
    dom.restore();
  }
});
