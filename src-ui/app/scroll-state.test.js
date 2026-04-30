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
    this.closestMap = options.closestMap ?? new Map();
    this.selectorLists = options.selectorLists ?? new Map();
  }

  getBoundingClientRect() {
    return this.rect;
  }

  closest(selector) {
    return this.closestMap.get(selector) ?? null;
  }

  querySelectorAll(selector) {
    return this.selectorLists.get(selector) ?? [];
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
let selectorLists = new Map();

globalThis.document = {
  activeElement: null,
  querySelector(selector) {
    return selectors.get(selector) ?? null;
  },
  querySelectorAll(selector) {
    return selectorLists.get(selector) ?? [];
  },
};

function installScrollFixture({ containerTop = 100, anchorTop = 140, scrollTop = 50 } = {}) {
  selectors = new Map();
  selectorLists = new Map();
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
    '[data-editor-row-field][data-row-id="row-1"][data-language-code="en"]:not([data-content-kind])',
    field,
  );
  selectorLists.set("[data-editor-row-card]", [row]);
  selectorLists.set("[data-editor-deleted-group]", []);
  return { container };
}

const {
  captureLanguageToggleVisibilityAnchor,
  captureVisibleTranslateRowLocation,
  captureTranslateAnchorForRow,
  readPendingTranslateAnchor,
  queueTranslateRowAnchor,
  restoreTranslateRowAnchor,
} = await import("./scroll-state.js");

function installLanguageToggleFixture({
  collapsedLanguageCodes = [],
  clickedLanguageCode = "en",
  languageCodes = ["es", "en", "vi"],
} = {}) {
  selectors = new Map();
  selectorLists = new Map();
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
      scrollTop: 50,
      clientHeight: 400,
    },
  );
  const row = new FakeHTMLElement(
    {
      top: 120,
      bottom: 360,
      left: 0,
      right: 600,
      width: 600,
      height: 240,
    },
    {
      dataset: {
        rowId: "row-1",
      },
    },
  );
  const toggles = languageCodes.map((languageCode, index) => {
    const toggle = new FakeHTMLElement(
      {
        top: 132 + index * 50,
        bottom: 156 + index * 50,
        left: 0,
        right: 600,
        width: 600,
        height: 24,
      },
      {
        dataset: {
          rowId: "row-1",
          languageCode,
        },
      },
    );
    toggle.closestMap = new Map([
      ["[data-editor-language-toggle]", toggle],
      ["[data-editor-row-card]", row],
    ]);
    return toggle;
  });
  row.selectorLists = new Map([["[data-editor-language-toggle]", toggles]]);
  selectors.set(".translate-main-scroll", container);
  for (const toggle of toggles) {
    selectors.set(
      `[data-editor-language-toggle][data-row-id="row-1"][data-language-code="${toggle.dataset.languageCode}"]`,
      toggle,
    );
  }
  const clickedToggle = toggles.find((toggle) => toggle.dataset.languageCode === clickedLanguageCode) ?? toggles[0];

  return {
    clickedToggle,
    collapsedLanguageCodes: new Set(collapsedLanguageCodes),
  };
}

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

test("captureTranslateAnchorForRow can prefer the row card when requested", () => {
  installScrollFixture();

  const snapshot = captureTranslateAnchorForRow("row-1", "en", { preferRow: true });

  assert.deepEqual(snapshot, {
    type: "row",
    rowId: "row-1",
    languageCode: "",
    offsetTop: 40,
  });
});

test("captureLanguageToggleVisibilityAnchor anchors top visible language when hiding a middle language", () => {
  const { clickedToggle, collapsedLanguageCodes } = installLanguageToggleFixture({
    clickedLanguageCode: "en",
  });

  const snapshot = captureLanguageToggleVisibilityAnchor(clickedToggle, collapsedLanguageCodes);

  assert.deepEqual(snapshot, {
    type: "language-toggle",
    rowId: "row-1",
    languageCode: "es",
    offsetTop: 32,
  });
});

