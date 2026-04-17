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

test("buildEditorRowSearchHighlights keeps main text and footnote matches separate", () => {
  const highlights = buildEditorRowSearchHighlights(
    [
      { code: "es", text: "distintos caminos", contentKind: "field" },
      { code: "es", text: "distintos nota", contentKind: "footnote" },
    ],
    "distintos",
    new Set(["es"]),
  );

  assert.equal(highlights.size, 2);
  assert.match(highlights.get("es:field")?.html ?? "", /translation-language-panel__search-match/);
  assert.match(highlights.get("es:footnote")?.html ?? "", /translation-language-panel__search-match/);
});
