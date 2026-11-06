import test from "node:test";
import assert from "node:assert/strict";

import { buildHistoryDiffSegments, renderHistoryContent, renderHistoryEntryContent } from "./translate-history-shared.js";

function joinByTypes(segments, types) {
  return segments
    .filter((segment) => types.includes(segment.type))
    .map((segment) => segment.text)
    .join("");
}

test("diff preserves astral characters instead of splitting surrogate pairs", () => {
  const segments = buildHistoryDiffSegments("Party 🎉 time", "Party 🎊 time");

  // Every segment must be well-formed UTF-16 — no lone surrogates that would
  // render as U+FFFD.
  for (const segment of segments) {
    assert.ok(segment.text.isWellFormed(), `segment "${segment.text}" has a lone surrogate`);
  }
  // The emoji is replaced atomically, not corrupted into shared-surrogate noise.
  assert.equal(joinByTypes(segments, ["equal", "delete"]), "Party 🎉 time");
  assert.equal(joinByTypes(segments, ["equal", "insert"]), "Party 🎊 time");
  assert.ok(
    segments.some((s) => s.type === "delete" && s.text === "🎉"),
    "the old emoji is a clean delete",
  );
  assert.ok(
    segments.some((s) => s.type === "insert" && s.text === "🎊"),
    "the new emoji is a clean insert",
  );
});

test("diff round-trips plain ASCII edits", () => {
  const segments = buildHistoryDiffSegments("the cat sat", "the dog sat");

  assert.equal(joinByTypes(segments, ["equal", "delete"]), "the cat sat");
  assert.equal(joinByTypes(segments, ["equal", "insert"]), "the dog sat");
});

test("diff handles flag sequences (paired regional indicators) without corruption", () => {
  const segments = buildHistoryDiffSegments("go 🇯🇵 now", "go 🇰🇷 now");

  for (const segment of segments) {
    assert.ok(segment.text.isWellFormed(), `segment "${segment.text}" has a lone surrogate`);
  }
  assert.equal(joinByTypes(segments, ["equal", "delete"]), "go 🇯🇵 now");
  assert.equal(joinByTypes(segments, ["equal", "insert"]), "go 🇰🇷 now");
});

const paragraphTexts = (html) =>
  [...html.matchAll(/<span class="translation-language-panel__paragraph">(.*?)<\/span>(?=<span class="translation-language-panel__paragraph">|$)/gs)]
    .map((match) => match[1]);

test("row text shows its blank-line paragraphs, keeping line breaks inside them", () => {
  const text = "One\nline two\n\n<em>Two</em>";
  assert.deepEqual(
    paragraphTexts(renderHistoryContent({ plainText: text }, null, { paragraphs: true })),
    ["One\nline two", "<em>Two</em>"],
  );
  assert.deepEqual(
    paragraphTexts(renderHistoryContent({ plainText: `${text} more` }, { plainText: text }, { paragraphs: true })),
    ["One\nline two", 'Two<span class="history-diff__insert"> more</span>'],
  );
  assert.equal(renderHistoryContent({ plainText: text }, null), "One\nline two\n\n<em>Two</em>");
});

test("a removed paragraph break shows as a struck pilcrow, not a break", () => {
  const html = renderHistoryContent({ plainText: "One Two\n\nThree" }, { plainText: "One\n\nTwo\n\nThree" }, { paragraphs: true });
  assert.deepEqual(paragraphTexts(html), [
    'One<span class="history-diff__delete">¶</span><span class="history-diff__insert"> </span>Two',
    "Three",
  ]);
});

test("only the main row text takes paragraphs in a history entry", () => {
  const html = renderHistoryEntryContent(
    { plainText: "A\n\nB", footnote: "Note one\n\nNote two" },
    null,
    "vi",
    { paragraphs: true },
  );
  assert.equal(html.match(/translation-language-panel__paragraph/g)?.length, 2);
  assert.match(html, /Note one\n\nNote two/);
});

const completeRevision = {
  plainText: "Body text",
  footnote: "Footnote text",
  imageCaption: "Caption text",
  attribution: "Attribution text",
  image: { kind: "url", url: "https://example.test/image.png" },
  textStyle: "paragraph",
};

test("status-only revisions replace every repeated content block with Text unchanged", () => {
  const previous = { ...completeRevision, reviewed: false, pleaseCheck: true };
  const current = { ...completeRevision, reviewed: true, pleaseCheck: false };
  assert.equal(renderHistoryEntryContent(current, previous, "vi"), '<p class="history-item__unchanged">Text unchanged.</p>');
});

for (const field of ["plainText", "footnote", "imageCaption", "attribution"]) {
  test(`a ${field} change keeps history content visible`, () => {
    const current = { ...completeRevision, [field]: `${completeRevision[field]} changed` };
    const html = renderHistoryEntryContent(current, completeRevision, "vi");
    assert.doesNotMatch(html, /Text unchanged\./);
    assert.match(html, /changed/);
  });
}

test("media and formatting changes are not mistaken for status-only revisions", () => {
  for (const change of [
    { image: { kind: "url", url: "https://example.test/other.png" } },
    { textStyle: "heading1" },
    { plainText: "<strong>Body text</strong>" },
  ]) {
    assert.doesNotMatch(renderHistoryEntryContent({ ...completeRevision, ...change }, completeRevision, "vi"), /Text unchanged\./);
  }
});

test("a first revision has no comparison baseline and keeps its content", () => {
  const html = renderHistoryEntryContent(completeRevision, null, "vi");
  assert.doesNotMatch(html, /Text unchanged\./);
  assert.match(html, /Body text/);
  assert.match(html, /Footnote text/);
  assert.match(html, /Caption text/);
  assert.match(html, /Attribution text/);
});
