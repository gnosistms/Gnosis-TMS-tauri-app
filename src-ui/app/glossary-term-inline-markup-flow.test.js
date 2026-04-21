import test from "node:test";
import assert from "node:assert/strict";

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
  syncGlossaryTermInlineStyleButtons,
  toggleGlossaryTermInlineStyle,
} = await import("./glossary-term-inline-markup-flow.js");

function createButton(side) {
  return new FakeHTMLElement({
    glossaryInlineStyleButton: "",
    inlineStyle: "ruby",
    variantSide: side,
  });
}

function createTextarea({ side, index, languageCode, value, selectionStart, selectionEnd }) {
  const textarea = {
    dataset: {
      variantSide: side,
      variantIndex: String(index),
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
  return textarea;
}

function createDocument(activeElement, buttons) {
  return {
    activeElement,
    querySelectorAll(selector) {
      return selector === "[data-glossary-inline-style-button]" ? buttons : [];
    },
  };
}

test("glossary ruby buttons are disabled when no variant textarea is focused", () => {
  const sourceButton = createButton("source");
  const targetButton = createButton("target");
  const doc = createDocument(null, [sourceButton, targetButton]);

  syncGlossaryTermInlineStyleButtons(doc);

  assert.equal(sourceButton.disabled, true);
  assert.equal(targetButton.disabled, true);
  assert.equal(sourceButton.classList.contains("is-active"), false);
  assert.equal(targetButton.classList.contains("is-active"), false);
  assert.equal(sourceButton.getAttribute("aria-pressed"), "false");
  assert.equal(targetButton.getAttribute("aria-pressed"), "false");
});

test("glossary ruby buttons enable only for the focused side and light up inside ruby", () => {
  const sourceButton = createButton("source");
  const targetButton = createButton("target");
  const textarea = createTextarea({
    side: "source",
    index: 0,
    languageCode: "ja",
    value: "<ruby>漢字<rt>よみ</rt></ruby>",
    selectionStart: 8,
    selectionEnd: 8,
  });
  const doc = createDocument(textarea, [sourceButton, targetButton]);

  syncGlossaryTermInlineStyleButtons(doc);

  assert.equal(sourceButton.disabled, false);
  assert.equal(targetButton.disabled, true);
  assert.equal(sourceButton.classList.contains("is-active"), true);
  assert.equal(sourceButton.getAttribute("aria-pressed"), "true");
});

test("glossary ruby button toggles ruby on the focused variant textarea and updates draft state", () => {
  const sourceButton = createButton("source");
  const textarea = createTextarea({
    side: "source",
    index: 1,
    languageCode: "ja",
    value: "<ruby>漢字<rt>よみ</rt></ruby>",
    selectionStart: 8,
    selectionEnd: 8,
  });
  const doc = createDocument(textarea, [sourceButton]);
  const updates = [];
  const autosizeCalls = [];

  const changed = toggleGlossaryTermInlineStyle(sourceButton, {
    document: doc,
    updateGlossaryTermVariant(side, index, value) {
      updates.push({ side, index, value });
    },
    syncAutoSizeTextarea(input) {
      autosizeCalls.push(input.value);
    },
  });

  assert.equal(changed, true);
  assert.equal(textarea.value, "漢字");
  assert.equal(textarea.selectionStart, 0);
  assert.equal(textarea.selectionEnd, 2);
  assert.deepEqual(updates, [{
    side: "source",
    index: 1,
    value: "漢字",
  }]);
  assert.deepEqual(autosizeCalls, ["漢字"]);
});
