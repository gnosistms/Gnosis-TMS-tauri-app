import test from "node:test";
import assert from "node:assert/strict";

let keydownHandler = null;
let activeSearchInput = null;

class FakeElement {}
class FakeHtmlElement extends FakeElement {}
class FakeInputElement extends FakeHtmlElement {
  constructor() {
    super();
    this.focusCalls = [];
    this.selectCount = 0;
  }

  focus(options) {
    this.focusCalls.push(options);
  }

  select() {
    this.selectCount += 1;
  }
}

globalThis.Element = FakeElement;
globalThis.HTMLElement = FakeHtmlElement;
globalThis.HTMLInputElement = FakeInputElement;
globalThis.HTMLTextAreaElement = class extends FakeHtmlElement {};
globalThis.HTMLSelectElement = class extends FakeHtmlElement {};

Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    platform: "MacIntel",
    userAgentData: null,
  },
});

globalThis.document = {
  querySelector(selector) {
    if (selector === "#app") {
      return null;
    }

    if (
      String(selector).includes("[data-project-search-input]")
      || String(selector).includes("[data-glossary-term-search-input]")
      || String(selector).includes("[data-editor-search-input]")
      || String(selector).includes("[data-preview-search-input]")
    ) {
      return activeSearchInput;
    }

    return null;
  },
  addEventListener(type, handler) {
    if (type === "keydown") {
      keydownHandler = handler;
    }
  },
};

globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async () => null,
    },
    event: {
      listen: async () => () => {},
    },
  },
};

const { registerKeyboardShortcutEvents } = await import("./events/keyboard-shortcuts.js");

function keyboardEvent(overrides = {}) {
  return {
    defaultPrevented: false,
    repeat: false,
    isComposing: false,
    key: "f",
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target: null,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    ...overrides,
  };
}

test("keyboard shortcuts focus the page search input on macOS Command+F", () => {
  activeSearchInput = new FakeInputElement();
  registerKeyboardShortcutEvents(async () => {});

  keydownHandler(keyboardEvent());

  assert.deepEqual(activeSearchInput.focusCalls, [{ preventScroll: true }]);
  assert.equal(activeSearchInput.selectCount, 1);
});

test("keyboard shortcuts focus the page search input on Windows Ctrl+F", () => {
  navigator.platform = "Win32";
  activeSearchInput = new FakeInputElement();
  registerKeyboardShortcutEvents(async () => {});
  const event = keyboardEvent({ metaKey: false, ctrlKey: true });

  keydownHandler(event);

  assert.equal(event.prevented, true);
  assert.deepEqual(activeSearchInput.focusCalls, [{ preventScroll: true }]);
  assert.equal(activeSearchInput.selectCount, 1);
});

test("keyboard shortcuts leave browser find alone when no page search input exists", () => {
  navigator.platform = "MacIntel";
  activeSearchInput = null;
  registerKeyboardShortcutEvents(async () => {});
  const event = keyboardEvent();

  keydownHandler(event);

  assert.equal(event.prevented, false);
});
