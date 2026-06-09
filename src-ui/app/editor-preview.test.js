import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEditorPreviewDocument,
  countEditorPreviewSearchMatches,
  EDITOR_MODE_PREVIEW,
  normalizeEditorPreviewSearchForDocument,
  renderEditorPreviewDocumentHtml,
  selectedEditorPreviewLanguageCode,
  serializeEditorPreviewHtml,
  stepEditorPreviewSearchState,
} from "./editor-preview.js";

test("selectedEditorPreviewLanguageCode allows previewing the source language", () => {
  const chapterState = {
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "vi", name: "Vietnamese", role: "target" },
    ],
    selectedSourceLanguageCode: "es",
    selectedTargetLanguageCode: "vi",
    previewLanguageCode: "es",
  };

  assert.equal(selectedEditorPreviewLanguageCode(chapterState), "es");
  assert.equal(selectedEditorPreviewLanguageCode({
    ...chapterState,
    previewLanguageCode: "missing",
  }), "vi");
});

test("buildEditorPreviewDocument attaches target-language footnotes to text blocks", () => {
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
    ["text", "image"],
  );
  assert.equal(blocks[0].textStyle, "heading1");
  assert.equal(blocks[0].text, "Alpha title");
  assert.deepEqual(blocks[0].footnotes, [{ marker: 1, text: "Footnote first" }]);
  assert.equal(blocks[1].caption, "Image caption alpha");
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
    ["text", "image"],
  );
  assert.equal(blocks[0].kind, "text");
  assert.equal(blocks[0].text, "");
  assert.deepEqual(blocks[0].footnotes, [{ marker: 1, text: "Visible footnote" }]);
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
  assert.match(serialized, /<!-- wp:footnotes \/-->/);
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

test("preview footnote refs preserve inline markup when markers are inside tags", () => {
  const blocks = buildEditorPreviewDocument([{
    rowId: "row-1",
    lifecycleState: "active",
    textStyle: "paragraph",
    fields: { vi: "<strong>Alpha [1] body</strong>" },
    footnotes: { vi: "Marked note" },
    imageCaptions: {},
    images: {},
  }], "vi");

  const html = serializeEditorPreviewHtml(blocks);

  assert.match(html, /<!-- wp:paragraph -->/);
  assert.match(html, /<strong>Alpha <sup data-fn="[0-9a-f-]{36}" class="fn">/);
  assert.match(html, /<a id="[0-9a-f-]{36}-link" href="#[0-9a-f-]{36}">1<\/a>/);
  assert.match(html, /<\/sup> body<\/strong>/);
  assert.doesNotMatch(html, /&lt;\/strong&gt;/);
});

test("preview appends footnote refs with no matching marker without changing text", () => {
  const blocks = buildEditorPreviewDocument([{
    rowId: "row-1",
    lifecycleState: "active",
    textStyle: "paragraph",
    fields: { vi: "Alpha body [100]" },
    footnotes: {
      vi: [
        { marker: 3, text: "Third note" },
        { marker: 1, text: "First note" },
      ],
    },
    imageCaptions: {},
    images: {},
  }], "vi");

  const html = serializeEditorPreviewHtml(blocks);

  assert.match(html, /Alpha body \[100\] <sup data-fn="[0-9a-f-]{36}" class="fn">/);
  assert.match(html, /<\/sup> <sup data-fn="[0-9a-f-]{36}" class="fn"><a id="[0-9a-f-]{36}-link" href="#[0-9a-f-]{36}">2<\/a><\/sup>/);
});

test("preview ignores escaped literal markers before footnote refs", () => {
  const blocks = buildEditorPreviewDocument([{
    rowId: "row-1",
    lifecycleState: "active",
    textStyle: "paragraph",
    fields: { vi: "Literal \\[100\\] then note [1] end" },
    footnotes: {
      vi: [{ marker: 1, text: "One" }],
    },
    imageCaptions: {},
    images: {},
  }], "vi");

  const html = serializeEditorPreviewHtml(blocks);

  assert.match(html, /Literal \[100\] then note <sup data-fn="[0-9a-f-]{36}" class="fn">/);
  assert.match(html, /<\/sup> end<\/p>/);
  assert.doesNotMatch(html, /\[1<sup/);
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

  assert.match(html, /^<meta charset='utf-8'>/);
  assert.match(html, /<!-- wp:heading \{"level":1\} -->/);
  assert.match(html, /<h1>Chapter Title<\/h1>/);
  assert.match(html, /<!-- wp:quote -->/);
  assert.match(html, /<blockquote class="wp-block-quote"><p>Quoted line <sup data-fn="[0-9a-f-]{36}" class="fn">/);
  assert.match(html, /<!-- wp:footnotes \/-->/);
  assert.doesNotMatch(html, /<ol class="wp-block-footnotes">/);
  assert.match(html, /<figure/);
  assert.match(html, /src="chapters\/chapter-1\/images\/row-2\/image.png"/);
  assert.match(html, /<figcaption/);
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

  assert.match(html, /<!-- wp:paragraph \{"align":"center"\} -->/);
  assert.match(html, /<p class="has-text-align-center">Centered line<\/p>/);
});

test("preview mode constant remains stable", () => {
  assert.equal(EDITOR_MODE_PREVIEW, "preview");
});
