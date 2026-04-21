import test from "node:test";
import assert from "node:assert/strict";

import {
  appendEditorAssistantItems,
  applyEditorAssistantDocumentDigest,
  applyEditorAssistantItemApplied,
  applyEditorAssistantItemApplying,
  buildEditorAssistantThreadKey,
  currentEditorAssistantThread,
  normalizeEditorAssistantState,
} from "./editor-ai-assistant-state.js";
import { createEditorChapterState } from "./state.js";

test("assistant threads are keyed by row and target language", () => {
  assert.equal(buildEditorAssistantThreadKey("row-1", "vi"), "row-1::vi");
  assert.equal(buildEditorAssistantThreadKey("", "vi"), null);
  assert.equal(buildEditorAssistantThreadKey("row-1", ""), null);
});

test("appendEditorAssistantItems stores transcript items on the active row-target thread", () => {
  const chapterState = {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
  };

  const result = appendEditorAssistantItems(
    chapterState,
    "row-1::vi",
    [{
      id: "item-1",
      type: "user-message",
      createdAt: "2026-04-21T12:00:00.000Z",
      text: "Explain this line.",
      summary: "Explain this line.",
      sourceLanguageCode: "es",
      targetLanguageCode: "vi",
    }],
    {
      rowId: "row-1",
      targetLanguageCode: "vi",
    },
  );

  assert.equal(result.assistant.activeThreadKey, "row-1::vi");
  assert.equal(result.assistant.threadsByKey["row-1::vi"].rowId, "row-1");
  assert.equal(result.assistant.threadsByKey["row-1::vi"].targetLanguageCode, "vi");
  assert.equal(result.assistant.threadsByKey["row-1::vi"].items.length, 1);
  assert.equal(result.assistant.threadsByKey["row-1::vi"].items[0].sourceLanguageCode, "es");
});

test("assistant draft apply lifecycle updates the draft item status", () => {
  let chapterState = {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    assistant: normalizeEditorAssistantState({
      threadsByKey: {
        "row-1::vi": {
          rowId: "row-1",
          targetLanguageCode: "vi",
          items: [{
            id: "draft-1",
            type: "draft-translation",
            createdAt: "2026-04-21T12:00:00.000Z",
            text: "Here is a more literal version.",
            summary: "Draft translation",
            draftTranslationText: "Ban dich moi",
          }],
        },
      },
    }),
  };

  chapterState = applyEditorAssistantItemApplying(chapterState, "row-1::vi", "draft-1");
  assert.equal(
    currentEditorAssistantThread(chapterState, "row-1::vi").items[0].applyStatus,
    "applying",
  );

  chapterState = applyEditorAssistantItemApplied(chapterState, "row-1::vi", "draft-1");
  assert.equal(
    currentEditorAssistantThread(chapterState, "row-1::vi").items[0].applyStatus,
    "applied",
  );
});

test("assistant document digests are stored separately from row threads", () => {
  const chapterState = applyEditorAssistantDocumentDigest(
    {
      ...createEditorChapterState(),
      chapterId: "chapter-1",
    },
    "es",
    {
      summary: "Document summary",
      revisionKey: "rev-1",
      createdAt: "2026-04-21T12:00:00.000Z",
    },
  );

  assert.deepEqual(
    chapterState.assistant.chapterArtifacts.documentDigestsBySourceLanguage.es,
    {
      sourceLanguageCode: "es",
      summary: "Document summary",
      revisionKey: "rev-1",
      createdAt: "2026-04-21T12:00:00.000Z",
    },
  );
});
