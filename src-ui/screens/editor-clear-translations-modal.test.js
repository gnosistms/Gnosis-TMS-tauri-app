import test from "node:test";
import assert from "node:assert/strict";

import { createEditorChapterState } from "../app/state.js";
import { renderEditorClearTranslationsModal } from "./editor-clear-translations-modal.js";

function chapter(modalOverrides = {}) {
  return {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "vi", name: "Vietnamese", role: "target" },
      { code: "ja", name: "Japanese", role: "target" },
    ],
    clearTranslationsModal: {
      ...createEditorChapterState().clearTranslationsModal,
      isOpen: true,
      ...modalOverrides,
    },
  };
}

test("Clear translations modal lists all file languages and disables clear until selected", () => {
  const html = renderEditorClearTranslationsModal({
    editorChapter: chapter(),
  });

  assert.match(html, /Clear translations/);
  assert.match(html, /Clear all translations for selected languages/);
  assert.match(html, /Select the languages for which you want to clear the translations/);
  assert.match(html, /Spanish/);
  assert.match(html, /Vietnamese/);
  assert.match(html, /Japanese/);
  assert.match(html, /data-editor-clear-translations-language/);
  assert.match(html, /data-action="cancel-editor-clear-translations"/);
  assert.match(html, /data-action="noop" disabled/);
  assert.doesNotMatch(html, /data-action="review-editor-clear-translations"/);
});

test("Clear translations modal enables review when a language is selected", () => {
  const html = renderEditorClearTranslationsModal({
    editorChapter: chapter({
      selectedLanguageCodes: ["vi"],
    }),
  });

  assert.match(html, /value="vi"[\s\S]*checked/);
  assert.match(html, /data-action="review-editor-clear-translations"/);
});

test("Clear translations confirmation lists selected languages and renders delete action", () => {
  const html = renderEditorClearTranslationsModal({
    editorChapter: chapter({
      step: "confirm",
      selectedLanguageCodes: ["vi", "ja"],
    }),
  });

  assert.match(html, /Confirm deletion/);
  assert.match(html, /Are you sure you want to delete these translations/);
  assert.match(html, /All translations in this file for the following languages will be deleted/);
  assert.match(html, /The existing translations will remain visible in the history/);
  assert.match(html, /Vietnamese/);
  assert.match(html, /Japanese/);
  assert.doesNotMatch(html, /Spanish/);
  assert.match(html, /data-action="confirm-editor-clear-translations"/);
});
