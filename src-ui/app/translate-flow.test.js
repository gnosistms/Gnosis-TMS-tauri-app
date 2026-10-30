import test from "node:test";
import assert from "node:assert/strict";

import {
  clearStoredEditorCollapsedLanguageCodes,
  loadStoredEditorCollapsedLanguageCodes,
} from "./editor-preferences.js";
import { createEditorChapterState, state } from "./state.js";
import { setActiveStorageLogin } from "./team-storage.js";
import { toggleEditorLanguageCollapsed } from "./translate-flow.js";

test("hiding and showing a language saves the choice for the open chapter", () => {
  const login = "collapsed-languages-toggle";
  const chapterId = "chapter-7";
  const previousEditorChapter = state.editorChapter;
  setActiveStorageLogin(login);
  clearStoredEditorCollapsedLanguageCodes(chapterId, login);

  try {
    state.editorChapter = { ...createEditorChapterState(), chapterId };

    toggleEditorLanguageCollapsed("en");
    assert.deepEqual([...state.editorChapter.collapsedLanguageCodes], ["en"]);
    assert.deepEqual([...loadStoredEditorCollapsedLanguageCodes(chapterId, login)], ["en"]);

    toggleEditorLanguageCollapsed("en");
    assert.deepEqual([...state.editorChapter.collapsedLanguageCodes], []);
    assert.deepEqual([...loadStoredEditorCollapsedLanguageCodes(chapterId, login)], []);
  } finally {
    clearStoredEditorCollapsedLanguageCodes(chapterId, login);
    setActiveStorageLogin(null);
    state.editorChapter = previousEditorChapter;
  }
});
