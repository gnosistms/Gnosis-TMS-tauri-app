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

test("assistant sidebar hides translate buttons after the active thread has history", () => {
  const html = renderTranslateSidebar(
    activeEditorChapter({
      assistant: {
        status: "idle",
        activeThreadKey: "row-1::vi",
        threadsByKey: {
          "row-1::vi": {
            rowId: "row-1",
            targetLanguageCode: "vi",
            items: [{
              id: "user-1",
              type: "user-message",
              createdAt: "2026-04-30T00:00:00.000Z",
              text: "Translate this more literally.",
              summary: "Translate this more literally.",
              sourceLanguageCode: "es",
              targetLanguageCode: "vi",
            }],
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

  assert.doesNotMatch(html, /data-action="run-editor-ai-translate:translate1"/);
  assert.match(html, /Translate this more literally\./);
  assert.match(html, /data-editor-assistant-draft/);
});

test("assistant draft translation shows a diff when the active target field is non-empty", () => {
  const html = renderTranslateSidebar(
    activeEditorChapter({
      assistant: {
        status: "idle",
        activeThreadKey: "row-1::vi",
        threadsByKey: {
          "row-1::vi": {
            rowId: "row-1",
            targetLanguageCode: "vi",
            items: [{
              id: "draft-1",
              type: "draft-translation",
              createdAt: "2026-04-30T00:00:00.000Z",
              text: "Suggested update.",
              summary: "Suggested update.",
              sourceLanguageCode: "es",
              targetLanguageCode: "vi",
              draftTranslationText: "Xin chao moi",
            }],
          },
        },
      },
    }),
    [{
      id: "row-1",
      sections: [
        { code: "es", text: "Hola" },
        { code: "vi", text: "Xin chao cu" },
      ],
    }],
    languages,
    "es",
    "vi",
    createAiActionConfigurationState(),
  );

  assert.match(html, /class="assistant-item__draft"/);
  assert.match(html, /history-diff__delete/);
  assert.match(html, /history-diff__insert/);
  assert.match(html, /data-action="toggle-editor-assistant-draft-diff:draft-1"/);
  assert.match(html, />Hide diff<\/button>/);
  assert.match(html, /data-tooltip="Hide the markings that indicate the differences between this draft and the translation on the left\."/);
  assert.match(html, /cu/);
  assert.match(html, /moi/);
});

test("assistant draft translation can render with diff markings hidden", () => {
  const html = renderTranslateSidebar(
    activeEditorChapter({
      assistant: {
        status: "idle",
        activeThreadKey: "row-1::vi",
        threadsByKey: {
          "row-1::vi": {
            rowId: "row-1",
            targetLanguageCode: "vi",
            items: [{
              id: "draft-1",
              type: "draft-translation",
              createdAt: "2026-04-30T00:00:00.000Z",
              text: "Suggested update.",
              summary: "Suggested update.",
              sourceLanguageCode: "es",
              targetLanguageCode: "vi",
              draftTranslationText: "Xin chao moi",
              draftDiffHidden: true,
            }],
          },
        },
      },
    }),
    [{
      id: "row-1",
      sections: [
        { code: "es", text: "Hola" },
        { code: "vi", text: "Xin chao cu" },
      ],
    }],
    languages,
    "es",
    "vi",
    createAiActionConfigurationState(),
  );

  assert.match(html, /<pre class="assistant-item__draft">Xin chao moi<\/pre>/);
  assert.doesNotMatch(html, /history-diff__/);
  assert.match(html, />Show diff<\/button>/);
  assert.match(html, /data-tooltip="Show markings that indicate the differences between this draft and the translation on the left\."/);
});

test("assistant draft translation renders plain text when the active target field is empty", () => {
  const html = renderTranslateSidebar(
    activeEditorChapter({
      assistant: {
        status: "idle",
        activeThreadKey: "row-1::vi",
        threadsByKey: {
          "row-1::vi": {
            rowId: "row-1",
            targetLanguageCode: "vi",
            items: [{
              id: "draft-1",
              type: "draft-translation",
              createdAt: "2026-04-30T00:00:00.000Z",
              text: "Suggested translation.",
              summary: "Suggested translation.",
              sourceLanguageCode: "es",
              targetLanguageCode: "vi",
              draftTranslationText: "Xin chao",
            }],
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

  assert.match(html, /<pre class="assistant-item__draft">Xin chao<\/pre>/);
  assert.doesNotMatch(html, /history-diff__/);
  assert.doesNotMatch(html, /toggle-editor-assistant-draft-diff/);
});

test("assistant draft apply button stays applied while the current translation matches the draft", () => {
  const html = renderTranslateSidebar(
    activeEditorChapter({
      assistant: {
        status: "idle",
        activeThreadKey: "row-1::vi",
        threadsByKey: {
          "row-1::vi": {
            rowId: "row-1",
            targetLanguageCode: "vi",
            items: [{
              id: "draft-1",
              type: "draft-translation",
              createdAt: "2026-04-30T00:00:00.000Z",
              text: "Suggested translation.",
              summary: "Suggested translation.",
              sourceLanguageCode: "es",
              targetLanguageCode: "vi",
              draftTranslationText: "Xin chao",
              applyStatus: "applied",
            }],
          },
        },
      },
    }),
    [{
      id: "row-1",
      sections: [
        { code: "es", text: "Hola" },
        { code: "vi", text: "Xin chao" },
      ],
    }],
    languages,
    "es",
    "vi",
    createAiActionConfigurationState(),
  );

  assert.match(html, />Applied<\/button>/);
  assert.match(html, /data-action="apply-editor-assistant-draft:draft-1"[\s\S]*disabled/);
});

test("assistant draft apply button reactivates after the current translation changes", () => {
  const html = renderTranslateSidebar(
    activeEditorChapter({
      assistant: {
        status: "idle",
        activeThreadKey: "row-1::vi",
        threadsByKey: {
          "row-1::vi": {
            rowId: "row-1",
            targetLanguageCode: "vi",
            items: [{
              id: "draft-1",
              type: "draft-translation",
              createdAt: "2026-04-30T00:00:00.000Z",
              text: "Suggested translation.",
              summary: "Suggested translation.",
              sourceLanguageCode: "es",
              targetLanguageCode: "vi",
              draftTranslationText: "Xin chao",
              applyStatus: "applied",
            }],
          },
        },
      },
    }),
    [{
      id: "row-1",
      sections: [
        { code: "es", text: "Hola" },
        { code: "vi", text: "Xin chao moi" },
      ],
    }],
    languages,
    "es",
    "vi",
    createAiActionConfigurationState(),
  );

  assert.match(html, />Apply<\/button>/);
  assert.doesNotMatch(html, /data-action="apply-editor-assistant-draft:draft-1"[^>]*disabled/);
});

test("translation log details show only what was sent to the model", () => {
  const html = renderTranslateSidebar(
    activeEditorChapter({
      assistant: {
        status: "idle",
        activeThreadKey: "row-1::vi",
        threadsByKey: {
          "row-1::vi": {
            rowId: "row-1",
            targetLanguageCode: "vi",
            items: [{
              id: "translation-1",
              type: "translation-log",
              createdAt: "2026-04-30T00:00:01.000Z",
              text: "Translate 1 applied to Vietnamese.",
              summary: "Translate 1 applied to Vietnamese.",
              sourceLanguageCode: "es",
              targetLanguageCode: "vi",
              promptText: "Translate Spanish to Vietnamese: Hola",
              details: {
                providerId: "openai",
                modelId: "gpt-5.5",
                sourceText: "Hola",
                glossarySourceText: "Hola",
                translatedText: "Xin chao",
                appliedText: "Xin chao",
              },
            }],
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

  assert.match(html, /Prompt/);
  assert.match(html, /Translate Spanish to Vietnamese: Hola/);
  assert.doesNotMatch(html, /Translation/);
  assert.doesNotMatch(html, /Model Output/);
  assert.doesNotMatch(html, /Applied Text/);
  assert.doesNotMatch(html, /Source/);
  assert.doesNotMatch(html, /Glossary Source/);
});

test("translation log details omit distinct glossary source text", () => {
  const html = renderTranslateSidebar(
    activeEditorChapter({
      assistant: {
        status: "idle",
        activeThreadKey: "row-1::vi",
        threadsByKey: {
          "row-1::vi": {
            rowId: "row-1",
            targetLanguageCode: "vi",
            items: [{
              id: "translation-1",
              type: "translation-log",
              createdAt: "2026-04-30T00:00:01.000Z",
              text: "Translate 1 applied to Vietnamese.",
              summary: "Translate 1 applied to Vietnamese.",
              sourceLanguageCode: "es",
              targetLanguageCode: "vi",
              promptText: "Translate Spanish to Vietnamese: Hola",
              details: {
                providerId: "openai",
                modelId: "gpt-5.5",
                sourceText: "Hola",
                glossarySourceText: "Hola desde el glosario",
                translatedText: "Xin chao",
                appliedText: "Xin chao",
              },
            }],
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

  assert.doesNotMatch(html, /Glossary Source/);
  assert.doesNotMatch(html, /Hola desde el glosario/);
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
