import test from "node:test";
import assert from "node:assert/strict";

class FakeElement {}

class FakeHTMLElement extends FakeElement {
  constructor(rect, options = {}) {
    super();
    this.rect = rect;
    this.dataset = options.dataset ?? {};
    this.scrollTop = options.scrollTop ?? 0;
    this.clientHeight = options.clientHeight ?? rect.height ?? 0;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  closest() {
    return null;
  }
}

globalThis.Element = FakeElement;
globalThis.HTMLElement = FakeHTMLElement;
globalThis.CSS = {
  escape(value) {
    return String(value);
  },
};

let selectors = new Map();

globalThis.document = {
  activeElement: null,
  querySelector(selector) {
    return selectors.get(selector) ?? null;
  },
  querySelectorAll() {
    return [];
  },
};

function installScrollFixture({ containerTop = 100, anchorTop = 140, scrollTop = 50 } = {}) {
  selectors = new Map();
  const container = new FakeHTMLElement(
    {
      top: containerTop,
      bottom: containerTop + 400,
      left: 0,
      right: 600,
      width: 600,
      height: 400,
    },
    {
      scrollTop,
      clientHeight: 400,
    },
  );
  const row = new FakeHTMLElement(
    {
      top: anchorTop,
      bottom: anchorTop + 80,
      left: 0,
      right: 600,
      width: 600,
      height: 80,
    },
    {
      dataset: {
        rowId: "row-1",
      },
    },
  );
  const field = new FakeHTMLElement(
    {
      top: anchorTop + 12,
      bottom: anchorTop + 52,
      left: 0,
      right: 600,
      width: 600,
      height: 40,
    },
    {
      dataset: {
        rowId: "row-1",
        languageCode: "en",
      },
    },
  );
  selectors.set(".translate-main-scroll", container);
  selectors.set('[data-editor-row-card][data-row-id="row-1"]', row);
  selectors.set(
    '[data-editor-row-field][data-row-id="row-1"][data-language-code="en"]',
    field,
  );
  return { container };
}

const {
  captureTranslateAnchorForRow,
  readPendingTranslateAnchor,
  queueTranslateRowAnchor,
  restoreTranslateRowAnchor,
} = await import("./scroll-state.js");

test("restoreTranslateRowAnchor skips no-op scroll writes", () => {
  const { container } = installScrollFixture();

  const restored = restoreTranslateRowAnchor({
    rowId: "row-1",
    offsetTop: 40,
  });

  assert.equal(restored, false);
  assert.equal(container.scrollTop, 50);
});

test("restoreTranslateRowAnchor updates scrollTop when the row offset changed", () => {
  const { container } = installScrollFixture();

  const restored = restoreTranslateRowAnchor({
    rowId: "row-1",
    offsetTop: 10,
  });

  assert.equal(restored, true);
  assert.equal(container.scrollTop, 80);
});

test("readPendingTranslateAnchor returns a copy of the queued anchor", () => {
  queueTranslateRowAnchor({
    rowId: "row-1",
    offsetTop: 12,
    type: "row",
  });

  const snapshot = readPendingTranslateAnchor();
  assert.deepEqual(snapshot, {
    rowId: "row-1",
    languageCode: null,
    offsetTop: 12,
    type: "row",
  });

  snapshot.rowId = "mutated";
  assert.equal(readPendingTranslateAnchor().rowId, "row-1");

  queueTranslateRowAnchor(null);
});

test("captureTranslateAnchorForRow prefers the requested field when a language is provided", () => {
  installScrollFixture();

  const snapshot = captureTranslateAnchorForRow("row-1", "en");

  assert.deepEqual(snapshot, {
    type: "field",
    rowId: "row-1",
    languageCode: "en",
    offsetTop: 52,
  });
});
