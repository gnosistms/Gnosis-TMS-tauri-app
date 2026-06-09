import test from "node:test";
import assert from "node:assert/strict";

import {
  createQaTermEditorState,
  resetSessionState,
  state,
} from "./state.js";

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...tokens) {
    tokens.forEach((token) => this.values.add(token));
  }

  remove(...tokens) {
    tokens.forEach((token) => this.values.delete(token));
  }

  toggle(token, force) {
    if (force === true) {
      this.values.add(token);
      return true;
    }
    if (force === false) {
      this.values.delete(token);
      return false;
    }
    if (this.values.has(token)) {
      this.values.delete(token);
      return false;
    }
    this.values.add(token);
    return true;
  }

  contains(token) {
    return this.values.has(token);
  }
}

class FakeHTMLElement {
  constructor(dataset = {}) {
    this.dataset = dataset;
    this.classList = new FakeClassList();
    this.attributes = new Map();
    this.disabled = false;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
}

const originalHTMLElement = globalThis.HTMLElement;
const originalDocument = globalThis.document;
const originalWindow = globalThis.window;

globalThis.HTMLElement = FakeHTMLElement;
globalThis.document = {
  querySelector() {
    return null;
  },
};
globalThis.window = {
  __TAURI__: {},
  localStorage: {
    getItem() {
      return null;
    },
    setItem() {},
    removeItem() {},
    key() {
      return null;
    },
    get length() {
      return 0;
    },
  },
  requestAnimationFrame(callback) {
    callback();
    return 1;
  },
};

const {
  syncQaTermInlineStyleButtons,
  toggleQaTermInlineStyle,
} = await import("./qa-term-inline-markup-flow.js");

test.afterEach(() => {
  resetSessionState();
});

test.after(() => {
  globalThis.HTMLElement = originalHTMLElement;
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
});

function createButton() {
  return new FakeHTMLElement({
    qaTermInlineStyleButton: "",
    inlineStyle: "ruby",
  });
}

function createTextarea({ languageCode, value, selectionStart, selectionEnd }) {
  return {
    dataset: {
      qaTermTextInput: "",
      languageCode,
    },
    value,
    selectionStart,
    selectionEnd,
    selectionDirection: "none",
    disabled: false,
    readOnly: false,
    setSelectionRange(nextStart, nextEnd, nextDirection = "none") {
      this.selectionStart = nextStart;
      this.selectionEnd = nextEnd;
      this.selectionDirection = nextDirection;
    },
  };
}

function createDocument(activeElement, buttons) {
  return {
    activeElement,
    querySelectorAll(selector) {
      return selector === "[data-qa-term-inline-style-button]" ? buttons : [];
    },
  };
}

test("QA term ruby buttons are disabled when no QA text textarea is focused", () => {
  const button = createButton();
  const doc = createDocument(null, [button]);

  syncQaTermInlineStyleButtons(doc);

  assert.equal(button.getAttribute("aria-disabled"), "true");
  assert.equal(button.classList.contains("is-disabled"), true);
  assert.equal(button.classList.contains("is-active"), false);
  assert.equal(button.getAttribute("aria-pressed"), "false");
  assert.equal(button.tabIndex, -1);
});

test("QA term ruby button toggles the focused text textarea and updates the text draft", () => {
  const button = createButton();
  const textarea = createTextarea({
    languageCode: "ja",
    value: "<ruby>term<rt>reading</rt></ruby>",
    selectionStart: 6,
    selectionEnd: 6,
  });
  const doc = createDocument(textarea, [button]);
  const autosizeCalls = [];
  state.qaTermEditor = {
    ...createQaTermEditorState(),
    isOpen: true,
    text: textarea.value,
  };

  const changed = toggleQaTermInlineStyle(button, {
    document: doc,
    syncAutoSizeTextarea(input, options) {
      autosizeCalls.push({ value: input.value, options });
    },
  });

  assert.equal(changed, true);
  assert.equal(textarea.value, "term");
  assert.equal(textarea.selectionStart, 0);
  assert.equal(textarea.selectionEnd, 4);
  assert.equal(state.qaTermEditor.text, "term");
  assert.deepEqual(autosizeCalls, [{
    value: "term",
    options: {
      minHeight: 44,
      maxHeight: 132,
    },
  }]);
});
