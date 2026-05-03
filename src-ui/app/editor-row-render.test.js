import test from "node:test";
import assert from "node:assert/strict";

import {
  cacheEditorImagePreviewFrameSizeForTests,
  clearEditorImagePreviewFrameSizeCacheForTests,
} from "./editor-image-preview-size.js";
import { renderTranslationContentRow } from "./editor-row-render.js";

function rowWithSection(section) {
  return {
    kind: "row",
    id: "row-1",
    rowId: "row-1",
    lifecycleState: "active",
    textStyle: "paragraph",
    canInsert: false,
    canSoftDelete: false,
    canReplaceSelect: false,
    hasConflict: false,
    sections: [{
      code: "vi",
      name: "Vietnamese",
      text: "",
      footnote: "",
      imageCaption: "",
      image: null,
      hasVisibleFootnote: false,
      hasVisibleImageCaption: false,
      isFootnoteEditorOpen: false,
      isImageCaptionEditorOpen: false,
      isImageUrlEditorOpen: false,
      isImageUploadEditorOpen: false,
      isImageUrlSubmitting: false,
      showInvalidImageUrl: false,
      imageUrlErrorMessage: "",
      imageUrlDraft: "",
      showAddFootnoteButton: true,
      showAddImageButtons: false,
      showAddImageCaptionButton: false,
      isTextEditorOpen: false,
      isActive: false,
      reviewed: false,
      pleaseCheck: false,
      hasConflict: false,
      conflictDisabled: false,
      markerSaveState: { status: "idle", languageCode: null, kind: null, error: "" },
      showCommentsButton: false,
      hasComments: false,
      hasUnreadComments: false,
      isSelectedCommentsRow: false,
      ...section,
    }],
  };
}

test("renderTranslationContentRow shows a clickable loading image URL state", () => {
  const html = renderTranslationContentRow(rowWithSection({
    hasVisibleImage: true,
    isImageUrlSubmitting: true,
    imageUrlDraft: "https://example.com/image.png",
  }));

  assert.match(html, /Loading image\.\.\./);
  assert.match(html, /data-action="open-editor-image-url"/);
  assert.match(html, /data-editor-image-url-status-button/);
});

test("renderTranslationContentRow makes image URL errors reopen the URL editor", () => {
  const html = renderTranslationContentRow(rowWithSection({
    hasVisibleImage: true,
    showInvalidImageUrl: true,
    imageUrlErrorMessage: "The image URL could not be loaded.",
    imageUrlDraft: "https://example.com/nope.png",
  }));

  assert.match(html, /The image URL could not be loaded\./);
  assert.match(html, /data-action="open-editor-image-url"/);
  assert.match(html, /data-editor-image-url-status-button/);
});

test("renderTranslationContentRow makes image URL preview tooltips hang right", () => {
  const html = renderTranslationContentRow(rowWithSection({
    hasVisibleImage: true,
    image: {
      kind: "url",
      url: "https://example.com/path/to/a/long/image-name.webp",
    },
    showAddImageCaptionButton: true,
  }));

  assert.match(html, /data-action="open-editor-image-preview"/);
  assert.match(html, /data-tooltip-align="start"/);
});

test("renderTranslationContentRow shows a placeholder while image preview dimensions load", () => {
  clearEditorImagePreviewFrameSizeCacheForTests();
  const html = renderTranslationContentRow(rowWithSection({
    hasVisibleImage: true,
    image: {
      kind: "url",
      url: "https://example.com/path/to/a/large-image.webp",
    },
  }));

  assert.match(html, /class="translation-language-panel__image-preview is-loading"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /data-editor-image-loading-placeholder/);
  assert.match(html, /Loading image\.\.\./);
});

test("renderTranslationContentRow reuses cached image preview dimensions without loading state", () => {
  const url = "https://example.com/path/to/reused-image.webp";
  clearEditorImagePreviewFrameSizeCacheForTests();
  cacheEditorImagePreviewFrameSizeForTests(url, {
    contentWidth: 33,
    contentHeight: 100,
    frameWidth: 51,
    frameHeight: 118,
  });

  const html = renderTranslationContentRow(rowWithSection({
    hasVisibleImage: true,
    image: {
      kind: "url",
      url,
    },
  }));

  assert.match(html, /data-action="open-editor-image-preview"/);
  assert.doesNotMatch(html, /class="translation-language-panel__image-preview is-loading"/);
  assert.doesNotMatch(html, /aria-busy="true"/);
  assert.match(html, /--editor-image-preview-width: 51px;/);
  assert.match(html, /--editor-image-preview-content-height: 100px;/);
});
