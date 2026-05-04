import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEditorPreviewDocument,
  countEditorPreviewSearchMatches,
  EDITOR_MODE_PREVIEW,
  normalizeEditorPreviewSearchForDocument,
  renderEditorPreviewDocumentHtml,
  serializeEditorPreviewHtml,
  stepEditorPreviewSearchState,
} from "./editor-preview.js";

test("buildEditorPreviewDocument emits target-language text, footnote, and image blocks in order", () => {
  const blocks = buildEditorPreviewDocument([{
    rowId: "row-1",
    lifecycleState: "active",
    textStyle: "heading1",
    fields: { es: "source", vi: "Alpha title" },
    footnotes: { vi: "Footnote first" },
    imageCaptions: { vi: "Image caption alpha" },
    images: {
      vi: {
        kind: "upload",
        path: "chapters/ch-1/images/row-1/image.png",
        filePath: "/tmp/image.png",
      },
    },
  }], "vi");

  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["text", "footnote", "image"],
  );
  assert.equal(blocks[0].textStyle, "heading1");
  assert.equal(blocks[0].text, "Alpha title");
  assert.equal(blocks[1].text, "Footnote first");
  assert.equal(blocks[2].caption, "Image caption alpha");
});

test("buildEditorPreviewDocument skips all deleted-row preview content", () => {
  const blocks = buildEditorPreviewDocument([
    {
      rowId: "row-deleted",
      lifecycleState: "deleted",
      fields: { vi: "Deleted text" },
      footnotes: { vi: "Deleted footnote" },
      imageCaptions: { vi: "Deleted caption" },
      images: {
        vi: {
          kind: "url",
          url: "https://example.com/deleted.png",
        },
      },
    },
    {
      rowId: "row-2",
      lifecycleState: "active",
      textStyle: "paragraph",
      fields: { vi: "" },
      footnotes: { vi: "Visible footnote" },
      imageCaptions: { vi: "Visible caption" },
      images: {
        vi: {
          kind: "url",
          url: "https://example.com/visible.png",
        },
      },
    },
  ], "vi");

  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["footnote", "image"],
  );
  assert.equal(blocks[0].kind, "footnote");
  assert.equal(blocks[0].text, "Visible footnote");
  assert.equal(blocks[1].kind, "image");
  assert.equal(blocks[1].caption, "Visible caption");
  assert.equal(blocks.some((block) => block.rowId === "row-deleted"), false);

  const rendered = renderEditorPreviewDocumentHtml(blocks, {
    resolveImageSrc: (image) => image?.url ?? "",
  }).html;
  assert.match(rendered, /Visible footnote/);
  assert.match(rendered, /Visible caption/);
  assert.match(rendered, /visible\.png/);
  assert.doesNotMatch(rendered, /Deleted text/);
  assert.doesNotMatch(rendered, /Deleted footnote/);
  assert.doesNotMatch(rendered, /Deleted caption/);
  assert.doesNotMatch(rendered, /deleted\.png/);

  const serialized = serializeEditorPreviewHtml(blocks);
  assert.match(serialized, /Visible footnote/);
  assert.match(serialized, /Visible caption/);
  assert.match(serialized, /visible\.png/);
  assert.doesNotMatch(serialized, /Deleted text/);
  assert.doesNotMatch(serialized, /Deleted footnote/);
  assert.doesNotMatch(serialized, /Deleted caption/);
  assert.doesNotMatch(serialized, /deleted\.png/);
});

test("renderEditorPreviewDocumentHtml highlights visible preview text and tracks active match", () => {
  const blocks = buildEditorPreviewDocument([{
    rowId: "row-1",
    lifecycleState: "active",
    textStyle: "paragraph",
    fields: { vi: "Alpha body" },
    footnotes: { vi: "Alpha footnote" },
    imageCaptions: { vi: "Alpha caption" },
    images: {
      vi: {
        kind: "url",
        url: "https://example.com/alpha.png",
      },
    },
  }], "vi");

  const { html, searchState } = renderEditorPreviewDocumentHtml(blocks, {
    searchState: {
      query: "alpha",
      activeMatchIndex: 1,
      totalMatchCount: 0,
    },
    resolveImageSrc: (image) => image?.url ?? "",
  });

  assert.equal(searchState.totalMatchCount, 3);
  assert.match(html, /data-preview-search-match-index="0"/);
  assert.match(html, /data-preview-search-match-index="1"/);
  assert.match(html, /data-preview-search-match-index="2"/);
  assert.match(html, /translate-preview__search-match is-active/);
});

