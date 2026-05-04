import test from "node:test";
import assert from "node:assert/strict";

import {
  buildInlineMarkupSearchHighlightMarkup,
  describeInlineMarkupSelection,
  extractInlineMarkupHistoryText,
  extractInlineMarkupVisibleText,
  renderSanitizedInlineMarkupHtml,
  renderSanitizedInlineMarkupHistoryHtml,
  renderSanitizedInlineMarkupWithEditorHighlightState,
  renderSanitizedInlineMarkupWithGlossaryHighlightHtml,
  rubyButtonConfig,
  toggleInlineMarkupSelection,
} from "./editor-inline-markup.js";

test("ruby button config localizes labels, tooltips, and placeholders", () => {
  assert.deepEqual(rubyButtonConfig("ja"), {
    label: "振",
    tooltip: "ルビを挿入",
    placeholder: "よみ",
  });
  assert.deepEqual(rubyButtonConfig("zh-CN"), {
    label: "注",
    tooltip: "添加读音标注",
    placeholder: "读音",
  });
  assert.deepEqual(rubyButtonConfig("zh-Hans"), {
    label: "注",
    tooltip: "添加读音标注",
    placeholder: "读音",
  });
  assert.deepEqual(rubyButtonConfig("ko"), {
    label: "주",
    tooltip: "발음 표기 추가",
    placeholder: "발음",
  });
  assert.deepEqual(rubyButtonConfig("es"), {
    label: "r",
    tooltip: "Ruby",
    placeholder: "ruby text here",
  });
});

test("sanitized inline markup normalizes aliases and escapes unsupported tags", () => {
  assert.equal(
    renderSanitizedInlineMarkupHtml("<b>Bold</b> and <i>italic</i>"),
    "<strong>Bold</strong> and <em>italic</em>",
  );
  assert.equal(
    renderSanitizedInlineMarkupHtml("<script>alert(1)</script>"),
    "&lt;script&gt;alert(1)&lt;/script&gt;",
  );
});

test("extractInlineMarkupVisibleText omits supported tag syntax and keeps ruby text visible", () => {
  assert.equal(
    extractInlineMarkupVisibleText("<strong>Alpha</strong> <ruby>漢字<rt>よみ</rt></ruby>"),
    "Alpha 漢字よみ",
  );
});

test("history text extraction formats ruby annotations inside angle brackets", () => {
  assert.equal(
    extractInlineMarkupHistoryText("<strong>Alpha</strong> <ruby>漢字<rt>よみ</rt></ruby>"),
    "Alpha 漢字 ❬よみ❭",
  );
});

test("history html rendering shows ruby annotations inside angle brackets", () => {
  assert.equal(
    renderSanitizedInlineMarkupHistoryHtml("<strong>Alpha</strong> <ruby>漢字<rt>よみ</rt></ruby>"),
    '<strong>Alpha</strong> 漢字<span class="history-inline-ruby-annotation"> ❬よみ❭</span>',
  );
});

test("glossary highlights merge into sanitized inline markup without discarding inline tags", () => {
  const html = renderSanitizedInlineMarkupWithGlossaryHighlightHtml(
    "<strong>Alpha</strong> <ruby>漢字<rt>よみ</rt></ruby>",
    '<mark class="glossary-match translation-language-panel__glossary-mark" data-editor-glossary-mark data-text-start="0" data-text-end="5" data-editor-glossary-tooltip="term">Alpha</mark>'
      + ' <mark class="glossary-match translation-language-panel__glossary-mark" data-editor-glossary-mark data-text-start="6" data-text-end="8">漢字</mark>',
  );

  assert.equal(
    html,
    '<strong><mark class="glossary-match translation-language-panel__glossary-mark" data-editor-glossary-mark data-text-start="0" data-text-end="5" data-editor-glossary-tooltip="term">Alpha</mark></strong> <ruby><mark class="glossary-match translation-language-panel__glossary-mark" data-editor-glossary-mark data-text-start="6" data-text-end="8">漢字</mark><rt>よみ</rt></ruby>',
  );
});

