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

test("assistant transcript renders one transient query status", () => {
  const baseThread = {
    "row-1::vi": {
      rowId: "row-1",
      targetLanguageCode: "vi",
      items: [{
        id: "user-1",
        type: "user-message",
        createdAt: "2026-04-30T00:00:00.000Z",
        text: "Please explain this.",
        summary: "Please explain this.",
        sourceLanguageCode: "es",
        targetLanguageCode: "vi",
      }],
    },
  };
  const sendingHtml = renderTranslateSidebar(
    activeEditorChapter({
      assistant: {
        status: "sending",
        activeThreadKey: "row-1::vi",
        requestKey: "request-1",
        threadsByKey: baseThread,
      },
    }),
    rows,
    languages,
    "es",
    "vi",
    createAiActionConfigurationState(),
  );
  const thinkingHtml = renderTranslateSidebar(
    activeEditorChapter({
      assistant: {
        status: "thinking",
        activeThreadKey: "row-1::vi",
        requestKey: "request-1",
        threadsByKey: baseThread,
      },
    }),
    rows,
    languages,
    "es",
    "vi",
    createAiActionConfigurationState(),
  );
  const repliedHtml = renderTranslateSidebar(
    activeEditorChapter({
      assistant: {
        status: "idle",
        activeThreadKey: "row-1::vi",
        threadsByKey: {
          "row-1::vi": {
            ...baseThread["row-1::vi"],
            items: [
              ...baseThread["row-1::vi"].items,
              {
                id: "assistant-1",
                type: "assistant-message",
                createdAt: "2026-04-30T00:00:01.000Z",
                text: "Here is the explanation.",
                summary: "Here is the explanation.",
                sourceLanguageCode: "es",
                targetLanguageCode: "vi",
              },
            ],
          },
        },
      },
    }),
    rows,
    languages,
    "es",
    "vi",
    createAiActionConfigurationState(),
  );

  assert.match(sendingHtml, /class="assistant-transcript__status">Sending\.\.\.<\/p>/);
  assert.doesNotMatch(sendingHtml, /Thinking\.\.\./);
  assert.match(thinkingHtml, /class="assistant-transcript__status">Thinking\.\.\.<\/p>/);
  assert.doesNotMatch(thinkingHtml, /Sending\.\.\./);
  assert.match(repliedHtml, /Here is the explanation\./);
  assert.doesNotMatch(repliedHtml, /assistant-transcript__status/);
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
