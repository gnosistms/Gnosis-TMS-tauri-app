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

class FakeHTMLInputElement extends FakeHTMLElement {
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
  shouldRestoreFocusedInputStateForScope,
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

test("chapter rename modal input focus survives full refresh renders", () => {
  const input = new FakeHTMLInputElement();
  input.selectionStart = 7;
  input.selectionEnd = 11;
  input.selectionDirection = "forward";
  input.matches = (selector) => selector === "[data-chapter-rename-input]";
  document.activeElement = input;

  const snapshot = captureFocusedInputState();
  assert.deepEqual(snapshot, {
    kind: "generic",
    selector: "[data-chapter-rename-input]",
    rowId: "",
    languageCode: "",
    contentKind: "field",
    selectionStart: 7,
    selectionEnd: 11,
    selectionDirection: "forward",
  });

  const nextInput = new FakeHTMLInputElement();
  selectorMap = new Map([["[data-chapter-rename-input]", nextInput]]);

  assert.equal(shouldRestoreFocusedInputStateForScope(snapshot, "full"), true);
  assert.equal(restoreFocusedInputState(snapshot), true);
  assert.deepEqual(nextInput.focusCalls, [{ preventScroll: true }]);
  assert.deepEqual(nextInput.selectionCalls, [{
    start: 7,
    end: 11,
    direction: "forward",
  }]);
});

test("shouldRestoreFocusedInputStateForScope skips editor-row-field focus restore for sidebar and header renders", () => {
  const editorFieldSnapshot = {
    kind: "editor-row-field",
    selector: '[data-editor-row-field][data-row-id="row-1"][data-language-code="vi"]',
    rowId: "row-1",
    languageCode: "vi",
    contentKind: "field",
    selectionStart: 0,
    selectionEnd: 0,
    selectionDirection: "none",
  };

  assert.equal(
    shouldRestoreFocusedInputStateForScope(editorFieldSnapshot, "translate-sidebar"),
    false,
  );
  assert.equal(
    shouldRestoreFocusedInputStateForScope(editorFieldSnapshot, "translate-header"),
    false,
  );
  assert.equal(
    shouldRestoreFocusedInputStateForScope(editorFieldSnapshot, "translate-body"),
    true,
  );
  assert.equal(
    shouldRestoreFocusedInputStateForScope(editorFieldSnapshot, "full"),
    true,
  );
  assert.equal(
    shouldRestoreFocusedInputStateForScope({
      kind: "generic",
      selector: "[data-editor-search-input]",
    }, "translate-sidebar"),
    true,
  );
  assert.equal(shouldRestoreFocusedInputStateForScope(null, "translate-sidebar"), false);
});
