import test from "node:test";
import assert from "node:assert/strict";

import { renderEditorWordPressExportSuccessModal } from "./editor-wordpress-export-success-modal.js";

function stateWithModal(modal) {
  return { editorChapter: { chapterId: "chapter-1", wordpressExportSuccessModal: modal } };
}

test("draft success modal links to the WordPress editor with publish guidance", () => {
  const html = renderEditorWordPressExportSuccessModal(stateWithModal({
    isOpen: true,
    isDraft: true,
    url: "https://wordpress.com/post/12345/24994",
  }));

  assert.match(html, /WORDPRESS EXPORT/);
  assert.match(html, /Content successfully exported to Wordpress/);
  assert.match(html, /still an unpublished draft\. To preview and publish, click the link below/);
  assert.match(html, /<a href="https:\/\/wordpress\.com\/post\/12345\/24994">/);
  assert.match(html, /data-action="close-wordpress-export-success-modal"/);
});

test("published success modal links to the live post", () => {
  const html = renderEditorWordPressExportSuccessModal(stateWithModal({
    isOpen: true,
    isDraft: false,
    url: "https://example.com/2026/06/11/chapter-3/",
  }));

  assert.match(html, /Your content was exported to Wordpress\. To see it, click the link below\./);
  assert.doesNotMatch(html, /unpublished draft/);
  assert.match(html, /<a href="https:\/\/example\.com\/2026\/06\/11\/chapter-3\/">/);
});

test("modal renders nothing when closed or without a url", () => {
  assert.equal(
    renderEditorWordPressExportSuccessModal(stateWithModal({ isOpen: false, isDraft: false, url: "" })),
    "",
  );
  assert.equal(
    renderEditorWordPressExportSuccessModal(stateWithModal({ isOpen: true, isDraft: true, url: "" })),
    "",
  );
});
