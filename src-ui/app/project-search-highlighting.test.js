import test from "node:test";
import assert from "node:assert/strict";

import { buildProjectSearchSnippetMarkup } from "./project-search-highlighting.js";

test("buildProjectSearchSnippetMarkup highlights exact substring matches in the visible snippet", () => {
  const markup = buildProjectSearchSnippetMarkup("Distintos caminos", "distintos", "es");

  assert.match(markup, /<mark class="translation-language-panel__search-match">Distintos<\/mark> caminos/);
});

test("buildProjectSearchSnippetMarkup leaves fuzzy-only results unhighlighted", () => {
  const markup = buildProjectSearchSnippetMarkup("I like to see dogs", "eat", "en");

  assert.equal(markup, "I like to see dogs");
});

test("buildProjectSearchSnippetMarkup escapes snippet html when there is no exact match", () => {
  const markup = buildProjectSearchSnippetMarkup("<b>see</b>", "eat", "en");

  assert.equal(markup, "&lt;b&gt;see&lt;/b&gt;");
});
