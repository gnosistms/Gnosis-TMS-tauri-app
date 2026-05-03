import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEditorRowSearchHighlights,
  buildEditorSearchHighlightMarkup,
} from "./editor-search-highlighting.js";

test("buildEditorSearchHighlightMarkup wraps matching segments", () => {
  const highlight = buildEditorSearchHighlightMarkup("distintos distintos", [
    { start: 0, end: 9 },
    { start: 10, end: 19 },
  ]);

  assert.equal(highlight.kind, "search");
  assert.equal(highlight.hasMatches, true);
  assert.match(
    highlight.html,
    /^<mark class="translation-language-panel__search-match">distintos<\/mark> <mark class="translation-language-panel__search-match">distintos<\/mark>$/,
  );
});

test("buildEditorRowSearchHighlights only includes visible languages with matches", () => {
  const highlights = buildEditorRowSearchHighlights(
    [
      { code: "es", text: "distintos caminos" },
      { code: "en", text: "different paths" },
      { code: "vi", text: "nhung loi khac nhau" },
    ],
    "distintos",
    new Set(["es", "en"]),
  );

  assert.equal(highlights.size, 1);
  assert.match(highlights.get("es:field")?.html ?? "", /translation-language-panel__search-match/);
  assert.equal(highlights.has("en"), false);
  assert.equal(highlights.has("vi"), false);
});

test("buildEditorRowSearchHighlights respects case-sensitive search", () => {
  const highlights = buildEditorRowSearchHighlights(
    [
      { code: "es", text: "Distintos caminos" },
      { code: "en", text: "Different paths" },
    ],
    "distintos",
    new Set(["es", "en"]),
    { caseSensitive: true },
  );

  assert.equal(highlights.size, 0);
});

test("buildEditorRowSearchHighlights keeps main text, footnote, and image caption matches separate", () => {
  const highlights = buildEditorRowSearchHighlights(
    [
      { code: "es", text: "distintos caminos", contentKind: "field" },
      { code: "es", text: "distintos nota", contentKind: "footnote" },
      { code: "es", text: "distintos imagen", contentKind: "image-caption" },
    ],
    "distintos",
    new Set(["es"]),
  );

  assert.equal(highlights.size, 3);
  assert.match(highlights.get("es:field")?.html ?? "", /translation-language-panel__search-match/);
  assert.match(highlights.get("es:footnote")?.html ?? "", /translation-language-panel__search-match/);
  assert.match(highlights.get("es:image-caption")?.html ?? "", /translation-language-panel__search-match/);
});

test("buildEditorRowSearchHighlights matches visible text inside inline markup", () => {
  const highlights = buildEditorRowSearchHighlights(
    [
      { code: "ja", text: "<strong>漢字</strong><ruby>注<rt>よみ</rt></ruby>" },
    ],
    "よみ",
    new Set(["ja"]),
  );

  assert.equal(highlights.size, 1);
  assert.match(highlights.get("ja:field")?.html ?? "", /translation-language-panel__search-match/);
  assert.match(highlights.get("ja:field")?.html ?? "", /&lt;rt&gt;<mark class="translation-language-panel__search-match">よみ<\/mark>&lt;\/rt&gt;/);
});
