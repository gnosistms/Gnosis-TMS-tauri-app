import test from "node:test";
import assert from "node:assert/strict";

import { renderEditorImageDuplicateOverwriteModal } from "./editor-image-duplicate-overwrite-modal.js";

test("image duplicate overwrite modal reuses compact modal controls", () => {
  const html = renderEditorImageDuplicateOverwriteModal({
    editorChapter: {
      imageDuplicateOverwriteModal: {
        isOpen: true,
        destinationLanguageCode: "es",
        destinationLanguageName: "Spanish",
        status: "idle",
        error: "",
      },
    },
  });

  assert.match(html, /modal-backdrop/);
  assert.match(html, /modal-card modal-card--compact/);
  assert.match(html, /Spanish already has an image/);
  assert.match(html, /data-action="cancel-editor-image-duplicate-overwrite"/);
  assert.match(html, /data-action="confirm-editor-image-duplicate-overwrite"/);
});

test("image duplicate overwrite modal explains when the destination caption will also be replaced", () => {
  const html = renderEditorImageDuplicateOverwriteModal({
    editorChapter: {
      imageDuplicateOverwriteModal: {
        isOpen: true,
        destinationLanguageName: "Spanish",
        withCaption: true,
        status: "idle",
        error: "",
      },
    },
  });

  assert.match(html, /Its image and caption will be replaced/);
});
