import test from "node:test";
import assert from "node:assert/strict";

import { buildEditorGlossaryModel } from "./editor-glossary-highlighting.js";

function buildGlossaryModel() {
  return buildEditorGlossaryModel({
    glossaryId: "glossary-1",
    repoName: "team-glossary",
    title: "Team Glossary",
    sourceLanguage: { code: "en", name: "English" },
    targetLanguage: { code: "es", name: "Spanish" },
    terms: [
      {
        sourceTerms: ["mind"],
        targetTerms: ["mente"],
      },
    ],
  });
}

function buildChapterState(row, { searchQuery = "" } = {}) {
  return {
    chapterId: "chapter-1",
    languages: [{ code: "en", name: "English" }],
    rows: [row],
    filters: {
      searchQuery,
      caseSensitive: false,
    },
    glossary: {
      glossaryId: "glossary-1",
      repoName: "team-glossary",
      matcherModel: buildGlossaryModel(),
    },
  };
}

function buildRow({
  isTextEditorOpen = false,
  isAiTranslating = false,
  text = "mind",
} = {}) {
  return {
    kind: "row",
    id: "row-1",
    rowId: "row-1",
    lifecycleState: "active",
    hasConflict: false,
    fields: {
      en: text,
    },
    footnotes: {},
    images: {},
    fieldStates: {},
    sections: [
      {
        code: "en",
        name: "English",
        text,
        footnote: "",
        hasConflict: false,
        reviewed: false,
        pleaseCheck: false,
        commentCount: 0,
        hasUnreadCommentActivity: false,
        isAiTranslating,
        isTextEditorOpen,
        hasVisibleFootnote: false,
        hasVisibleImage: false,
        hasVisibleImageCaption: false,
        isImageUrlEditorOpen: false,
        isImageUploadEditorOpen: false,
      },
    ],
  };
}

