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
  createAiActionConfigurationState,
} = await import("../app/ai-action-config.js");
const {
  renderTranslateSidebar,
} = await import("./translate-sidebar.js");

function activeEditorChapter(overrides = {}) {
  return {
    chapterId: "chapter-1",
    activeRowId: "row-1",
    activeLanguageCode: "vi",
    selectedSourceLanguageCode: "es",
    selectedTargetLanguageCode: "vi",
    sidebarTab: "assistant",
    assistant: {},
    ...overrides,
  };
}

const rows = [
  {
    id: "row-1",
    sections: [
      { code: "es", text: "Hola" },
      { code: "vi", text: "" },
    ],
  },
];

const languages = [
  { code: "es", name: "Spanish", role: "source" },
  { code: "vi", name: "Vietnamese", role: "target" },
];

test("assistant sidebar disables AI translate and composer while offline", () => {
  const html = renderTranslateSidebar(
    activeEditorChapter(),
    rows,
    languages,
    "es",
    "vi",
    createAiActionConfigurationState(),
    null,
    true,
  );

  assert.match(html, /AI actions are unavailable offline/);
  assert.match(html, /data-action="run-editor-ai-translate:translate1"[\s\S]*disabled/);
  assert.match(html, /data-editor-assistant-draft[\s\S]*disabled/);
});

test("review sidebar disables Review now while offline", () => {
  const html = renderTranslateSidebar(
    activeEditorChapter({
      sidebarTab: "review",
    }),
    rows,
    languages,
    "es",
    "vi",
    createAiActionConfigurationState(),
    null,
    true,
  );

  assert.match(html, /AI actions are unavailable offline/);
  assert.match(html, /data-action="review-editor-text-now"[^>]*disabled/);
});

test("review sidebar keeps existing AI review suggestions locally applicable offline", () => {
  const html = renderTranslateSidebar(
    activeEditorChapter({
      sidebarTab: "review",
      aiReview: {
        rowId: "row-1",
        languageCode: "vi",
        status: "ready",
        sourceText: "",
        suggestedText: "Xin chao",
      },
    }),
    rows,
    languages,
    "es",
    "vi",
    createAiActionConfigurationState(),
    null,
    true,
  );

  assert.match(html, /data-action="apply-editor-ai-review"/);
  assert.doesNotMatch(html, /data-action="apply-editor-ai-review"[^>]*disabled/);
});
