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
  assert.match(html, /data-editor-conflict-final-input[\s\S]*rows="1"/);
  assert.match(html, /data-editor-conflict-final-footnote-input[\s\S]*rows="1"/);
  assert.doesNotMatch(html, /<textarea[^>]*editor-conflict-modal__version-text/);
  assert.match(html, /<div class="field__textarea editor-conflict-modal__version-text">Local text<\/div>/);
  assert.match(html, /<div class="field__textarea editor-conflict-modal__version-text">Remote text<\/div>/);
});

test("conflict modal omits empty read-only version blocks", () => {
  const html = renderEditorConflictResolutionModal({
    editorChapter: {
      conflictResolutionModal: {
        isOpen: true,
        status: "idle",
        error: "",
        localText: "Local text",
        localFootnote: "",
        remoteText: "Remote text",
        remoteFootnote: "Remote footnote",
        finalText: "Final text",
        finalFootnote: "Remote footnote",
        localImageCaption: "",
        remoteImageCaption: "",
        finalImageCaption: "",
        remoteVersion: null,
      },
    },
  });

  const readonlyFootnoteCount =
    (html.match(/editor-conflict-modal__version-text--footnote/g) ?? []).length;
  assert.equal(readonlyFootnoteCount, 1);
  assert.doesNotMatch(html, /editor-conflict-modal__version-text--footnote"><\/div>/);
});
