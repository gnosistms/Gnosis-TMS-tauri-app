import test from "node:test";
import assert from "node:assert/strict";

import { renderEditorImageInvalidFileModal } from "./editor-image-invalid-file-modal.js";

function renderModal(fields) {
  return renderEditorImageInvalidFileModal({
    editorChapter: {
      imageInvalidFileModal: { isOpen: true, status: "idle", error: "", reason: "", fileName: "", ...fields },
    },
  });
}

test("invalid-file modal is not drawn while closed", () => {
  assert.equal(renderEditorImageInvalidFileModal({ editorChapter: { imageInvalidFileModal: { isOpen: false } } }), "");
});

test("a file that could not be opened keeps the general message", () => {
  const html = renderModal({});
  assert.match(html, /Invalid file/);
  assert.match(html, /The file you uploaded is not a valid image or audio file, or could not be opened\./);
  assert.doesNotMatch(html, /modal__supporting/);
  assert.match(html, /data-action="close-editor-image-invalid-file-modal"/);
});

test("a video file says to insert the video by URL instead", () => {
  const html = renderModal({ reason: "video", fileName: "sermon.mp4" });
  assert.match(html, /Video files can&#39;t be uploaded\./);
  assert.match(html, /To add &#39;sermon\.mp4&#39;, put it online[^<]*insert it by URL instead\./);
});

test("unsupported audio names the formats that work", () => {
  const html = renderModal({ reason: "unsupported-audio", fileName: "hymn.ogg" });
  assert.match(html, /This audio format is not supported\./);
  assert.match(html, /Audio must be an MP3, M4A or WAV file\. Convert &#39;hymn\.ogg&#39; to one of these formats/);
});

test("an oversized file names the limit", () => {
  const html = renderModal({ reason: "too-large", fileName: "talk.wav" });
  assert.match(html, /This file is too large\./);
  assert.match(html, /&#39;talk\.wav&#39; is larger than the 25 MB upload limit\./);
});

test("a refusal without a file name still reads as a sentence", () => {
  assert.match(renderModal({ reason: "video" }), /To add a video, put it online/);
  assert.match(renderModal({ reason: "unsupported-audio" }), /Convert the recording to one of these formats/);
  assert.match(renderModal({ reason: "too-large" }), /The file is larger than the 25 MB upload limit/);
});
