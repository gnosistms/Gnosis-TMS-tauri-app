import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { audioFootnoteText, stripCaptionEndPunctuation } from "./editor-audio-footnote.js";

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../tests/fixtures/audio-footnote/caption-cases.json", import.meta.url)),
    "utf8",
  ),
);

test("caption punctuation matches the shared fixture", () => {
  assert.ok(fixture.cases.length > 0);
  for (const { caption, stripped } of fixture.cases) {
    assert.equal(stripCaptionEndPunctuation(caption), stripped, `case ${JSON.stringify(caption)}`);
  }
});

test("an audio footnote joins the caption and the address", () => {
  const image = { kind: "url", url: "https://example.org/talk.mp3?a=1&b=2" };
  assert.equal(
    audioFootnoteText(image, "Evening talk."),
    "Evening talk: <a href=\"https://example.org/talk.mp3?a=1&amp;b=2\">https://example.org/talk.mp3?a=1&b=2</a>",
  );
  assert.equal(
    audioFootnoteText(image, "Evening talk.", { links: false }),
    "Evening talk: https://example.org/talk.mp3?a=1&b=2",
  );
  assert.equal(audioFootnoteText(image, " <em> </em> ", { links: false }), "https://example.org/talk.mp3?a=1&b=2");
  assert.equal(
    audioFootnoteText({ kind: "upload", path: "chapters/ch-1/images/row/chant.m4a" }, "Chant!"),
    "Chant: chant.m4a",
  );
});
