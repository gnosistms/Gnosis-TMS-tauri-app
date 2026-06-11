import test from "node:test";
import assert from "node:assert/strict";

import { EDITOR_MODE_PREVIEW } from "./editor-preview.js";
import { updateEditorPreviewLanguage } from "./editor-preview-flow.js";
import {
  createEditorChapterState,
  resetSessionState,
  state,
} from "./state.js";

const originalWindow = globalThis.window;

function installWindow() {
  globalThis.window = {
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
  };
}

test.afterEach(() => {
  resetSessionState();
  globalThis.window = originalWindow;
});

test("preview language selection can show every chapter language without changing editor selections", () => {
  installWindow();
  state.editorChapter = {
    ...createEditorChapterState(),
    mode: EDITOR_MODE_PREVIEW,
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "vi", name: "Vietnamese", role: "target" },
      { code: "ja", name: "Japanese", role: "target" },
    ],
    selectedSourceLanguageCode: "es",
    selectedTargetLanguageCode: "vi",
    rows: [{
      rowId: "row-1",
      lifecycleState: "active",
      textStyle: "paragraph",
      fields: {
        es: "Texto fuente",
        vi: "Translated text",
        ja: "Japanese preview text",
      },
    }],
  };

  for (const code of ["es", "vi", "ja"]) {
    updateEditorPreviewLanguage(() => {}, code);

    assert.equal(state.editorChapter.previewLanguageCode, code);
    assert.equal(state.editorChapter.selectedSourceLanguageCode, "es");
    assert.equal(state.editorChapter.selectedTargetLanguageCode, "vi");
  }

  updateEditorPreviewLanguage(() => {}, "not-a-language");
  assert.equal(state.editorChapter.previewLanguageCode, "ja");
});
