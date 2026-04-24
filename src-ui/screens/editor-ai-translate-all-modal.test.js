import test from "node:test";
import assert from "node:assert/strict";

import { createEditorChapterState } from "../app/state.js";
import { renderEditorAiTranslateAllModal } from "./editor-ai-translate-all-modal.js";

test("AI Translate All modal renders requested copy and visible target languages", () => {
  const html = renderEditorAiTranslateAllModal({
    editorChapter: {
      ...createEditorChapterState(),
      chapterId: "chapter-1",
      selectedSourceLanguageCode: "es",
      collapsedLanguageCodes: new Set(["ja"]),
      languages: [
        { code: "es", name: "Spanish", role: "source" },
        { code: "vi", name: "Vietnamese", role: "target" },
        { code: "ja", name: "Japanese", role: "target" },
      ],
      aiTranslateAllModal: {
        ...createEditorChapterState().aiTranslateAllModal,
        isOpen: true,
        selectedLanguageCodes: ["vi"],
      },
    },
  });

  assert.match(html, /BATCH TRANSLATE/);
  assert.match(html, /AI Translate the entire file/);
  assert.match(html, /Select languages below to use AI translation to fill all empty fields/);
  assert.match(html, /Cancel/);
  assert.match(html, /Begin translating/);
  assert.match(html, /Vietnamese/);
  assert.doesNotMatch(html, /Spanish/);
  assert.doesNotMatch(html, /Japanese/);
});

test("AI Translate All modal shows an enabled Stop button while translating", () => {
  const html = renderEditorAiTranslateAllModal({
    editorChapter: {
      ...createEditorChapterState(),
      chapterId: "chapter-1",
      selectedSourceLanguageCode: "es",
      languages: [
        { code: "es", name: "Spanish", role: "source" },
        { code: "vi", name: "Vietnamese", role: "target" },
      ],
      aiTranslateAllModal: {
        ...createEditorChapterState().aiTranslateAllModal,
        isOpen: true,
        status: "loading",
        selectedLanguageCodes: ["vi"],
      },
    },
  });

  assert.match(html, />Stop</);
  const stopButton = html.match(/<button[^>]*data-action="cancel-editor-ai-translate-all"[^>]*>Stop<\/button>/)?.[0] ?? "";
  assert.match(stopButton, /data-action="cancel-editor-ai-translate-all"/);
  assert.doesNotMatch(stopButton, /disabled/);
});

test("AI Translate All modal replaces checkboxes with progress bars while translating", () => {
  const html = renderEditorAiTranslateAllModal({
    editorChapter: {
      ...createEditorChapterState(),
      chapterId: "chapter-1",
      selectedSourceLanguageCode: "es",
      languages: [
        { code: "es", name: "Spanish", role: "source" },
        { code: "vi", name: "Vietnamese", role: "target" },
        { code: "ja", name: "Japanese", role: "target" },
        { code: "fr", name: "French", role: "target" },
      ],
      aiTranslateAllModal: {
        ...createEditorChapterState().aiTranslateAllModal,
        isOpen: true,
        status: "loading",
        selectedLanguageCodes: ["vi", "ja"],
        translatedCount: 3,
        totalCount: 9,
        languageProgress: {
          vi: { completedCount: 2, totalCount: 5 },
          ja: { completedCount: 1, totalCount: 4 },
        },
      },
    },
  });

  assert.match(html, /role="progressbar"/);
  assert.match(html, /3 \/ 9 translations completed/);
  assert.match(html, /Vietnamese/);
  assert.match(html, /2 \/ 5/);
  assert.match(html, /Japanese/);
  assert.match(html, /1 \/ 4/);
  assert.doesNotMatch(html, /French/);
  assert.doesNotMatch(html, /type="checkbox"/);
  assert.doesNotMatch(html, /Select languages below to use AI translation/);
});

test("AI Translate All modal renders zero-work selected languages as complete progress", () => {
  const html = renderEditorAiTranslateAllModal({
    editorChapter: {
      ...createEditorChapterState(),
      chapterId: "chapter-1",
      selectedSourceLanguageCode: "es",
      languages: [
        { code: "es", name: "Spanish", role: "source" },
        { code: "vi", name: "Vietnamese", role: "target" },
      ],
      aiTranslateAllModal: {
        ...createEditorChapterState().aiTranslateAllModal,
        isOpen: true,
        status: "loading",
        selectedLanguageCodes: ["vi"],
        languageProgress: {
          vi: { completedCount: 0, totalCount: 0 },
        },
      },
    },
  });

  assert.match(html, /0 \/ 0/);
  assert.match(html, /width: 100%;/);
});
