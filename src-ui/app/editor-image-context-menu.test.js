import test from "node:test";
import assert from "node:assert/strict";

import {
  handleEditorImageContextMenuInvocationKeydown,
  handleEditorImageContextMenuKeydown,
  renderEditorImageContextMenuItems,
} from "./editor-image-context-menu.js";
import { createEditorChapterState, state } from "./state.js";

function installContextMenuFixture(image) {
  state.editorChapter = {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    languages: [
      { code: "vi", name: "Vietnamese" },
      { code: "es", name: "Spanish" },
      { code: "en", name: "English" },
    ],
    rows: [{
      rowId: "row-1",
      images: {
        vi: image,
        es: { kind: "url", url: "https://example.com/existing.png" },
      },
    }],
  };
}

test("image context menu puts Copy image URL first only for URL images", () => {
  installContextMenuFixture({ kind: "url", url: "https://example.com/source.png" });

  const html = renderEditorImageContextMenuItems("row-1", "vi");

  assert.ok(html.indexOf("Copy image URL") < html.indexOf("Duplicate to Spanish"));
  assert.match(html, /data-image-url="https:\/\/example\.com\/source\.png"/);
  assert.match(html, /Duplicate to Spanish/);
  assert.match(html, /Duplicate to English/);
  assert.doesNotMatch(html, /Duplicate to Vietnamese/);
});

test("uploaded image context menu omits URL copy and still lists occupied destinations", () => {
  installContextMenuFixture({
    kind: "upload",
    path: "chapters/chapter-1/images/source.png",
    filePath: "/tmp/source.png",
  });

  const html = renderEditorImageContextMenuItems("row-1", "vi");

  assert.doesNotMatch(html, /Copy image URL/);
  assert.match(html, /Duplicate to Spanish/);
  assert.match(html, /Duplicate to English/);
});

test("image context menu items use roving-focus menu semantics", () => {
  installContextMenuFixture({ kind: "url", url: "https://example.com/source.png" });

  const html = renderEditorImageContextMenuItems("row-1", "vi");

  assert.match(html, /role="menuitem"/);
  assert.equal((html.match(/tabindex="-1"/g) ?? []).length, 3);
});

test("image context menu Arrow, Home, and End keys move focus", () => {
  const PreviousHTMLElement = globalThis.HTMLElement;
  const PreviousHTMLButtonElement = globalThis.HTMLButtonElement;
  class FakeElement {}
  class FakeButton extends FakeElement {
    constructor() {
      super();
      this.disabled = false;
      this.focused = false;
    }

    focus() {
      this.focused = true;
    }
  }
  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLButtonElement = FakeButton;
  try {
    const items = [new FakeButton(), new FakeButton(), new FakeButton()];
    const menu = new FakeElement();
    menu.querySelectorAll = () => items;
    items[0].closest = () => menu;
    const root = { contains: (candidate) => candidate === menu };
    const event = {
      target: items[0],
      key: "End",
      preventDefault() {},
    };

    assert.equal(handleEditorImageContextMenuKeydown(root, event), true);
    assert.equal(items[2].focused, true);

    items[2].closest = () => menu;
    event.target = items[2];
    event.key = "ArrowDown";
    assert.equal(handleEditorImageContextMenuKeydown(root, event), true);
    assert.equal(items[0].focused, true);

    event.target = items[2];
    event.key = "Home";
    assert.equal(handleEditorImageContextMenuKeydown(root, event), true);
    assert.equal(items[0].focused, true);

    event.target = items[0];
    event.key = "ArrowUp";
    assert.equal(handleEditorImageContextMenuKeydown(root, event), true);
    assert.equal(items[2].focused, true);
  } finally {
    globalThis.HTMLElement = PreviousHTMLElement;
    globalThis.HTMLButtonElement = PreviousHTMLButtonElement;
  }
});

test("image context menu Escape dismisses the menu", () => {
  const PreviousHTMLElement = globalThis.HTMLElement;
  const PreviousHTMLButtonElement = globalThis.HTMLButtonElement;
  class FakeElement {}
  class FakeButton extends FakeElement {}
  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLButtonElement = FakeButton;
  try {
    let removed = false;
    const menu = new FakeElement();
    menu.querySelectorAll = () => [];
    menu.remove = () => {
      removed = true;
    };
    const item = new FakeButton();
    item.closest = () => menu;
    const root = {
      contains: (candidate) => candidate === menu,
      querySelector: () => menu,
    };
    const event = {
      target: item,
      key: "Escape",
      preventDefault() {},
      stopPropagation() {},
    };

    assert.equal(handleEditorImageContextMenuKeydown(root, event), true);
    assert.equal(removed, true);
  } finally {
    globalThis.HTMLElement = PreviousHTMLElement;
    globalThis.HTMLButtonElement = PreviousHTMLButtonElement;
  }
});

test("image context menu opens from the focused thumbnail with keyboard invocation", () => {
  const PreviousHTMLElement = globalThis.HTMLElement;
  class FakeElement {}
  globalThis.HTMLElement = FakeElement;
  try {
    const target = new FakeElement();
    target.closest = () => target;
    target.getBoundingClientRect = () => ({
      left: 40,
      top: 60,
      width: 80,
      height: 50,
    });
    const root = { contains: (candidate) => candidate === target };
    let openedAt = null;
    let prevented = false;
    let stopped = false;
    const event = {
      target,
      key: "F10",
      shiftKey: true,
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {
        stopped = true;
      },
    };

    assert.equal(
      handleEditorImageContextMenuInvocationKeydown(
        root,
        event,
        (_root, point, invoker) => {
          openedAt = { point, invoker };
          return true;
        },
      ),
      true,
    );
    assert.deepEqual(openedAt, {
      point: { clientX: 52, clientY: 72 },
      invoker: target,
    });
    assert.equal(prevented, true);
    assert.equal(stopped, true);
  } finally {
    globalThis.HTMLElement = PreviousHTMLElement;
  }
});
