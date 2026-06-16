import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEditorPreviewDocument,
  countEditorPreviewSearchMatches,
  EDITOR_MODE_PREVIEW,
  extractWordPressLeadingHeadingTitle,
  normalizeEditorPreviewSearchForDocument,
  renderEditorPreviewDocumentHtml,
  selectedEditorPreviewLanguageCode,
  serializeEditorPreviewHtml,
  serializeEditorPreviewPlainText,
  serializeEditorPreviewWordPress,
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

test("renderEditorPreviewDocumentHtml keeps row and language metadata on text blocks", () => {
  const blocks = buildEditorPreviewDocument([{
    rowId: "row-1",
    lifecycleState: "active",
    textStyle: "paragraph",
    fields: { vi: "Alpha body" },
    footnotes: {},
    imageCaptions: {},
    images: {},
  }], "vi");

  const { html } = renderEditorPreviewDocumentHtml(blocks);

  assert.match(
    html,
    /<p class="translate-preview__block translate-preview__block--paragraph" data-preview-block="paragraph" data-row-id="row-1" lang="vi">Alpha body<\/p>/,
  );
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

test("preview rendering splits separator markup into a horizontal rule block", () => {
  const blocks = buildEditorPreviewDocument([{
    rowId: "row-1",
    lifecycleState: "active",
    textStyle: "paragraph",
    fields: { vi: "Alpha<hr>Beta" },
    footnotes: {},
    imageCaptions: {},
    images: {},
  }], "vi");

  const rendered = renderEditorPreviewDocumentHtml(blocks);
  const serialized = serializeEditorPreviewWordPress(blocks);
  const plainText = serializeEditorPreviewPlainText(blocks);

  assert.match(rendered.html, /<p class="translate-preview__block translate-preview__block--paragraph"[^>]*>Alpha<\/p><hr class="translate-preview__separator"/);
  assert.match(rendered.html, /<hr class="translate-preview__separator"[\s\S]*<p class="translate-preview__block translate-preview__block--paragraph"[^>]*>Beta<\/p>/);
  assert.match(
    serialized.content,
    /<!-- wp:paragraph -->\n<p>Alpha<\/p>\n<!-- \/wp:paragraph -->\n\n<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"\/>\n<!-- \/wp:separator -->\n\n<!-- wp:paragraph -->\n<p>Beta<\/p>/,
  );
  assert.equal(plainText, "Alpha\n\n---\n\nBeta");
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

test("preview footnotes do not render an automatic separator", () => {
  const blocks = buildEditorPreviewDocument([{
    rowId: "row-1",
    lifecycleState: "active",
    textStyle: "paragraph",
    fields: { vi: "Alpha body [1]" },
    footnotes: { vi: "Plain note" },
    imageCaptions: {},
    images: {},
  }], "vi");

  const { html } = renderEditorPreviewDocumentHtml(blocks);

  assert.match(html, /<ol class="wp-block-footnotes">/);
  assert.doesNotMatch(html, /translate-preview__separator[\s\S]*wp-block-footnotes/);
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
  assert.match(html, /<h1 class="wp-block-heading">Chapter Title<\/h1>/);
  assert.match(html, /<!-- wp:quote -->/);
  assert.match(
    html,
    /<blockquote class="wp-block-quote"><!-- wp:paragraph -->\n<p>Quoted line <sup data-fn="[0-9a-f-]{36}" class="fn">/,
  );
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

  assert.match(html, /<!-- wp:paragraph \{"style":\{"typography":\{"textAlign":"center"\}\}\} -->/);
  assert.match(html, /<p class="has-text-align-center">Centered line<\/p>/);
});

test("serializeEditorPreviewPlainText strips markup and numbers footnotes across blocks", () => {
  const blocks = buildEditorPreviewDocument([
    {
      rowId: "row-1",
      lifecycleState: "active",
      textStyle: "heading1",
      fields: { vi: "<strong>Title</strong>" },
      imageCaptions: {},
      images: {},
    },
    {
      rowId: "row-2",
      lifecycleState: "active",
      textStyle: "paragraph",
      fields: { vi: "Alpha [1] body" },
      footnotes: { vi: [{ marker: 1, text: "First note" }] },
      imageCaptions: {},
      images: {},
    },
    {
      rowId: "row-3",
      lifecycleState: "active",
      textStyle: "paragraph",
      fields: { vi: "Beta end" },
      footnotes: { vi: [{ marker: 1, text: "Second note" }] },
      imageCaptions: {},
      images: {},
    },
  ], "vi");

  const text = serializeEditorPreviewPlainText(blocks);

  assert.equal(text, [
    "Title",
    "Alpha [1] body",
    "Beta end [2]",
    "[1] First note\n[2] Second note",
  ].join("\n\n"));
});

test("serializeEditorPreviewPlainText keeps escaped literal markers as text", () => {
  const blocks = buildEditorPreviewDocument([{
    rowId: "row-1",
    lifecycleState: "active",
    textStyle: "paragraph",
    fields: { vi: "Literal \\[100\\] then note [1] end" },
    footnotes: { vi: [{ marker: 1, text: "One" }] },
    imageCaptions: {},
    images: {},
  }], "vi");

  const text = serializeEditorPreviewPlainText(blocks);

  assert.equal(text, "Literal [100] then note [1] end\n\n[1] One");
});

test("serializeEditorPreviewPlainText includes image captions and skips captionless images", () => {
  const blocks = buildEditorPreviewDocument([
    {
      rowId: "row-1",
      lifecycleState: "active",
      textStyle: "paragraph",
      fields: { vi: "Before image" },
      imageCaptions: { vi: "A <em>nice</em> caption" },
      images: { vi: { kind: "url", url: "https://example.com/image.png" } },
    },
    {
      rowId: "row-2",
      lifecycleState: "active",
      textStyle: "paragraph",
      fields: {},
      imageCaptions: {},
      images: { vi: { kind: "url", url: "https://example.com/plain.png" } },
    },
  ], "vi");

  const text = serializeEditorPreviewPlainText(blocks);

  assert.equal(text, "Before image\n\nA nice caption");
});

test("preview mode constant remains stable", () => {
  assert.equal(EDITOR_MODE_PREVIEW, "preview");
});

test("serializeEditorPreviewWordPress returns content plus matching footnote meta", () => {
  const blocks = buildEditorPreviewDocument([{
    rowId: "row-1",
    lifecycleState: "active",
    textStyle: "paragraph",
    fields: { vi: "Alpha body [1]" },
    footnotes: { vi: "Footnote <strong>bold</strong> text" },
    imageCaptions: { vi: "Caption" },
    images: {
      vi: {
        kind: "upload",
        path: "chapters/ch-1/images/row-1/image.png",
        filePath: "/tmp/image.png",
      },
    },
  }], "vi");

  const { content, footnotes, title } = serializeEditorPreviewWordPress(blocks);

  assert.equal(title, null);
  assert.doesNotMatch(content, /<meta charset/);
  assert.match(content, /^<!-- wp:paragraph -->/);
  assert.match(content, /<!-- wp:footnotes \/-->/);
  assert.doesNotMatch(
    content,
    /<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"\/>\n<!-- \/wp:separator -->\n\n<!-- wp:footnotes \/-->/,
  );
  assert.match(
    content,
    /<\/figure>\n<!-- \/wp:image -->\n\n<!-- wp:footnotes \/-->/,
  );
  assert.match(content, /src="chapters\/ch-1\/images\/row-1\/image\.png"/);

  assert.equal(footnotes.length, 1);
  assert.match(footnotes[0].id, /^[0-9a-f-]{36}$/);
  assert.equal(footnotes[0].content, "Footnote <strong>bold</strong> text");
  assert.ok(content.includes(`<sup data-fn="${footnotes[0].id}" class="fn">`));
});

test("serializeEditorPreviewWordPress omits footnote markup without footnotes", () => {
  const blocks = buildEditorPreviewDocument([{
    rowId: "row-1",
    lifecycleState: "active",
    textStyle: "paragraph",
    fields: { vi: "Plain paragraph" },
    footnotes: {},
    imageCaptions: {},
    images: {},
  }], "vi");

  const { content, footnotes } = serializeEditorPreviewWordPress(blocks);

  assert.deepEqual(footnotes, []);
  assert.doesNotMatch(content, /wp:footnotes/);
  assert.doesNotMatch(content, /wp:separator/);
  assert.match(content, /<!-- wp:paragraph -->/);
});

test("serializeEditorPreviewWordPress maps every text style to its block markup", () => {
  const styleRow = (rowId, textStyle, text) => ({
    rowId,
    lifecycleState: "active",
    textStyle,
    fields: { vi: text },
    footnotes: {},
    imageCaptions: {},
    images: {},
  });
  // The paragraph row leads so the H1 stays an in-body heading instead of
  // being promoted to the post title.
  const blocks = buildEditorPreviewDocument([
    styleRow("row-p", "paragraph", "Plain paragraph"),
    styleRow("row-h1", "heading1", "Large heading"),
    styleRow("row-h2", "heading2", "Subheading"),
    styleRow("row-q", "quote", "Quoted passage"),
    styleRow("row-i", "indented", "Indented passage"),
    styleRow("row-c", "centered", "Centered passage"),
  ], "vi");

  const { content, title } = serializeEditorPreviewWordPress(blocks);

  assert.equal(title, null);
  assert.ok(content.includes("<!-- wp:paragraph -->\n<p>Plain paragraph</p>\n<!-- /wp:paragraph -->"));
  assert.ok(content.includes('<!-- wp:heading {"level":1} -->\n<h1 class="wp-block-heading">Large heading</h1>\n<!-- /wp:heading -->'));
  assert.ok(content.includes('<!-- wp:heading -->\n<h2 class="wp-block-heading">Subheading</h2>\n<!-- /wp:heading -->'));
  assert.ok(content.includes(
    '<!-- wp:quote -->\n<blockquote class="wp-block-quote"><!-- wp:paragraph -->\n<p>Quoted passage</p>\n<!-- /wp:paragraph --></blockquote>\n<!-- /wp:quote -->',
  ));
  assert.ok(content.includes(
    '<!-- wp:paragraph {"style":{"spacing":{"padding":{"left":"2em"}}}} -->\n<p style="padding-left:2em">Indented passage</p>\n<!-- /wp:paragraph -->',
  ));
  assert.ok(content.includes(
    '<!-- wp:paragraph {"style":{"typography":{"textAlign":"center"}}} -->\n<p class="has-text-align-center">Centered passage</p>\n<!-- /wp:paragraph -->',
  ));
  // An in-body H1 means the table-of-contents suppression shortcode is omitted.
  assert.doesNotMatch(content, /no_toc/);
});

test("serializeEditorPreviewWordPress keeps inline links in body and footnotes", () => {
  const blocks = buildEditorPreviewDocument([{
    rowId: "row-1",
    lifecycleState: "active",
    textStyle: "paragraph",
    fields: { vi: 'Read <a href="https://example.com/page?a=1&amp;b=2">the page</a> [1]' },
    footnotes: { vi: 'See <a href="https://example.com/note">the note</a>' },
    imageCaptions: {},
    images: {},
  }], "vi");

  const { content, footnotes } = serializeEditorPreviewWordPress(blocks);

  assert.ok(content.includes('Read <a href="https://example.com/page?a=1&amp;b=2">the page</a>'));
  assert.equal(footnotes.length, 1);
  assert.equal(footnotes[0].content, 'See <a href="https://example.com/note">the note</a>');
});

function wordPressTitleFixtureRows() {
  return [
    {
      rowId: "row-1",
      lifecycleState: "active",
      textStyle: "heading1",
      fields: { vi: "<strong>Chương 3</strong> – Trận chiến" },
      footnotes: {},
      imageCaptions: {},
      images: {},
    },
    {
      rowId: "row-2",
      lifecycleState: "active",
      textStyle: "paragraph",
      fields: { vi: "Body text" },
      footnotes: {},
      imageCaptions: {},
      images: {},
    },
  ];
}

test("serializeEditorPreviewWordPress promotes a leading H1 to the post title", () => {
  const blocks = buildEditorPreviewDocument(wordPressTitleFixtureRows(), "vi");

  const { content, title } = serializeEditorPreviewWordPress(blocks);

  assert.equal(title, "Chương 3 – Trận chiến");
  assert.equal(extractWordPressLeadingHeadingTitle(blocks), "Chương 3 – Trận chiến");
  assert.doesNotMatch(content, /wp:heading/);
  assert.doesNotMatch(content, /Chương 3/);
  assert.match(content, /Body text/);
  // No H1 headings remain inside the article: the auto TOC is suppressed.
  assert.match(content, /<!-- wp:shortcode -->\n\[no_toc\]\n<!-- \/wp:shortcode -->$/);
});

test("serializeEditorPreviewWordPress keeps the TOC when internal H1 headings remain", () => {
  const rows = [
    ...wordPressTitleFixtureRows(),
    {
      rowId: "row-3",
      lifecycleState: "active",
      textStyle: "heading1",
      fields: { vi: "Second chapter heading" },
      footnotes: {},
      imageCaptions: {},
      images: {},
    },
  ];
  const blocks = buildEditorPreviewDocument(rows, "vi");

  const { content, title } = serializeEditorPreviewWordPress(blocks);

  assert.equal(title, "Chương 3 – Trận chiến");
  assert.match(content, /<!-- wp:heading \{"level":1\} -->/);
  assert.doesNotMatch(content, /no_toc/);
});

test("serializeEditorPreviewWordPress does not promote H1s that are not first or carry footnotes", () => {
  const h1WithFootnote = buildEditorPreviewDocument([{
    rowId: "row-1",
    lifecycleState: "active",
    textStyle: "heading1",
    fields: { vi: "Heading [1]" },
    footnotes: { vi: "A note" },
    imageCaptions: {},
    images: {},
  }], "vi");
  const withFootnoteResult = serializeEditorPreviewWordPress(h1WithFootnote);
  assert.equal(withFootnoteResult.title, null);
  assert.match(withFootnoteResult.content, /<!-- wp:heading \{"level":1\} -->/);
  assert.doesNotMatch(withFootnoteResult.content, /no_toc/);

  const imageFirst = buildEditorPreviewDocument([
    {
      rowId: "row-1",
      lifecycleState: "active",
      textStyle: "paragraph",
      fields: { vi: "" },
      footnotes: {},
      imageCaptions: { vi: "Cover" },
      images: { vi: { kind: "url", url: "https://example.com/cover.png" } },
    },
    {
      rowId: "row-2",
      lifecycleState: "active",
      textStyle: "heading1",
      fields: { vi: "Not a title" },
      footnotes: {},
      imageCaptions: {},
      images: {},
    },
  ], "vi");
  const imageFirstResult = serializeEditorPreviewWordPress(imageFirst);
  assert.equal(imageFirstResult.title, null);
  assert.match(imageFirstResult.content, /Not a title/);
});
