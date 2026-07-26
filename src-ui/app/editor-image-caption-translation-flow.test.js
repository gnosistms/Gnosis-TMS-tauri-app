import test from "node:test";
import assert from "node:assert/strict";

import {
  createEditorChapterState,
  state,
} from "./state.js";
import {
  cancelEditorImageCaptionTranslation,
} from "./translate-flow.js";

test("canceling image caption translation closes the modal and invalidates the AI request", () => {
  const previousWindow = globalThis.window;
  globalThis.window = {
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
  };
  state.editorChapter = {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    imageCaptionTranslationModal: {
      isOpen: true,
      requestId: "caption-request-1",
      rowId: "row-1",
      sourceLanguageCode: "vi",
      destinationLanguageCode: "es",
      destinationLanguageName: "Spanish",
    },
    aiTranslate: {
      ...createEditorChapterState().aiTranslate,
      translate1: {
        status: "loading",
        requestKey: "translate-request-1",
      },
    },
  };
  let renderCount = 0;

  try {
    cancelEditorImageCaptionTranslation(() => {
      renderCount += 1;
    });

    assert.equal(state.editorChapter.imageCaptionTranslationModal.isOpen, false);
    assert.equal(state.editorChapter.aiTranslate.translate1.status, "idle");
    assert.equal(state.editorChapter.aiTranslate.translate1.requestKey, null);
    assert.ok(renderCount >= 1);
  } finally {
    globalThis.window = previousWindow;
  }
});
