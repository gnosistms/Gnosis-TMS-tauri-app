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

test("assistant translate button uses provider label and relies on composer placeholder for empty prompt guidance", () => {
  const html = renderTranslateSidebar(
    activeEditorChapter(),
    rows,
    languages,
    "es",
    "vi",
    createAiActionConfigurationState(),
  );

  assert.match(html, />Translate with OpenAI<\/span>/);
  assert.match(html, /placeholder="Ask AI Assistant about this translation\.\.\."/);
  assert.doesNotMatch(html, /Chat with the AI Assistant about the selected translation\./);
});

test("assistant sidebar hides translate buttons when the selected translation is non-empty", () => {
  const html = renderTranslateSidebar(
    activeEditorChapter(),
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

  assert.doesNotMatch(html, /data-action="run-editor-ai-translate:translate1"/);
  assert.doesNotMatch(html, /Translate with OpenAI/);
  assert.match(html, /data-editor-assistant-draft/);
});

test("assistant transcript renders one transient query status", () => {
  const baseThread = {
    "row-1::es::vi": {
      rowId: "row-1",
      sourceLanguageCode: "es",
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
        activeThreadKey: "row-1::es::vi",
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
        activeThreadKey: "row-1::es::vi",
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
        activeThreadKey: "row-1::es::vi",
        threadsByKey: {
          "row-1::es::vi": {
            ...baseThread["row-1::es::vi"],
            items: [
              ...baseThread["row-1::es::vi"].items,
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
        activeThreadKey: "row-1::es::vi",
        threadsByKey: {
          "row-1::es::vi": {
            rowId: "row-1",
            sourceLanguageCode: "es",
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
        activeThreadKey: "row-1::es::vi",
        threadsByKey: {
          "row-1::es::vi": {
            rowId: "row-1",
            sourceLanguageCode: "es",
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
        activeThreadKey: "row-1::es::vi",
        threadsByKey: {
          "row-1::es::vi": {
            rowId: "row-1",
            sourceLanguageCode: "es",
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
        activeThreadKey: "row-1::es::vi",
        threadsByKey: {
          "row-1::es::vi": {
            rowId: "row-1",
            sourceLanguageCode: "es",
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
        activeThreadKey: "row-1::es::vi",
        threadsByKey: {
          "row-1::es::vi": {
            rowId: "row-1",
            sourceLanguageCode: "es",
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
        activeThreadKey: "row-1::es::vi",
        threadsByKey: {
          "row-1::es::vi": {
            rowId: "row-1",
            sourceLanguageCode: "es",
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
        activeThreadKey: "row-1::es::vi",
        threadsByKey: {
          "row-1::es::vi": {
            rowId: "row-1",
            sourceLanguageCode: "es",
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
        activeThreadKey: "row-1::es::vi",
        threadsByKey: {
          "row-1::es::vi": {
            rowId: "row-1",
            sourceLanguageCode: "es",
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

test("review sidebar disables review mode buttons while offline", () => {
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
  assert.match(html, /data-action="review-editor-text-now:grammar"[^>]*disabled/);
  assert.match(html, /data-action="review-editor-text-now:meaning"[^>]*disabled/);
});

test("review sidebar renders grammar and translation review actions with tooltips", () => {
  const html = renderTranslateSidebar(
    activeEditorChapter({
      sidebarTab: "review",
    }),
    [{
      id: "row-1",
      sections: [
        { code: "es", text: "Hola" },
        { code: "vi", text: "Xin chau" },
      ],
    }],
    languages,
    "es",
    "vi",
    createAiActionConfigurationState(),
  );

  assert.match(html, /data-action="review-editor-text-now:meaning"/);
  assert.match(html, /data-ai-review-mode="meaning"/);
  assert.match(html, />Full review<\/span>/);
  assert.match(html, /Check to see if the translation is correct in addition to checking spelling and grammar\./);
  assert.match(html, /data-action="review-editor-text-now:grammar"/);
  assert.match(html, /data-ai-review-mode="grammar"/);
  assert.match(html, />Spelling and grammar only<\/span>/);
  assert.match(html, /Check only for spelling and grammar errors\./);
  assert.ok(
    html.indexOf('data-action="review-editor-text-now:meaning"')
      < html.indexOf('data-action="review-editor-text-now:grammar"'),
  );
});

test("review sidebar shows current text when editor text is ahead of latest history", () => {
  const html = renderTranslateSidebar(
    activeEditorChapter({
      sidebarTab: "review",
      history: {
        status: "ready",
        entries: [
          {
            commitSha: "latest",
            authorName: "translator",
            plainText: "Xin chao",
            footnote: "",
            imageCaption: "",
            reviewed: false,
            pleaseCheck: false,
            textStyle: "paragraph",
          },
        ],
      },
    }),
    [{
      id: "row-1",
      textStyle: "paragraph",
      sections: [
        { code: "es", text: "Hola" },
        { code: "vi", text: "Xin chao!" },
      ],
    }],
    languages,
    "es",
    "vi",
    createAiActionConfigurationState(),
  );

  assert.match(html, /Current text/);
  assert.match(html, /Compared with the latest saved version/);
  assert.match(html, /history-diff__insert">!<\/span>/);
  assert.doesNotMatch(html, /Last update - translator/);
});

test("review sidebar keeps committed last update when editor text matches latest history", () => {
  const html = renderTranslateSidebar(
    activeEditorChapter({
      sidebarTab: "review",
      history: {
        status: "ready",
        entries: [
          {
            commitSha: "latest",
            authorName: "translator",
            plainText: "Xin chao",
            footnote: "",
            imageCaption: "",
            reviewed: false,
            pleaseCheck: false,
            textStyle: "paragraph",
          },
          {
            commitSha: "previous",
            authorName: "translator",
            plainText: "Xin chau",
            footnote: "",
            imageCaption: "",
            reviewed: false,
            pleaseCheck: false,
            textStyle: "paragraph",
          },
        ],
      },
    }),
    [{
      id: "row-1",
      textStyle: "paragraph",
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

  assert.match(html, /Last update - translator/);
  assert.match(html, /Compared with the previous commit/);
  assert.match(html, /history-diff__delete">u<\/span>/);
  assert.match(html, /history-diff__insert">o<\/span>/);
  assert.doesNotMatch(html, /Current text/);
});

test("review sidebar ignores marker-only differences when choosing current text", () => {
  const html = renderTranslateSidebar(
    activeEditorChapter({
      sidebarTab: "review",
      history: {
        status: "ready",
        entries: [
          {
            commitSha: "latest",
            authorName: "translator",
            plainText: "Xin chao",
            footnote: "",
            imageCaption: "",
            reviewed: false,
            pleaseCheck: false,
            textStyle: "paragraph",
          },
          {
            commitSha: "previous",
            authorName: "translator",
            plainText: "Xin chau",
            footnote: "",
            imageCaption: "",
            reviewed: false,
            pleaseCheck: false,
            textStyle: "paragraph",
          },
        ],
      },
    }),
    [{
      id: "row-1",
      textStyle: "paragraph",
      sections: [
        { code: "es", text: "Hola" },
        {
          code: "vi",
          text: "Xin chao",
          reviewed: true,
          pleaseCheck: true,
        },
      ],
    }],
    languages,
    "es",
    "vi",
    createAiActionConfigurationState(),
  );

  assert.match(html, /Last update - translator/);
  assert.match(html, /Compared with the previous commit/);
  assert.doesNotMatch(html, /Current text/);
});

test("review sidebar treats text style differences as current text", () => {
  const html = renderTranslateSidebar(
    activeEditorChapter({
      sidebarTab: "review",
      history: {
        status: "ready",
        entries: [
          {
            commitSha: "latest",
            authorName: "translator",
            plainText: "Xin chao",
            footnote: "",
            imageCaption: "",
            reviewed: false,
            pleaseCheck: false,
            textStyle: "paragraph",
          },
        ],
      },
    }),
    [{
      id: "row-1",
      textStyle: "heading1",
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

  assert.match(html, /Current text/);
  assert.match(html, /Compared with the latest saved version/);
  assert.match(html, /Style change/);
  assert.match(html, /history-diff__delete">P<\/span>/);
  assert.match(html, /history-diff__insert">H1<\/span>/);
});

test("review sidebar shows the loading spinner on the active full review button", () => {
  const html = renderTranslateSidebar(
    activeEditorChapter({
      sidebarTab: "review",
      aiReview: {
        rowId: "row-1",
        languageCode: "vi",
        status: "loading",
        sourceText: "Xin chao",
        reviewMode: "meaning",
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

  assert.match(html, /Full review\.\.\./);
  assert.match(html, /button--loading/);
  assert.doesNotMatch(html, />Spelling and grammar only<\/span>/);
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

test("review sidebar renders AI review prompt details when available", () => {
  const html = renderTranslateSidebar(
    activeEditorChapter({
      sidebarTab: "review",
      aiReview: {
        rowId: "row-1",
        languageCode: "vi",
        status: "ready",
        sourceText: "Xin chau",
        suggestedText: "Xin chao",
        promptText: "Check spelling and grammar on Xin chau",
      },
    }),
    [{
      id: "row-1",
      sections: [
        { code: "es", text: "Hola" },
        { code: "vi", text: "Xin chau" },
      ],
    }],
    languages,
    "es",
    "vi",
    createAiActionConfigurationState(),
  );

  assert.match(html, /<summary>Show prompt<\/summary>/);
  assert.match(html, /assistant-item__details/);
  assert.match(html, /Check spelling and grammar on Xin chau/);
});

test("review sidebar keeps full review available after clean grammar-only review", () => {
  const html = renderTranslateSidebar(
    activeEditorChapter({
      sidebarTab: "review",
      aiReview: {
        rowId: "row-1",
        languageCode: "vi",
        status: "ready",
        sourceText: "Xin chao",
        suggestedText: "",
        promptText: "Review latest_translation only for spelling and grammar errors.",
        reviewMode: "grammar",
        reviewed: true,
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

  assert.match(html, /Spelling and grammar look good!/);
  assert.match(html, /<summary>Show prompt<\/summary>/);
  assert.match(html, /data-action="review-editor-text-now:meaning"/);
  assert.match(html, />Full review<\/span>/);
  assert.doesNotMatch(html, /data-action="review-editor-text-now:grammar"/);
  assert.doesNotMatch(html, />Spelling and grammar only<\/span>/);
});

test("review sidebar hides review buttons after clean full review", () => {
  const html = renderTranslateSidebar(
    activeEditorChapter({
      sidebarTab: "review",
      aiReview: {
        rowId: "row-1",
        languageCode: "vi",
        status: "ready",
        sourceText: "Xin chao",
        suggestedText: "",
        promptText: "Review latest_translation for translation accuracy, spelling, and grammar.",
        reviewMode: "meaning",
        reviewed: true,
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

  assert.match(html, /Your translation looks good!/);
  assert.match(html, /<summary>Show prompt<\/summary>/);
  assert.doesNotMatch(html, /data-action="review-editor-text-now:meaning"/);
  assert.doesNotMatch(html, /data-action="review-editor-text-now:grammar"/);
});

test("review sidebar reopens both review actions when a clean review is stale", () => {
  const html = renderTranslateSidebar(
    activeEditorChapter({
      sidebarTab: "review",
      aiReview: {
        rowId: "row-1",
        languageCode: "vi",
        status: "ready",
        sourceText: "Xin chao",
        suggestedText: "",
        promptText: "Review latest_translation for translation accuracy, spelling, and grammar.",
        reviewMode: "meaning",
        reviewed: true,
      },
    }),
    [{
      id: "row-1",
      sections: [
        { code: "es", text: "Hola" },
        { code: "vi", text: "Xin chao da sua" },
      ],
    }],
    languages,
    "es",
    "vi",
    createAiActionConfigurationState(),
  );

  assert.match(html, /The text changed since the last AI review\./);
  assert.match(html, /data-action="review-editor-text-now:meaning"/);
  assert.match(html, /data-action="review-editor-text-now:grammar"/);
});