test("captureLanguageToggleVisibilityAnchor anchors top visible language when hiding the bottom language", () => {
  const { clickedToggle, collapsedLanguageCodes } = installLanguageToggleFixture({
    clickedLanguageCode: "vi",
  });

  const snapshot = captureLanguageToggleVisibilityAnchor(clickedToggle, collapsedLanguageCodes);

  assert.deepEqual(snapshot, {
    type: "language-toggle",
    rowId: "row-1",
    languageCode: "es",
    offsetTop: 32,
  });
});

test("captureLanguageToggleVisibilityAnchor moves the next visible language to the top position when hiding the top language", () => {
  const { clickedToggle, collapsedLanguageCodes } = installLanguageToggleFixture({
    clickedLanguageCode: "es",
  });

  const snapshot = captureLanguageToggleVisibilityAnchor(clickedToggle, collapsedLanguageCodes);

  assert.deepEqual(snapshot, {
    type: "language-toggle",
    rowId: "row-1",
    languageCode: "en",
    offsetTop: 32,
  });
});

test("captureLanguageToggleVisibilityAnchor anchors the clicked toggle when hiding the only visible language", () => {
  const { clickedToggle, collapsedLanguageCodes } = installLanguageToggleFixture({
    clickedLanguageCode: "en",
    collapsedLanguageCodes: ["es", "vi"],
  });

  const snapshot = captureLanguageToggleVisibilityAnchor(clickedToggle, collapsedLanguageCodes);

  assert.deepEqual(snapshot, {
    type: "language-toggle",
    rowId: "row-1",
    languageCode: "en",
    offsetTop: 82,
  });
});

test("captureLanguageToggleVisibilityAnchor anchors the top visible language when unhiding a hidden language", () => {
  const { clickedToggle, collapsedLanguageCodes } = installLanguageToggleFixture({
    clickedLanguageCode: "vi",
    collapsedLanguageCodes: ["vi"],
  });

  const snapshot = captureLanguageToggleVisibilityAnchor(clickedToggle, collapsedLanguageCodes, ["es", "en", "vi"]);

  assert.deepEqual(snapshot, {
    type: "language-toggle",
    rowId: "row-1",
    languageCode: "es",
    offsetTop: 32,
  });
});

test("captureLanguageToggleVisibilityAnchor moves an unhidden first language to the previous top visible position", () => {
  const { clickedToggle, collapsedLanguageCodes } = installLanguageToggleFixture({
    clickedLanguageCode: "es",
    collapsedLanguageCodes: ["es"],
    languageCodes: ["en", "vi", "es"],
  });

  const snapshot = captureLanguageToggleVisibilityAnchor(clickedToggle, collapsedLanguageCodes, ["es", "en", "vi"]);

  assert.deepEqual(snapshot, {
    type: "language-toggle",
    rowId: "row-1",
    languageCode: "es",
    offsetTop: 32,
  });
});

test("captureLanguageToggleVisibilityAnchor anchors the clicked toggle when unhiding with no visible languages", () => {
  const { clickedToggle, collapsedLanguageCodes } = installLanguageToggleFixture({
    clickedLanguageCode: "vi",
    collapsedLanguageCodes: ["es", "en", "vi"],
  });

  const snapshot = captureLanguageToggleVisibilityAnchor(clickedToggle, collapsedLanguageCodes, ["es", "en", "vi"]);

  assert.deepEqual(snapshot, {
    type: "language-toggle",
    rowId: "row-1",
    languageCode: "vi",
    offsetTop: 132,
  });
});

test("captureVisibleTranslateRowLocation anchors to the first visible row card", () => {
  installScrollFixture();

  const snapshot = captureVisibleTranslateRowLocation();

  assert.deepEqual(snapshot, {
    type: "row",
    rowId: "row-1",
    languageCode: null,
    offsetTop: 40,
  });
});

test("captureVisibleTranslateRowLocation preserves partially scrolled row offsets", () => {
  installScrollFixture({ containerTop: 100, anchorTop: 72 });

  const snapshot = captureVisibleTranslateRowLocation();

  assert.deepEqual(snapshot, {
    type: "row",
    rowId: "row-1",
    languageCode: null,
    offsetTop: -28,
  });
});
