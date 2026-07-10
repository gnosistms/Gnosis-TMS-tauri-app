import test from "node:test";
import assert from "node:assert/strict";

import {
  cacheEditorImagePreviewFrameSizeForTests,
  clearEditorImagePreviewFrameSizeCacheForTests,
} from "./editor-image-preview-size.js";
import { renderTranslationContentRow } from "./editor-row-render.js";

test("renderTranslationContentRow renders the deleted-run end marker as a collapse action", () => {
  const html = renderTranslationContentRow({
    kind: "deleted-group-end",
    id: "deleted-group-end:row-1:row-2",
    groupId: "row-1:row-2",
    label: "End deleted rows",
  });

  assert.match(html, /translation-deleted-group--end/);
  assert.match(html, /End deleted rows/);
  assert.match(html, /data-action="toggle-editor-deleted-row-group:row-1:row-2"/);
});

test("renderTranslationContentRow marks the whole deleted row shell for indentation", () => {
  const html = renderTranslationContentRow({
    id: "row-1",
    kind: "row",
    lifecycleState: "deleted",
    sections: [],
  });

  assert.match(html, /class="translation-row-shell is-deleted"/);
});

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

test("renderTranslationContentRow keeps marker buttons clickable while marker save is pending", () => {
  const html = renderTranslationContentRow(rowWithSection({
    canEdit: true,
    markerSaveState: {
      status: "saving",
      languageCode: "vi",
      kind: "please-check",
      error: "",
    },
  }));

  assert.match(html, /data-action="toggle-editor-please-check"/);
  assert.doesNotMatch(html, /translation-marker-button--please-check[^"]* is-saving/);
  assert.doesNotMatch(html, /data-action="toggle-editor-please-check"[\s\S]*?disabled[\s\S]*?>/);
});

test("renderTranslationContentRow keeps marker buttons clickable while row text save is pending", () => {
  const html = renderTranslationContentRow({
    ...rowWithSection({ canEdit: true }),
    saveStatus: "saving",
  });

  assert.match(html, /data-action="toggle-editor-reviewed"/);
  assert.doesNotMatch(html, /data-action="toggle-editor-reviewed"[\s\S]*?disabled[\s\S]*?>/);
});

test("renderTranslationContentRow keeps text style buttons clickable while style save is pending", () => {
  const html = renderTranslationContentRow({
    ...rowWithSection({ canEdit: true }),
    canEdit: true,
    textStyleSaveState: {
      status: "saving",
      error: "",
    },
  });

  assert.match(html, /data-editor-row-text-style-button/);
  assert.doesNotMatch(html, /translation-row-text-style-button[^"]* is-saving/);
  assert.doesNotMatch(html, /data-action="set-editor-row-text-style"[\s\S]*?disabled[\s\S]*?>/);
});

test("renderTranslationContentRow places separator button after image upload when image buttons show", () => {
  const html = renderTranslationContentRow({
    ...rowWithSection({
      canEdit: true,
      isTextEditorOpen: true,
      showAddImageButtons: true,
    }),
    canEdit: true,
  });

  assert.match(html, /data-action="open-editor-image-upload"[\s\S]*data-action="insert-editor-separator"/);
  assert.match(html, /data-editor-separator-button/);
  assert.match(html, />--<\/span>/);
});

test("renderTranslationContentRow renders static separator markup as a line span", () => {
  const html = renderTranslationContentRow({
    ...rowWithSection({
      canEdit: true,
      text: "Alpha<hr>Beta",
    }),
    canEdit: true,
  });

  assert.match(html, /translation-language-panel__inline-separator/);
  assert.doesNotMatch(html, /<hr>/);
});

test("renderTranslationContentRow keeps conflict text inside the language field stack", () => {
  const html = renderTranslationContentRow({
    ...rowWithSection({
      canEdit: true,
      hasConflict: true,
      text: "Conflict text",
    }),
    canEdit: true,
    hasConflict: true,
  });

  assert.match(
    html,
    /translation-language-panel__field-stack[\s\S]*translation-language-panel__field-static--conflict/,
  );
  assert.doesNotMatch(
    html,
    /<section[^>]*>\s*<div class="translation-language-panel__field-static translation-language-panel__field-static--conflict"/,
  );
});

test("renderTranslationContentRow renders editor row textareas with one intrinsic row", () => {
  const html = renderTranslationContentRow({
    ...rowWithSection({
      canEdit: true,
      text: "CHUONG 4",
      footnotes: [{ marker: 1, text: "Footnote" }],
      hasVisibleFootnote: true,
      isTextEditorOpen: true,
      openFootnoteMarker: 1,
    }),
    canEdit: true,
  });

  const textareaTags = html.match(/<textarea[\s\S]*?<\/textarea>/g) ?? [];
  assert.equal(textareaTags.length, 2);
  for (const tag of textareaTags) {
    assert.match(tag, /\srows="1"/);
  }
});

test("renderTranslationContentRow renders a closed footnote as a static live-markup display", () => {
  const html = renderTranslationContentRow({
    ...rowWithSection({
      canEdit: true,
      text: "CHUONG 4",
      footnotes: [{ marker: 1, text: 'See <a href="https://example.com">link</a>' }],
      hasVisibleFootnote: true,
      isTextEditorOpen: true,
      openFootnoteMarker: null,
    }),
    canEdit: true,
  });

  // The closed footnote renders as a click-to-edit display button, not a textarea,
  // with its inline markup rendered as a live link.
  assert.match(html, /data-editor-footnote-display[\s\S]*?data-footnote-marker="1"/);
  assert.match(html, /<a href="https:\/\/example\.com">link<\/a>/);
  assert.doesNotMatch(html, /<textarea[^>]*data-content-kind="footnote"/);
});

test("renderTranslationContentRow renders valid static footnote markers as non-link superscripts", () => {
  const html = renderTranslationContentRow({
    ...rowWithSection({
      canEdit: true,
      text: "foo [1] [2]",
      footnotes: [
        { marker: 1, text: "First footnote" },
        { marker: 2, text: "Second footnote" },
      ],
      hasVisibleFootnote: true,
    }),
    canEdit: true,
  });

  const displayField = html.match(/<button[\s\S]*data-editor-display-field[\s\S]*?<\/button>/)?.[0] ?? "";

  assert.match(
    displayField,
    /foo <sup class="translation-language-panel__inline-footnote" aria-label="Footnote 1">1<\/sup> <sup class="translation-language-panel__inline-footnote" aria-label="Footnote 2">2<\/sup>/,
  );
  assert.doesNotMatch(displayField, /\[1\]|\[2\]/);
  assert.doesNotMatch(displayField, /href=/);
});

test("renderTranslationContentRow keeps invalid static footnote markers literal", () => {
  const html = renderTranslationContentRow({
    ...rowWithSection({
      canEdit: true,
      text: "foo [100]",
      footnotes: [{ marker: 1, text: "First footnote" }],
      hasVisibleFootnote: true,
    }),
    canEdit: true,
  });

  const displayField = html.match(/<button[\s\S]*data-editor-display-field[\s\S]*?<\/button>/)?.[0] ?? "";

  assert.match(displayField, /foo \[100\]/);
  assert.doesNotMatch(displayField, /translation-language-panel__inline-footnote/);
});

test("renderTranslationContentRow renders conflict footnote markers as non-link superscripts", () => {
  const html = renderTranslationContentRow({
    ...rowWithSection({
      canEdit: true,
      hasConflict: true,
      text: "foo [1]",
      footnotes: [{ marker: 1, text: "Conflict footnote" }],
    }),
    canEdit: true,
    hasConflict: true,
  });

  const conflictField = html.match(/translation-language-panel__field-static--conflict[\s\S]*?<\/button>/)?.[0] ?? "";

  assert.match(
    conflictField,
    /foo <sup class="translation-language-panel__inline-footnote" aria-label="Footnote 1">1<\/sup>/,
  );
  assert.doesNotMatch(conflictField, /\[1\]/);
  assert.doesNotMatch(conflictField, /href=/);
});

test("renderTranslationContentRow keeps footnote markers literal while editing main text", () => {
  const html = renderTranslationContentRow({
    ...rowWithSection({
      canEdit: true,
      text: "foo [1]",
      footnotes: [{ marker: 1, text: "Footnote" }],
      hasVisibleFootnote: true,
      isTextEditorOpen: true,
    }),
    canEdit: true,
  });

  assert.match(html, /<textarea[\s\S]*data-editor-row-field[\s\S]*>foo \[1\]<\/textarea>/);
  assert.doesNotMatch(html, /translation-language-panel__inline-footnote/);
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

test("renderTranslationContentRow offers a custom HTML style button to the right of C", () => {
  const html = renderTranslationContentRow({
    ...rowWithSection({ canEdit: true }),
    canEdit: true,
  });

  // The <> button stays near the least common styles, immediately after centered (C).
  assert.match(html, /data-text-style="indented"[\s\S]*?data-text-style="centered"[\s\S]*?data-text-style="custom_html"/);
  assert.match(html, /Custom HTML styling/);
  assert.match(html, /&lt;&gt;<\/span>/);
});

test("renderTranslationContentRow hides inline and secondary buttons for custom HTML rows", () => {
  const html = renderTranslationContentRow({
    ...rowWithSection({
      canEdit: true,
      showAddFootnoteButton: true,
      showAddImageButtons: true,
    }),
    canEdit: true,
    textStyle: "custom_html",
  });

  // The style radiogroup (including <>) stays so the user can switch back...
  assert.match(html, /data-text-style="custom_html"/);
  // ...but inline-markup and secondary buttons do not apply to raw HTML.
  assert.doesNotMatch(html, /data-editor-inline-style-button/);
  assert.doesNotMatch(html, /data-action="open-editor-insert-link"/);
  assert.doesNotMatch(html, /data-action="insert-editor-separator"/);
  assert.doesNotMatch(html, /data-action="open-editor-footnote"/);
  assert.doesNotMatch(html, /data-action="open-editor-image-url"/);
});

test("renderTranslationContentRow gives custom HTML rows a monospace editing field", () => {
  const html = renderTranslationContentRow({
    ...rowWithSection({
      canEdit: true,
      isTextEditorOpen: true,
      text: "<b>raw</b>",
    }),
    canEdit: true,
    textStyle: "custom_html",
  });

  assert.match(html, /translation-language-panel__field--custom-html/);
  assert.match(html, /data-row-text-style="custom_html"/);
});
