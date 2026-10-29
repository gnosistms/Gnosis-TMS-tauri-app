import test from "node:test";
import assert from "node:assert/strict";

import { renderEditorImageReuseModal } from "./editor-image-reuse-modal.js";

function renderModal(modal) {
  return renderEditorImageReuseModal({
    editorChapter: {
      imageReuseModal: {
        isOpen: true,
        chapterTitles: ["Chapter 1"],
        dontShowAgain: false,
        ...modal,
      },
    },
  });
}

test("image reuse modal renders nothing while closed", () => {
  assert.equal(renderEditorImageReuseModal({ editorChapter: { imageReuseModal: { isOpen: false } } }), "");
});

test("image reuse modal names the files that already use the image", () => {
  const html = renderModal({ chapterTitles: ["Appendix", "Chapter <1>", "Epilogue"] });

  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /data-modal-dialog="editor-image-reuse"/);
  assert.match(html, /<h2 class="modal__title" id="editor-image-reuse-title">Duplicate image<\/h2>/);
  assert.match(
    html,
    /This same image was also used in Appendix, Chapter &lt;1&gt;, and Epilogue\. Are you sure you want to use it again here\?/,
  );
});

test("image reuse modal offers cancel, insert and a per-image don't-show-again choice", () => {
  const html = renderModal({ dontShowAgain: true });

  assert.match(html, /data-action="cancel-editor-image-reuse" data-modal-cancel/);
  assert.match(
    html,
    /data-action="confirm-editor-image-reuse" data-modal-default data-modal-initial-focus>Insert image</,
  );
  assert.match(html, /data-editor-image-reuse-dont-show-again\s+checked/);
  assert.match(html, /Don't show this warning again for this image\./);
});
