import test from "node:test";
import assert from "node:assert/strict";

import { renderEditorImagePreviewOverlay } from "./editor-image-preview-overlay.js";

test("full-size URL image preview exposes original URL context metadata", () => {
  const html = renderEditorImagePreviewOverlay({
    editorChapter: {
      imagePreviewOverlay: {
        isOpen: true,
        rowId: "row-1",
        languageCode: "vi",
        src: "https://example.com/image.png",
        imageUrl: "https://example.com/image.png",
      },
    },
  });

  assert.match(html, /data-editor-image-context-menu-target/);
  assert.match(html, /data-row-id="row-1"/);
  assert.match(html, /data-language-code="vi"/);
  assert.match(html, /data-image-url="https:\/\/example\.com\/image\.png"/);
  assert.match(html, /tabindex="0"/);
});

test("full-size uploaded preview omits URL context metadata", () => {
  const html = renderEditorImagePreviewOverlay({
    editorChapter: {
      imagePreviewOverlay: {
        isOpen: true,
        rowId: "row-1",
        languageCode: "vi",
        src: "asset://localhost/image.png",
        imageUrl: "",
      },
    },
  });

  assert.match(html, /data-editor-image-context-menu-target/);
  assert.doesNotMatch(html, /data-image-url=/);
});
