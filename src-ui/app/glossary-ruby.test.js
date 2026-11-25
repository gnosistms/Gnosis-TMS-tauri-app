import test from "node:test";
import assert from "node:assert/strict";

import {
  extractGlossaryRubyBaseText,
  extractGlossaryRubyVisibleText,
  glossaryRubyHasAnnotation,
  glossaryNoteVisibleText,
  renderGlossaryNoteHtml,
  renderGlossaryRubyHtml,
  renderGlossaryRubyTermListHtml,
  sanitizeGlossaryRubyMarkup,
  serializeGlossaryRubyForAiPrompt,
  targetTextContainsGlossaryVariantExactRuby,
} from "./glossary-ruby.js";

test("glossary ruby sanitizer preserves ruby markup and escapes unsupported tags", () => {
  assert.equal(
    sanitizeGlossaryRubyMarkup("<ruby>漢字<rt>かんじ</rt></ruby> <strong>bold</strong>"),
    "<ruby>漢字<rt>かんじ</rt></ruby> &lt;strong&gt;bold&lt;/strong&gt;",
  );
});

test("glossary ruby sanitizer is idempotent for already-sanitized values", () => {
  const sanitized = "&lt;strong&gt;bold&lt;/strong&gt; <ruby>漢字<rt>かんじ</rt></ruby>";
  assert.equal(sanitizeGlossaryRubyMarkup(sanitized), sanitized);
});

test("linked variants round-trip without adding the URL to matching or the AI term", () => {
  const link = '<a href="https://example.org/?q=&quot;one&quot;&amp;x=2"><ruby>漢字<rt>かんじ</rt></ruby></a>';
  assert.equal(sanitizeGlossaryRubyMarkup(sanitizeGlossaryRubyMarkup(link)), link);
  assert.equal(extractGlossaryRubyBaseText(link), "漢字");
  assert.equal(extractGlossaryRubyVisibleText(link), "漢字かんじ");
  assert.equal(serializeGlossaryRubyForAiPrompt(link), "漢字[ruby: かんじ]");
  assert.equal(targetTextContainsGlossaryVariantExactRuby("<ruby>漢字<rt>かんじ</rt></ruby>", link, "ja"), true);
  assert.equal(targetTextContainsGlossaryVariantExactRuby(link, "example", "en"), false);
});

test("notes display safe links and keep other literal markup as text", () => {
  const note = 'Read <a href="https://example.org/ref">this entry</a> about <u> and &.';
  assert.equal(renderGlossaryNoteHtml(note), 'Read <a href="https://example.org/ref">this entry</a> about &lt;u&gt; and &amp;.');
  assert.equal(glossaryNoteVisibleText(note), "Read this entry about <u> and &.");
  assert.doesNotMatch(renderGlossaryNoteHtml('<a href="javascript:void(0)">wrong</a>'), /<a\b/);
});

test("glossary ruby text extraction uses base text for matching and visible text for display", () => {
  const value = "<ruby>漢字<rt>かんじ</rt></ruby> &lt;strong&gt;bold&lt;/strong&gt;";

  assert.equal(extractGlossaryRubyBaseText(value), "漢字 <strong>bold</strong>");
  assert.equal(extractGlossaryRubyVisibleText(value), "漢字かんじ <strong>bold</strong>");
});

test("glossary ruby rendering and ai serialization keep ruby deterministic", () => {
  const value = "<ruby>精神<rt>せいしん</rt></ruby>, path";

  assert.equal(renderGlossaryRubyHtml(value), value);
  assert.equal(
    renderGlossaryRubyTermListHtml([value, "mind"]),
    "<ruby>精神<rt>せいしん</rt></ruby>, path, mind",
  );
  assert.equal(serializeGlossaryRubyForAiPrompt(value), "精神[ruby: せいしん], path");
  assert.equal(glossaryRubyHasAnnotation(value), true);
  assert.equal(glossaryRubyHasAnnotation("mind"), false);
});

test("exact glossary ruby target matching requires the same ruby annotation", () => {
  const variant = "<ruby>精神<rt>せいしん</rt></ruby>";

  assert.equal(
    targetTextContainsGlossaryVariantExactRuby(
      "A <ruby>精神<rt>せいしん</rt></ruby> path",
      variant,
      "ja",
    ),
    true,
  );
  assert.equal(
    targetTextContainsGlossaryVariantExactRuby(
      "A <strong><ruby>精神<rt>せいしん</rt></ruby></strong> path",
      variant,
      "ja",
    ),
    true,
  );
  assert.equal(
    targetTextContainsGlossaryVariantExactRuby("A 精神 path", variant, "ja"),
    false,
  );
  assert.equal(
    targetTextContainsGlossaryVariantExactRuby(
      "A <ruby>精神<rt>せいじん</rt></ruby> path",
      variant,
      "ja",
    ),
    false,
  );
});