test("search and glossary highlights merge into one visible markup layer", () => {
  const html = renderSanitizedInlineMarkupWithEditorHighlightState(
    "<strong>mind</strong> path",
    {
      glossaryHighlightHtml:
        '<mark class="glossary-match translation-language-panel__glossary-mark" data-editor-glossary-mark data-text-start="0" data-text-end="4" data-editor-glossary-tooltip="term">mind</mark>',
      searchRanges: [{ start: 0, end: 9 }],
    },
  );

  assert.equal(
    html,
    '<strong><mark class="glossary-match translation-language-panel__glossary-mark" data-editor-glossary-mark data-text-start="0" data-text-end="4" data-editor-glossary-tooltip="term"><mark class="translation-language-panel__search-match">mind</mark></mark></strong><mark class="translation-language-panel__search-match"> path</mark>',
  );
});

test("collapsed bold inside a word wraps the whole word", () => {
  const result = toggleInlineMarkupSelection({
    value: "Alpha",
    selectionStart: 2,
    selectionEnd: 2,
    style: "bold",
  });

  assert.equal(result.value, "<strong>Alpha</strong>");
  assert.equal(result.selectionStart, "<strong>".length);
  assert.equal(result.selectionEnd, "<strong>Alpha".length);
});

test("collapsed italic inside a word wraps the whole word", () => {
  const result = toggleInlineMarkupSelection({
    value: "Alpha beta",
    selectionStart: "Alpha beta".indexOf("beta") + 1,
    selectionEnd: "Alpha beta".indexOf("beta") + 1,
    style: "italic",
  });

  assert.equal(result.value, "Alpha <em>beta</em>");
  assert.equal(result.selectionStart, "Alpha <em>".length);
  assert.equal(result.selectionEnd, "Alpha <em>beta".length);
});

test("collapsed underline inside a word wraps the whole word", () => {
  const result = toggleInlineMarkupSelection({
    value: "Alpha",
    selectionStart: 2,
    selectionEnd: 2,
    style: "underline",
  });

  assert.equal(result.value, "<u>Alpha</u>");
  assert.equal(result.selectionStart, "<u>".length);
  assert.equal(result.selectionEnd, "<u>Alpha".length);
});

test("collapsed bold outside a word inserts an empty tag pair", () => {
  const result = toggleInlineMarkupSelection({
    value: "Alpha beta",
    selectionStart: 5,
    selectionEnd: 5,
    style: "bold",
  });

  assert.equal(result.value, "Alpha<strong></strong> beta");
  assert.equal(result.selectionStart, "Alpha<strong>".length);
  assert.equal(result.selectionEnd, "Alpha<strong>".length);
});

test("collapsed ruby inside a word wraps the whole word and selects the localized placeholder", () => {
  const result = toggleInlineMarkupSelection({
    value: "漢字",
    selectionStart: 0,
    selectionEnd: 0,
    style: "ruby",
    languageCode: "ja",
  });

  assert.equal(result.value, "<ruby>漢字<rt>よみ</rt></ruby>");
  assert.equal(result.selectionStart, "<ruby>漢字<rt>".length);
  assert.equal(result.selectionEnd, "<ruby>漢字<rt>よみ".length);
});

test("collapsed ruby outside a word inserts ruby tags and selects the placeholder", () => {
  const result = toggleInlineMarkupSelection({
    value: "漢字 です",
    selectionStart: 2,
    selectionEnd: 2,
    style: "ruby",
    languageCode: "ja",
  });

  assert.equal(result.value, "漢字<ruby><rt>よみ</rt></ruby> です");
  assert.equal(result.selectionStart, "漢字<ruby><rt>".length);
  assert.equal(result.selectionEnd, "漢字<ruby><rt>よみ".length);
});

test("selected ruby insertion wraps the selected text and selects the placeholder", () => {
  const result = toggleInlineMarkupSelection({
    value: "漢字です",
    selectionStart: 0,
    selectionEnd: 2,
    style: "ruby",
    languageCode: "ja",
  });

  assert.equal(result.value, "<ruby>漢字<rt>よみ</rt></ruby>です");
  assert.equal(result.selectionStart, "<ruby>漢字<rt>".length);
  assert.equal(result.selectionEnd, "<ruby>漢字<rt>よみ".length);
});

