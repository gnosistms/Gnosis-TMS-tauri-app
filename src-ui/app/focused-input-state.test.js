import test from "node:test";
import assert from "node:assert/strict";

class FakeElement {
  constructor() {
    this.dataset = {};
    this.disabled = false;
  }

  matches() {
    return false;
  }
}

class FakeHTMLElement extends FakeElement {
  focus() {}
}

class FakeHTMLInputElement extends FakeHTMLElement {}
class FakeHTMLSelectElement extends FakeHTMLElement {}

class FakeHTMLTextAreaElement extends FakeHTMLElement {
  constructor() {
    super();
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.selectionDirection = "none";
    this.focusCalls = [];
    this.selectionCalls = [];
  }

  focus(options = {}) {
    this.focusCalls.push(options);
  }

  setSelectionRange(start, end, direction) {
    this.selectionCalls.push({ start, end, direction });
  }
}

globalThis.Element = FakeElement;
globalThis.HTMLElement = FakeHTMLElement;
globalThis.HTMLInputElement = FakeHTMLInputElement;
globalThis.HTMLSelectElement = FakeHTMLSelectElement;
globalThis.HTMLTextAreaElement = FakeHTMLTextAreaElement;
globalThis.CSS = {
  escape(value) {
    return String(value);
  },
};

let selectorMap = new Map();

globalThis.document = {
  activeElement: null,
  querySelector(selector) {
    return selectorMap.get(selector) ?? null;
  },
};

const {
  captureFocusedInputState,
  restoreFocusedInputState,
} = await import("./focused-input-state.js");

function createEditorTextarea({ rowId, languageCode, contentKind = null } = {}) {
  const textarea = new FakeHTMLTextAreaElement();
  textarea.dataset.rowId = rowId;
  textarea.dataset.languageCode = languageCode;
  if (contentKind) {
    textarea.dataset.contentKind = contentKind;
  }
  textarea.matches = (selector) => {
    if (selector === "[data-editor-row-field]") {
      return true;
    }

    if (selector === "[data-editor-replace-row-select]") {
      return false;
    }

    return false;
  };
  return textarea;
}

test("captureFocusedInputState preserves image-caption field identity", () => {
  const textarea = createEditorTextarea({
    rowId: "row-1",
    languageCode: "vi",
    contentKind: "image-caption",
  });
  textarea.selectionStart = 3;
  textarea.selectionEnd = 5;
  textarea.selectionDirection = "forward";
  document.activeElement = textarea;

  const snapshot = captureFocusedInputState();

  assert.deepEqual(snapshot, {
    kind: "editor-row-field",
    selector: '[data-editor-row-field][data-row-id="row-1"][data-language-code="vi"][data-content-kind="image-caption"]',
    rowId: "row-1",
    languageCode: "vi",
    contentKind: "image-caption",
    selectionStart: 3,
    selectionEnd: 5,
    selectionDirection: "forward",
  });
});

test("restoreFocusedInputState restores focus to the image-caption field instead of the main field", () => {
  const mainField = createEditorTextarea({
    rowId: "row-1",
    languageCode: "vi",
  });
  const imageCaptionField = createEditorTextarea({
    rowId: "row-1",
    languageCode: "vi",
    contentKind: "image-caption",
  });
  selectorMap = new Map([
    ['[data-editor-row-field][data-row-id="row-1"][data-language-code="vi"]:not([data-content-kind])', mainField],
    ['[data-editor-row-field][data-row-id="row-1"][data-language-code="vi"][data-content-kind="image-caption"]', imageCaptionField],
  ]);

  const restored = restoreFocusedInputState({
    selector: '[data-editor-row-field][data-row-id="row-1"][data-language-code="vi"][data-content-kind="image-caption"]',
    selectionStart: 1,
    selectionEnd: 4,
    selectionDirection: "backward",
  });

  assert.equal(restored, true);
  assert.deepEqual(mainField.focusCalls, []);
  assert.deepEqual(imageCaptionField.focusCalls, [{ preventScroll: true }]);
  assert.deepEqual(imageCaptionField.selectionCalls, [{
    start: 1,
    end: 4,
    direction: "backward",
  }]);
});