test("preview rendering and serialization preserve supported inline markup", () => {
  const blocks = buildEditorPreviewDocument([{
    rowId: "row-1",
    lifecycleState: "active",
    textStyle: "paragraph",
    fields: { ja: "<strong>Alpha</strong> <ruby>漢字<rt>よみ</rt></ruby>" },
    footnotes: {},
    imageCaptions: {},
    images: {},
  }], "ja");

  const rendered = renderEditorPreviewDocumentHtml(blocks, {
    searchState: {
      query: "よみ",
      activeMatchIndex: 0,
      totalMatchCount: 0,
    },
  });
  const serialized = serializeEditorPreviewHtml(blocks);

  assert.equal(rendered.searchState.totalMatchCount, 1);
  assert.match(rendered.html, /<strong>Alpha<\/strong>/);
  assert.match(rendered.html, /<ruby>漢字<rt><mark class="translate-preview__search-match is-active"/);
  assert.match(serialized, /<strong>Alpha<\/strong>/);
  assert.match(serialized, /<ruby>漢字<rt>よみ<\/rt><\/ruby>/);
});

test("preview search counting and stepping wrap through all matches", () => {
  const blocks = buildEditorPreviewDocument([{
    rowId: "row-1",
    lifecycleState: "active",
    textStyle: "paragraph",
    fields: { vi: "alpha beta alpha" },
    footnotes: {},
    imageCaptions: {},
    images: {},
  }], "vi");

  assert.equal(countEditorPreviewSearchMatches(blocks, "alpha"), 2);
  assert.deepEqual(
    normalizeEditorPreviewSearchForDocument(blocks, {
      query: "alpha",
      activeMatchIndex: 8,
      totalMatchCount: 0,
    }),
    {
      query: "alpha",
      activeMatchIndex: 1,
      totalMatchCount: 2,
    },
  );
  assert.deepEqual(
    stepEditorPreviewSearchState(blocks, {
      query: "alpha",
      activeMatchIndex: 1,
      totalMatchCount: 2,
    }, "next"),
    {
      query: "alpha",
      activeMatchIndex: 0,
      totalMatchCount: 2,
    },
  );
});

test("serializeEditorPreviewHtml uses semantic tags and repo-relative uploaded image paths", () => {
  const blocks = buildEditorPreviewDocument([
    {
      rowId: "row-1",
      lifecycleState: "active",
      textStyle: "heading1",
      fields: { vi: "Chapter Title" },
      footnotes: {},
      imageCaptions: {},
      images: {},
    },
    {
      rowId: "row-2",
      lifecycleState: "active",
      textStyle: "quote",
      fields: { vi: "Quoted line" },
      footnotes: { vi: "Footnote line" },
      imageCaptions: { vi: "Caption line" },
      images: {
        vi: {
          kind: "upload",
          path: "chapters/chapter-1/images/row-2/image.png",
          filePath: "/tmp/row-2/image.png",
        },
      },
    },
  ], "vi");

  const html = serializeEditorPreviewHtml(blocks);

  assert.match(html, /<h1>Chapter Title<\/h1>/);
  assert.match(html, /<blockquote>Quoted line<\/blockquote>/);
  assert.match(html, /<p><em>Footnote line<\/em><\/p>/);
  assert.match(html, /<figure/);
  assert.match(html, /src="chapters\/chapter-1\/images\/row-2\/image.png"/);
  assert.match(html, /<figcaption/);
  assert.doesNotMatch(html, /class=/);
});

test("serializeEditorPreviewHtml uses centered HTML for centered plain text", () => {
  const blocks = buildEditorPreviewDocument([{
    rowId: "row-1",
    lifecycleState: "active",
    textStyle: "centered",
    fields: { vi: "Centered line" },
    footnotes: {},
    imageCaptions: {},
    images: {},
  }], "vi");

  const html = serializeEditorPreviewHtml(blocks);

  assert.match(html, /<center><p>Centered line<\/p><\/center>/);
});

test("preview mode constant remains stable", () => {
  assert.equal(EDITOR_MODE_PREVIEW, "preview");
});