function datasetKeyFromAttribute(name) {
  return String(name)
    .replace(/^data-/, "")
    .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

class FakeClassList {
  constructor(initial = "") {
    this.values = new Set(String(initial).split(/\s+/).filter(Boolean));
  }

  toggle(name, force) {
    if (force === undefined) {
      if (this.values.has(name)) {
        this.values.delete(name);
        return false;
      }

      this.values.add(name);
      return true;
    }

    if (force) {
      this.values.add(name);
      return true;
    }

    this.values.delete(name);
    return false;
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor({ attributes = {}, innerHTML = "" } = {}) {
    this.attributes = { ...attributes };
    this.dataset = {};
    for (const [name, value] of Object.entries(this.attributes)) {
      if (name.startsWith("data-")) {
        this.dataset[datasetKeyFromAttribute(name)] = value;
      }
    }
    this.classList = new FakeClassList(this.attributes.class ?? "");
    this.children = [];
    this.innerHTML = innerHTML;
    this.parentElement = null;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  matchesSelector(selector) {
    const attributeMatches = Array.from(
      String(selector).matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g),
    );
    if (attributeMatches.length === 0) {
      return false;
    }

    return attributeMatches.every((match) => {
      const attributeName = match[1] ?? "";
      const expectedValue = match[2];
      if (!attributeName.startsWith("data-")) {
        return false;
      }

      const datasetKey = datasetKeyFromAttribute(attributeName);
      const actualValue = this.dataset[datasetKey];
      if (expectedValue === undefined) {
        return actualValue !== undefined;
      }

      return String(actualValue ?? "") === expectedValue;
    });
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (child.matchesSelector(selector)) {
        return child;
      }

      const nested = child.querySelector(selector);
      if (nested) {
        return nested;
      }
    }

    return null;
  }

  querySelectorAll(selector) {
    const matches = [];
    for (const child of this.children) {
      if (child.matchesSelector(selector)) {
        matches.push(child);
      }

      matches.push(...child.querySelectorAll(selector));
    }

    return matches;
  }
}

async function withFakeDom(callback) {
  const previousDocument = globalThis.document;
  const previousHTMLElement = globalThis.HTMLElement;
  const previousCSS = globalThis.CSS;
  const previousWindow = globalThis.window;

  globalThis.document = {
    querySelector() {
      return null;
    },
  };
  globalThis.window = {
    __TAURI__: {},
    open() {},
  };
  globalThis.HTMLElement = FakeElement;
  globalThis.CSS = {
    escape(value) {
      return String(value);
    },
  };

  try {
    await callback();
  } finally {
    if (previousDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = previousDocument;
    }

    if (previousHTMLElement === undefined) {
      delete globalThis.HTMLElement;
    } else {
      globalThis.HTMLElement = previousHTMLElement;
    }

    if (previousCSS === undefined) {
      delete globalThis.CSS;
    } else {
      globalThis.CSS = previousCSS;
    }

    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
}

let glossaryFlowModulePromise = null;

async function loadGlossaryFlowModule() {
  if (!glossaryFlowModulePromise) {
    glossaryFlowModulePromise = import("./editor-glossary-flow.js");
  }

  return glossaryFlowModulePromise;
}

test("glossary sync writes glossary overlays into the active editor textarea stack", async () => {
  await withFakeDom(async () => {
    const { syncEditorGlossaryHighlightRowDom } = await loadGlossaryFlowModule();
    const row = buildRow({ isTextEditorOpen: true });
    const chapterState = buildChapterState(row);

    const root = new FakeElement();
    const rowCard = root.appendChild(
      new FakeElement({
        attributes: {
          "data-editor-row-card": "",
          "data-row-id": "row-1",
        },
      }),
    );
    const stack = rowCard.appendChild(
      new FakeElement({
        attributes: {
          "data-editor-glossary-field-stack": "",
          "data-language-code": "en",
          "data-row-id": "row-1",
          class: "translation-language-panel__field-stack",
        },
      }),
    );
    stack.appendChild(
      new FakeElement({
        attributes: {
          "data-editor-search-highlight": "",
        },
      }),
    );
    const glossaryLayer = stack.appendChild(
      new FakeElement({
        attributes: {
          "data-editor-glossary-highlight": "",
        },
        innerHTML: "stale highlight",
      }),
    );
    stack.appendChild(
      new FakeElement({
        attributes: {
          "data-editor-row-field": "",
          "data-row-id": "row-1",
          "data-language-code": "en",
        },
      }),
    );

    syncEditorGlossaryHighlightRowDom("row-1", chapterState, root);

    assert.match(glossaryLayer.innerHTML, /translation-language-panel__glossary-mark/);
    assert.equal(stack.classList.contains("translation-language-panel__field-stack--glossary"), true);
  });
});

test("search sync writes search overlays into the active editor textarea stack", async () => {
  await withFakeDom(async () => {
    const { syncEditorGlossaryHighlightRowDom } = await loadGlossaryFlowModule();
    const row = buildRow({ isTextEditorOpen: true });
    const chapterState = buildChapterState(row, { searchQuery: "mind" });

    const root = new FakeElement();
    const rowCard = root.appendChild(
      new FakeElement({
        attributes: {
          "data-editor-row-card": "",
          "data-row-id": "row-1",
        },
      }),
    );
    const stack = rowCard.appendChild(
      new FakeElement({
        attributes: {
          "data-editor-glossary-field-stack": "",
          "data-language-code": "en",
          "data-row-id": "row-1",
          class: "translation-language-panel__field-stack translation-language-panel__field-stack--search",
        },
      }),
    );
    const searchLayer = stack.appendChild(
      new FakeElement({
        attributes: {
          "data-editor-search-highlight": "",
        },
        innerHTML: "stale search highlight",
      }),
    );
    stack.appendChild(
      new FakeElement({
        attributes: {
          "data-editor-glossary-highlight": "",
        },
      }),
    );
    stack.appendChild(
      new FakeElement({
        attributes: {
          "data-editor-row-field": "",
          "data-row-id": "row-1",
          "data-language-code": "en",
        },
      }),
    );

    syncEditorGlossaryHighlightRowDom("row-1", chapterState, root);

    assert.match(searchLayer.innerHTML, /translation-language-panel__search-match/);
    assert.equal(stack.classList.contains("translation-language-panel__field-stack--search"), true);
  });
});

test("glossary sync writes direct glossary markup into static display text", async () => {
  await withFakeDom(async () => {
    const { syncEditorGlossaryHighlightRowDom } = await loadGlossaryFlowModule();
    const row = buildRow({ isTextEditorOpen: false });
    const chapterState = buildChapterState(row);

    const root = new FakeElement();
    const rowCard = root.appendChild(
      new FakeElement({
        attributes: {
          "data-editor-row-card": "",
          "data-row-id": "row-1",
        },
      }),
    );
    const stack = rowCard.appendChild(
      new FakeElement({
        attributes: {
          "data-editor-glossary-field-stack": "",
          "data-language-code": "en",
          "data-row-id": "row-1",
          class: "translation-language-panel__field-stack translation-language-panel__field-stack--glossary",
        },
      }),
    );
    stack.appendChild(
      new FakeElement({
        attributes: {
          "data-editor-search-highlight": "",
        },
      }),
    );
    const glossaryLayer = stack.appendChild(
      new FakeElement({
        attributes: {
          "data-editor-glossary-highlight": "",
        },
        innerHTML: "stale highlight",
      }),
    );
    const displayText = stack.appendChild(
      new FakeElement({
        attributes: {
          "data-editor-display-text": "",
        },
      }),
    );

    syncEditorGlossaryHighlightRowDom("row-1", chapterState, root);

    assert.match(displayText.innerHTML, /translation-language-panel__glossary-mark/);
    assert.match(glossaryLayer.innerHTML, /translation-language-panel__glossary-mark/);
    assert.equal(stack.classList.contains("translation-language-panel__field-stack--glossary"), true);
  });
});

test("search sync writes direct search markup into static display text", async () => {
  await withFakeDom(async () => {
    const { syncEditorGlossaryHighlightRowDom } = await loadGlossaryFlowModule();
    const row = buildRow({ isTextEditorOpen: false });
    const chapterState = buildChapterState(row, { searchQuery: "mind" });

    const root = new FakeElement();
    const rowCard = root.appendChild(
      new FakeElement({
        attributes: {
          "data-editor-row-card": "",
          "data-row-id": "row-1",
        },
      }),
    );
    const stack = rowCard.appendChild(
      new FakeElement({
        attributes: {
          "data-editor-glossary-field-stack": "",
          "data-language-code": "en",
          "data-row-id": "row-1",
          class: "translation-language-panel__field-stack translation-language-panel__field-stack--search",
        },
      }),
    );
    const searchLayer = stack.appendChild(
      new FakeElement({
        attributes: {
          "data-editor-search-highlight": "",
        },
        innerHTML: "stale search highlight",
      }),
    );
    stack.appendChild(
      new FakeElement({
        attributes: {
          "data-editor-glossary-highlight": "",
        },
      }),
    );
    const displayText = stack.appendChild(
      new FakeElement({
        attributes: {
          "data-editor-display-text": "",
        },
      }),
    );

    syncEditorGlossaryHighlightRowDom("row-1", chapterState, root);

    assert.match(displayText.innerHTML, /translation-language-panel__search-match/);
    assert.match(searchLayer.innerHTML, /translation-language-panel__search-match/);
    assert.equal(stack.classList.contains("translation-language-panel__field-stack--search"), true);
  });
});

test("glossary sync keeps the translating placeholder visible in static display", async () => {
  await withFakeDom(async () => {
    const { syncEditorGlossaryHighlightRowDom } = await loadGlossaryFlowModule();
    const row = buildRow({
      isTextEditorOpen: false,
      isAiTranslating: true,
      text: "previous translation",
    });
    const chapterState = buildChapterState(row);

    const root = new FakeElement();
    const rowCard = root.appendChild(
      new FakeElement({
        attributes: {
          "data-editor-row-card": "",
          "data-row-id": "row-1",
        },
      }),
    );
    const stack = rowCard.appendChild(
      new FakeElement({
        attributes: {
          "data-editor-glossary-field-stack": "",
          "data-language-code": "en",
          "data-row-id": "row-1",
          "data-ai-translating": "true",
          class: "translation-language-panel__field-stack translation-language-panel__field-stack--glossary",
        },
      }),
    );
    stack.appendChild(
      new FakeElement({
        attributes: {
          "data-editor-search-highlight": "",
        },
      }),
    );
    const glossaryLayer = stack.appendChild(
      new FakeElement({
        attributes: {
          "data-editor-glossary-highlight": "",
        },
        innerHTML: "stale glossary layer",
      }),
    );
    const displayText = stack.appendChild(
      new FakeElement({
        attributes: {
          "data-editor-display-text": "",
        },
        innerHTML: "Translating...",
      }),
    );

    syncEditorGlossaryHighlightRowDom("row-1", chapterState, root);

    assert.equal(displayText.innerHTML, "Translating...");
    assert.equal(glossaryLayer.innerHTML, "");
    assert.equal(stack.classList.contains("translation-language-panel__field-stack--glossary"), false);
  });
});
