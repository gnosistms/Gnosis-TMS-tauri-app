import test from "node:test";
import assert from "node:assert/strict";

import {
  renderEditorImageCaptionTranslationModal,
} from "./editor-image-caption-translation-modal.js";

test("image caption translation modal shows a spinner, wait copy, and cancel action", () => {
  const html = renderEditorImageCaptionTranslationModal({
    editorChapter: {
      imageCaptionTranslationModal: {
        isOpen: true,
        destinationLanguageCode: "es",
        destinationLanguageName: "Spanish",
      },
    },
  });

  assert.match(html, /navigation-loading-modal__spinner/);
  assert.match(html, /Translating caption/);
  assert.match(html, /Please wait/);
  assert.match(html, /into Spanish/);
  assert.match(html, /data-action="cancel-editor-image-caption-translation"/);
  assert.match(html, />Cancel<\/button>/);
});

test("image caption translation modal is absent while idle", () => {
  assert.equal(renderEditorImageCaptionTranslationModal({
    editorChapter: {
      imageCaptionTranslationModal: { isOpen: false },
    },
  }), "");
});
