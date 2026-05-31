import test from "node:test";
import assert from "node:assert/strict";

import { renderEditorConflictResolutionModal } from "./editor-conflict-resolution-modal.js";

test("conflict modal renders only final text and final footnote as editable textareas", () => {
  const html = renderEditorConflictResolutionModal({
    editorChapter: {
      conflictResolutionModal: {
        isOpen: true,
        status: "idle",
        error: "",
        localText: "Local text",
        localFootnote: "Local footnote",
        remoteText: "Remote text",
        remoteFootnote: "Remote footnote",
        finalText: "Final text",
        finalFootnote: "Final footnote",
        localImageCaption: "",
        remoteImageCaption: "",
        finalImageCaption: "",
        remoteVersion: null,
      },
    },
  });

  const textareaCount = (html.match(/<textarea/g) ?? []).length;
  assert.equal(textareaCount, 2);
  assert.match(html, /data-editor-conflict-final-input/);
  assert.match(html, /data-editor-conflict-final-footnote-input/);
  assert.doesNotMatch(html, /<textarea[^>]*editor-conflict-modal__version-text/);
  assert.match(html, /<div class="field__textarea editor-conflict-modal__version-text">Local text<\/div>/);
  assert.match(html, /<div class="field__textarea editor-conflict-modal__version-text">Remote text<\/div>/);
});
