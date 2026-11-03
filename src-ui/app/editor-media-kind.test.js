import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  editorFieldMedia,
  editorMediaForUploadPath,
  editorMediaForUrl,
  editorVideoEmbedUrl,
  editorVideoStaticThumbnailUrl,
} from "./editor-media-kind.js";

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../tests/fixtures/editor-media-kind/cases.json", import.meta.url)),
    "utf8",
  ),
);

for (const fixtureCase of fixture.cases) {
  const input = fixtureCase.url ?? fixtureCase.uploadPath;
  test(`media kind of ${input}`, () => {
    const media = fixtureCase.url !== undefined
      ? editorMediaForUrl(fixtureCase.url)
      : editorMediaForUploadPath(fixtureCase.uploadPath);
    assert.deepEqual(
      { ...media },
      {
        kind: fixtureCase.kind,
        provider: fixtureCase.provider ?? null,
        id: fixtureCase.id ?? null,
        hash: fixtureCase.hash ?? null,
      },
    );
  });
}

test("field media reads the url or the uploaded path", () => {
  assert.equal(editorFieldMedia({ kind: "url", url: "https://youtu.be/dQw4w9WgXcQ" }).kind, "video");
  assert.equal(editorFieldMedia({ kind: "upload", path: "images/a/talk.mp3" }).kind, "audio");
  assert.equal(editorFieldMedia({ kind: "upload", path: "", fileName: "talk.wav" }).kind, "audio");
  assert.equal(editorFieldMedia(null).kind, "image");
});

test("video embed urls use each provider's player", () => {
  assert.equal(
    editorVideoEmbedUrl(editorMediaForUrl("https://youtu.be/dQw4w9WgXcQ"), { autoplay: true }),
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&autoplay=1",
  );
  assert.equal(
    editorVideoEmbedUrl(editorMediaForUrl("https://vimeo.com/76979871/8272103f6e")),
    "https://player.vimeo.com/video/76979871?h=8272103f6e&autoplay=0",
  );
  assert.equal(
    editorVideoEmbedUrl(editorMediaForUrl("https://videopress.com/v/OcobLTqC"), { autoplay: true }),
    "https://video.wordpress.com/embed/OcobLTqC?autoPlay=true",
  );
  assert.equal(editorVideoEmbedUrl(editorMediaForUrl("https://example.org/talk.mp4")), "");
});

test("only youtube has a thumbnail without a lookup", () => {
  assert.equal(
    editorVideoStaticThumbnailUrl(editorMediaForUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")),
    "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  );
  assert.equal(editorVideoStaticThumbnailUrl(editorMediaForUrl("https://vimeo.com/76979871")), "");
});
