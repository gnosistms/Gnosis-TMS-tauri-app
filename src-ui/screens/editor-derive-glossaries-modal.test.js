import test from "node:test";
import assert from "node:assert/strict";

globalThis.document = {
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
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

const {
  buildEditorGlossaryModel,
} = await import("../app/editor-glossary-highlighting.js");
const {
  createEditorChapterState,
} = await import("../app/state.js");
const {
  renderEditorDeriveGlossariesModal,
} = await import("./editor-derive-glossaries-modal.js");
const {
  renderTranslateToolbar,
} = await import("./translate-toolbar.js");

function glossary() {
  const payload = {
    glossaryId: "glossary-1",
    sourceLanguage: { code: "en", name: "English" },
    targetLanguage: { code: "vi", name: "Vietnamese" },
    terms: [
      {
        termId: "term-1",
        lifecycleState: "active",
        sourceTerms: ["prayer"],
        targetTerms: ["cau nguyen"],
      },
    ],
  };
  return {
    ...payload,
    matcherModel: buildEditorGlossaryModel(payload),
  };
}

function chapter(modalOverrides = {}) {
  return {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    selectedSourceLanguageCode: "es",
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "en", name: "English", role: "target" },
      { code: "vi", name: "Vietnamese", role: "target" },
      { code: "ja", name: "Japanese", role: "target" },
    ],
    glossary: glossary(),
    deriveGlossariesModal: {
      ...createEditorChapterState().deriveGlossariesModal,
      isOpen: true,
      selectedLanguageCodes: ["es", "ja"],
      ...modalOverrides,
    },
  };
}

test("Derive glossaries modal lists derivable language pairs", () => {
  const html = renderEditorDeriveGlossariesModal({
    editorChapter: chapter(),
  });

  assert.match(html, /DERIVE GLOSSARIES/);
  assert.match(html, /Automatically generate glossaries/);
  assert.match(html, /English to Vietnamese/);
  assert.match(html, /Spanish to Vietnamese/);
  assert.match(html, /Japanese to Vietnamese/);
  assert.match(html, /data-action="cancel-editor-derive-glossaries"/);
  assert.match(html, /data-action="confirm-editor-derive-glossaries"/);
});

test("Derive glossaries modal reuses batch progress classes while loading", () => {
  const html = renderEditorDeriveGlossariesModal({
    editorChapter: chapter({
      status: "loading",
      completedCount: 1,
      totalCount: 3,
      languageProgress: {
        es: { completedCount: 1, totalCount: 2 },
        ja: { completedCount: 0, totalCount: 1 },
      },
    }),
  });

  assert.match(html, /1 \/ 3 glossaries completed/);
  assert.match(html, /ai-translate-all-modal__progress-list/);
  assert.match(html, /ai-translate-all-modal__progress-row/);
  assert.match(html, /Spanish/);
  assert.match(html, /1 \/ 2/);
  assert.match(html, /Japanese/);
  assert.match(html, /0 \/ 1/);
  assert.doesNotMatch(html, /This feature will use the existing glossary/);
});

test("Translate toolbar renders icon actions in the expected order when available", () => {
  const html = renderTranslateToolbar({
    languages: [
      { code: "es", name: "Spanish" },
      { code: "vi", name: "Vietnamese" },
    ],
    sourceCode: "es",
    targetCode: "vi",
    deriveGlossariesAvailable: true,
    clearTranslationsAvailable: true,
  });

  const deriveIndex = html.indexOf('data-action="open-editor-derive-glossaries"');
  const clearIndex = html.indexOf('data-action="open-editor-clear-translations"');
  const translateIndex = html.indexOf('data-action="open-editor-ai-translate-all"');
  const unreviewIndex = html.indexOf('data-action="open-editor-unreview-all"');
  assert.equal(deriveIndex > -1, true);
  assert.equal(clearIndex > -1, true);
  assert.equal(translateIndex > -1, true);
  assert.equal(unreviewIndex > -1, true);
  assert.equal(deriveIndex < clearIndex, true);
  assert.equal(clearIndex < translateIndex, true);
  assert.equal(translateIndex < unreviewIndex, true);
  assert.match(html, /aria-label="Derive glossaries"/);
  assert.match(html, /aria-label="Clear translations"/);
  assert.match(html, /aria-label="AI translate all"/);
  assert.match(html, /aria-label="Unreview all"/);
  assert.match(html, /toolbar-icon-action__icon/);
  assert.doesNotMatch(html, />Derive glossaries</);
  assert.doesNotMatch(html, />Clear translations</);
  assert.doesNotMatch(html, />AI translate all</);
  assert.doesNotMatch(html, />Unreview all</);
});

test("Translate toolbar disables online AI batch actions while offline", () => {
  const html = renderTranslateToolbar({
    languages: [
      { code: "es", name: "Spanish" },
      { code: "vi", name: "Vietnamese" },
    ],
    sourceCode: "es",
    targetCode: "vi",
    deriveGlossariesAvailable: true,
    clearTranslationsAvailable: true,
    offlineMode: true,
  });

  assert.match(html, /data-action="open-editor-derive-glossaries"[^>]*disabled/);
  assert.match(html, /data-action="open-editor-ai-translate-all"[^>]*disabled/);
  assert.doesNotMatch(html, /data-action="open-editor-clear-translations"[^>]*disabled/);
  assert.doesNotMatch(html, /data-action="open-editor-unreview-all"[^>]*disabled/);
  assert.match(html, /AI actions are unavailable offline/);
});

test("Derive glossaries modal disables confirm while offline", () => {
  const html = renderEditorDeriveGlossariesModal({
    offline: { isEnabled: true },
    editorChapter: chapter(),
  });

  assert.match(html, /AI actions are unavailable offline/);
  assert.match(html, /data-action="noop" disabled/);
  assert.doesNotMatch(html, /data-action="confirm-editor-derive-glossaries"/);
});