test("collapsed ruby toggle removes both ruby and rt markup", () => {
  const value = "<ruby>漢字<rt>よみ</rt></ruby>";
  const result = toggleInlineMarkupSelection({
    value,
    selectionStart: value.indexOf("字"),
    selectionEnd: value.indexOf("字"),
    style: "ruby",
    languageCode: "ja",
  });

  assert.equal(result.value, "漢字");
  assert.equal(result.selectionStart, 0);
  assert.equal(result.selectionEnd, 2);
});

test("collapsed ruby toggle removes annotation text when the cursor is inside rt content", () => {
  const value = "<ruby>漢字<rt>よみ</rt></ruby>";
  const result = toggleInlineMarkupSelection({
    value,
    selectionStart: value.indexOf("み"),
    selectionEnd: value.indexOf("み"),
    style: "ruby",
    languageCode: "ja",
  });

  assert.equal(result.value, "漢字");
  assert.equal(result.selectionStart, 0);
  assert.equal(result.selectionEnd, 2);
});

test("collapsed ruby toggle removes annotation text when the cursor is inside ruby tag text", () => {
  const value = "<ruby>漢字<rt>よみ</rt></ruby>";
  const result = toggleInlineMarkupSelection({
    value,
    selectionStart: value.indexOf("<rt>") + 1,
    selectionEnd: value.indexOf("<rt>") + 1,
    style: "ruby",
    languageCode: "ja",
  });

  assert.equal(result.value, "漢字");
  assert.equal(result.selectionStart, 0);
  assert.equal(result.selectionEnd, 2);
});

test("selected ruby toggle removes the annotation text with the ruby wrapper", () => {
  const value = "<ruby><strong>漢字</strong><rt>よみ</rt></ruby>です";
  const result = toggleInlineMarkupSelection({
    value,
    selectionStart: value.indexOf("漢"),
    selectionEnd: value.indexOf("字") + 1,
    style: "ruby",
    languageCode: "ja",
  });

  assert.equal(result.value, "<strong>漢字</strong>です");
});

test("describing selection lights a style when the cursor is inside content or tag text", () => {
  const insideContent = describeInlineMarkupSelection("<strong>Alpha</strong>", 10, 10);
  const insideTag = describeInlineMarkupSelection("<strong>Alpha</strong>", 2, 2);

  assert.equal(insideContent.activeStyles.bold, true);
  assert.equal(insideTag.activeStyles.bold, true);
});

test("removing bold from a selected substring keeps the surrounding text bold", () => {
  const value = "<strong>abc</strong>";
  const result = toggleInlineMarkupSelection({
    value,
    selectionStart: value.indexOf("b"),
    selectionEnd: value.indexOf("b") + 1,
    style: "bold",
  });

  assert.equal(result.value, "<strong>a</strong>b<strong>c</strong>");
});

test("raw search highlight markup matches visible text instead of tag syntax", () => {
  const highlight = buildInlineMarkupSearchHighlightMarkup("<strong>Alpha</strong> beta", "Alpha");

  assert.equal(highlight.hasMatches, true);
  assert.deepEqual(highlight.ranges, [{ start: 0, end: 5, text: "Alpha" }]);
  assert.match(
    highlight.html,
    /&lt;strong&gt;<mark class="translation-language-panel__search-match">Alpha<\/mark>&lt;\/strong&gt; beta/,
  );
});

test("bold treats ruby as an atomic inline unit", () => {
  const value = "<ruby>漢字<rt>よみ</rt></ruby>です";
  const result = toggleInlineMarkupSelection({
    value,
    selectionStart: value.indexOf("漢"),
    selectionEnd: value.indexOf("字") + 1,
    style: "bold",
  });

  assert.equal(result.value, "<strong><ruby>漢字<rt>よみ</rt></ruby></strong>です");
});
