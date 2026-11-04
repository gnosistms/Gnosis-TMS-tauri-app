import test from "node:test";
import assert from "node:assert/strict";

import { editorUploadRefusalReason } from "./editor-upload-refusal.js";
import { MAX_IMPORT_FILE_BYTES } from "./import-file-limit.js";

test("video files are refused by extension or type", () => {
  for (const file of [
    { name: "sermon.mp4" },
    { name: "Clip.MOV" },
    { name: "talk.webm" },
    { name: "/Users/me/Movies/talk.mkv" },
    { name: "recording", type: "video/quicktime" },
  ]) {
    assert.equal(editorUploadRefusalReason(file), "video", file.name);
  }
});

test("audio other than MP3, M4A and WAV is refused as unsupported audio", () => {
  for (const file of [
    { name: "hymn.ogg" },
    { name: "hymn.FLAC" },
    { name: "hymn.aac" },
    { name: "hymn.opus" },
    { name: "voice-memo", type: "audio/amr" },
  ]) {
    assert.equal(editorUploadRefusalReason(file), "unsupported-audio", file.name);
  }
});

test("MP3, M4A and WAV pass whatever type the browser reports", () => {
  assert.equal(editorUploadRefusalReason({ name: "talk.mp3", type: "audio/mpeg" }), "");
  assert.equal(editorUploadRefusalReason({ name: "talk.m4a", type: "video/mp4" }), "");
  assert.equal(editorUploadRefusalReason({ name: "talk.WAV", type: "audio/x-wav" }), "");
});

test("images and unknown files pass to the contents check", () => {
  assert.equal(editorUploadRefusalReason({ name: "photo.png", type: "image/png", size: 4 }), "");
  assert.equal(editorUploadRefusalReason({ name: "notes.txt", type: "text/plain" }), "");
  assert.equal(editorUploadRefusalReason({}), "");
  assert.equal(editorUploadRefusalReason(null), "");
});

test("a file over the upload limit is refused for its size", () => {
  assert.equal(editorUploadRefusalReason({ name: "photo.png", size: MAX_IMPORT_FILE_BYTES + 1 }), "too-large");
  assert.equal(editorUploadRefusalReason({ name: "talk.mp3", size: MAX_IMPORT_FILE_BYTES + 1 }), "too-large");
  assert.equal(editorUploadRefusalReason({ name: "photo.png", size: MAX_IMPORT_FILE_BYTES }), "");
});

test("a large video is refused as a video, not for its size", () => {
  assert.equal(editorUploadRefusalReason({ name: "sermon.mp4", size: MAX_IMPORT_FILE_BYTES * 10 }), "video");
});
