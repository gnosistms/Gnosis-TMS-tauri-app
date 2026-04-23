import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEditorAiTranslationGlossaryHints,
  buildEditorDerivedGlossaryModel,
  buildEditorGlossaryModel,
  buildEditorRowGlossaryHighlights,
  buildEditorRowSourceGlossaryHighlights,
  findLongestGlossaryMatches,
} from "./editor-glossary-highlighting.js";

function glossaryPayload(overrides = {}) {
  return {
    glossaryId: "glossary-1",
    repoName: "glossary-1",
    title: "Glossary",
    sourceLanguage: {
      code: "es",
      name: "Spanish",
    },
    targetLanguage: {
      code: "vi",
      name: "Vietnamese",
    },
    terms: [],
    ...overrides,
  };
}

test("glossary matching prefers the longest source term", () => {
  const model = buildEditorGlossaryModel(glossaryPayload({
    terms: [
      {
        termId: "t1",
        sourceTerms: ["sala"],
        targetTerms: ["phong"],
      },
      {
        termId: "t2",
        sourceTerms: ["sala de meditacion"],
        targetTerms: ["phong thien"],
      },
    ],
  }));

  const result = findLongestGlossaryMatches("La sala de meditacion esta lista.", model.sourceMatcher);

  assert.equal(result.matches.length, 1);
  assert.deepEqual(Array.from(result.matches[0].candidate.sourceTerms), ["sala de meditacion"]);
});

test("glossary matching uses ruby base text instead of raw markup", () => {
  const model = buildEditorGlossaryModel(glossaryPayload({
    terms: [
      {
        termId: "t1",
        sourceTerms: ["<ruby>sala<rt>sa</rt></ruby> de meditacion"],
        targetTerms: ["phong thien"],
      },
    ],
  }));

  const result = findLongestGlossaryMatches(
    "La sala de meditacion esta lista.",
    model.sourceMatcher,
  );

  assert.equal(result.matches.length, 1);
  assert.deepEqual(
    Array.from(result.matches[0].candidate.sourceTerms),
    ["<ruby>sala<rt>sa</rt></ruby> de meditacion"],
  );
});

test("source highlights are marked as errors when the expected target term is missing", () => {
  const model = buildEditorGlossaryModel(glossaryPayload({
    terms: [
      {
        termId: "t1",
        sourceTerms: ["meditacion"],
        targetTerms: ["thien dinh"],
      },
    ],
  }));

  const highlights = buildEditorRowGlossaryHighlights([
    {
      code: "es",
      text: "Practica de meditacion",
    },
    {
      code: "vi",
      text: "Thuc hanh",
    },
  ], model);

  assert.match(highlights.get("es")?.html ?? "", /glossary-match-error/);
  assert.equal(highlights.has("vi"), false);
});

test("source highlights are not marked as errors when the glossary allows omitting the target term", () => {
  const model = buildEditorGlossaryModel(glossaryPayload({
    terms: [
      {
        termId: "t1",
        sourceTerms: ["meditacion"],
        targetTerms: [""],
      },
    ],
  }));

  const highlights = buildEditorRowGlossaryHighlights([
    {
      code: "es",
      text: "Practica de meditacion",
    },
    {
      code: "vi",
      text: "Thuc hanh",
    },
  ], model);

  assert.doesNotMatch(highlights.get("es")?.html ?? "", /glossary-match-error/);
  assert.equal(highlights.has("vi"), false);
});

test("target highlights only appear for glossary terms present in the same row source text", () => {
  const model = buildEditorGlossaryModel(glossaryPayload({
    terms: [
      {
        termId: "t1",
        sourceTerms: ["interiorizacion"],
        targetTerms: ["huong noi"],
      },
      {
        termId: "t2",
        sourceTerms: ["meditacion"],
        targetTerms: ["thien dinh"],
      },
    ],
  }));

  const highlights = buildEditorRowGlossaryHighlights([
    {
      code: "es",
      text: "Solo interiorizacion",
    },
    {
      code: "vi",
      text: "huong noi va thien dinh",
    },
  ], model);

  const targetHtml = highlights.get("vi")?.html ?? "";
  assert.match(targetHtml, /huong noi/);
  assert.equal((targetHtml.match(/data-editor-glossary-mark/g) ?? []).length, 1);
  assert.doesNotMatch(targetHtml, /<mark[^>]*>thien dinh<\/mark>/);
});

test("ruby target variants require exact ruby before the source highlight is satisfied", () => {
  const model = buildEditorGlossaryModel(glossaryPayload({
    sourceLanguage: {
      code: "es",
      name: "Spanish",
    },
    targetLanguage: {
      code: "en",
      name: "English",
    },
    terms: [
      {
        termId: "t1",
        sourceTerms: ["espiritu"],
        targetTerms: ["<ruby>mind<rt>maɪnd</rt></ruby>"],
      },
    ],
  }));

  const highlights = buildEditorRowGlossaryHighlights([
    {
      code: "es",
      text: "El espiritu canta.",
    },
    {
      code: "en",
      text: "mind sings.",
    },
  ], model);

  assert.match(highlights.get("es")?.html ?? "", /glossary-match-error/);
  assert.equal(highlights.has("en"), false);
});

test("ruby target highlights use the exact ruby variant and tooltip payload when the target follows the glossary", () => {
  const model = buildEditorGlossaryModel(glossaryPayload({
    sourceLanguage: {
      code: "es",
      name: "Spanish",
    },
    targetLanguage: {
      code: "en",
      name: "English",
    },
    terms: [
      {
        termId: "t1",
        sourceTerms: ["espiritu"],
        targetTerms: ["<ruby>mind<rt>maɪnd</rt></ruby>"],
      },
    ],
  }));

  const highlights = buildEditorRowGlossaryHighlights([
    {
      code: "es",
      text: "El espiritu canta.",
    },
    {
      code: "en",
      text: "<ruby>mind<rt>maɪnd</rt></ruby> sings.",
    },
  ], model);

  const sourceHtml = highlights.get("es")?.html ?? "";
  const targetHtml = highlights.get("en")?.html ?? "";
  assert.doesNotMatch(sourceHtml, /glossary-match-error/);
  assert.match(targetHtml, /data-editor-glossary-mark/);

  const payloadMatch = targetHtml.match(/data-editor-glossary-tooltip-payload="([^"]+)"/);
  assert.ok(payloadMatch);

  const payloadJson = payloadMatch[1]
    .replaceAll("&quot;", "\"")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
  const payload = JSON.parse(payloadJson);

  assert.equal(payload.kind, "target");
  assert.equal(payload.title, "<ruby>mind<rt>maɪnd</rt></ruby>");
  assert.deepEqual(payload.variants, ["espiritu"]);
});

test("source highlights include a structured tooltip payload for source-language hover cards", () => {
  const model = buildEditorGlossaryModel(glossaryPayload({
    terms: [
      {
        termId: "t1",
        sourceTerms: ["gnostica", "gnostico"],
        targetTerms: ["hoc tro gnosis", "cua gnosis"],
        notesToTranslators: "Lien quan den Gnosis",
        footnote: "Chu thich bo sung",
      },
    ],
  }));

  const highlights = buildEditorRowGlossaryHighlights([
    {
      code: "es",
      text: "La gnostica habla.",
    },
  ], model);

  const sourceHtml = highlights.get("es")?.html ?? "";
  const payloadMatch = sourceHtml.match(/data-editor-glossary-tooltip-payload="([^"]+)"/);
  assert.ok(payloadMatch);

  const payloadJson = payloadMatch[1]
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
  const payload = JSON.parse(payloadJson);

  assert.equal(payload.kind, "source");
  assert.equal(payload.title, "gnostica");
  assert.deepEqual(payload.variants, ["hoc tro gnosis", "cua gnosis"]);
  assert.deepEqual(payload.translatorNotes, ["Lien quan den Gnosis"]);
  assert.deepEqual(payload.footnotes, ["Chu thich bo sung"]);
});

test("target highlights include a structured tooltip payload with source variants", () => {
  const model = buildEditorGlossaryModel(glossaryPayload({
    terms: [
      {
        termId: "t1",
        sourceTerms: ["gnostica", "gnostico"],
        targetTerms: ["hoc tro gnosis", "cua gnosis"],
        notesToTranslators: "Lien quan den Gnosis",
        footnote: "Chu thich bo sung",
      },
    ],
  }));

  const highlights = buildEditorRowGlossaryHighlights([
    {
      code: "es",
      text: "La gnostica habla.",
    },
    {
      code: "vi",
      text: "hoc tro gnosis dang hoc.",
    },
  ], model);

  const targetHtml = highlights.get("vi")?.html ?? "";
  const payloadMatch = targetHtml.match(/data-editor-glossary-tooltip-payload="([^"]+)"/);
  assert.ok(payloadMatch);

  const payloadJson = payloadMatch[1]
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
  const payload = JSON.parse(payloadJson);

  assert.equal(payload.kind, "target");
  assert.equal(payload.title, "hoc tro gnosis");
  assert.deepEqual(payload.variants, ["gnostica", "gnostico"]);
  assert.deepEqual(payload.translatorNotes, ["Lien quan den Gnosis"]);
  assert.deepEqual(payload.footnotes, ["Chu thich bo sung"]);
});

test("derived source highlights include glossary provenance in the structured tooltip payload", () => {
  const model = buildEditorDerivedGlossaryModel({
    sourceLanguage: {
      code: "en",
      name: "English",
    },
    targetLanguage: {
      code: "vi",
      name: "Vietnamese",
    },
    entries: [{
      sourceTerm: "inner chamber",
      glossarySourceTerm: "camara interior",
      targetVariants: ["buong noi tam"],
      notes: ["Dung thuat ngu cua glossary"],
    }],
  });

  const highlights = buildEditorRowSourceGlossaryHighlights([
    {
      code: "en",
      text: "The inner chamber glows.",
    },
  ], model);

  const sourceHtml = highlights.get("en")?.html ?? "";
  const payloadMatch = sourceHtml.match(/data-editor-glossary-tooltip-payload="([^"]+)"/);
  assert.ok(payloadMatch);

  const payloadJson = payloadMatch[1]
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
  const payload = JSON.parse(payloadJson);

  assert.equal(payload.kind, "source");
  assert.equal(payload.title, "inner chamber");
  assert.deepEqual(payload.variants, ["buong noi tam"]);
  assert.deepEqual(payload.translatorNotes, ["Dung thuat ngu cua glossary"]);
  assert.deepEqual(payload.originTerms, ["camara interior"]);
});

test("derived glossary highlights are marked as errors when the expected target variant is missing", () => {
  const model = buildEditorDerivedGlossaryModel({
    sourceLanguage: {
      code: "en",
      name: "English",
    },
    targetLanguage: {
      code: "vi",
      name: "Vietnamese",
    },
    entries: [{
      sourceTerm: "inner chamber",
      glossarySourceTerm: "camara interior",
      targetVariants: ["buong noi tam"],
      notes: ["Dung thuat ngu cua glossary"],
    }],
  });

  const highlights = buildEditorRowGlossaryHighlights([
    {
      code: "en",
      text: "The inner chamber glows.",
    },
    {
      code: "vi",
      text: "Anh sang toa ra.",
    },
  ], model);

  const sourceHtml = highlights.get("en")?.html ?? "";
  assert.match(sourceHtml, /glossary-match-error/);

  const payloadMatch = sourceHtml.match(/data-editor-glossary-tooltip-payload="([^"]+)"/);
  assert.ok(payloadMatch);

  const payloadJson = payloadMatch[1]
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
  const payload = JSON.parse(payloadJson);

  assert.equal(payload.kind, "source");
  assert.equal(payload.title, "inner chamber");
  assert.deepEqual(payload.variants, ["buong noi tam"]);
  assert.deepEqual(payload.translatorNotes, ["Dung thuat ngu cua glossary"]);
  assert.deepEqual(payload.originTerms, ["camara interior"]);
});

test("translation glossary hints use the matched source term, ordered target variants, and notes only", () => {
  const model = buildEditorGlossaryModel(glossaryPayload({
    terms: [
      {
        termId: "t1",
        sourceTerms: ["gnostica", "gnostico"],
        targetTerms: ["hoc tro gnosis", "cua gnosis"],
        notesToTranslators: "Lien quan den Gnosis",
        footnote: "Chu thich bo sung",
      },
    ],
  }));

  const hints = buildEditorAiTranslationGlossaryHints(
    "La gnostica habla.",
    "es",
    "vi",
    model,
  );

  assert.deepEqual(hints, [{
    sourceTerm: "gnostica",
    targetVariants: ["hoc tro gnosis", "cua gnosis"],
    notes: ["Lien quan den Gnosis"],
  }]);
  assert.equal("footnotes" in hints[0], false);
});

test("translation glossary hints are omitted when the translation target does not match the glossary target", () => {
  const model = buildEditorGlossaryModel(glossaryPayload({
    terms: [
      {
        termId: "t1",
        sourceTerms: ["gnostica"],
        targetTerms: ["hoc tro gnosis"],
        notesToTranslators: "Lien quan den Gnosis",
      },
    ],
  }));

  const hints = buildEditorAiTranslationGlossaryHints(
    "La gnostica habla.",
    "es",
    "fr",
    model,
  );

  assert.deepEqual(hints, []);
});

test("translation glossary hints serialize ruby target variants for ai prompts", () => {
  const model = buildEditorGlossaryModel(glossaryPayload({
    sourceLanguage: {
      code: "es",
      name: "Spanish",
    },
    targetLanguage: {
      code: "ja",
      name: "Japanese",
    },
    terms: [
      {
        termId: "t1",
        sourceTerms: ["espiritu"],
        targetTerms: ["<ruby>精神<rt>せいしん</rt></ruby>", "魂"],
      },
    ],
  }));

  const hints = buildEditorAiTranslationGlossaryHints(
    "El espiritu canta.",
    "es",
    "ja",
    model,
  );

  assert.deepEqual(hints, [{
    sourceTerm: "espiritu",
    targetVariants: ["精神[ruby: せいしん]", "魂"],
    notes: [],
  }]);
});

test("translation glossary hints keep an omission-only instruction when the empty variant is the only target option", () => {
  const model = buildEditorGlossaryModel(glossaryPayload({
    terms: [
      {
        termId: "t1",
        sourceTerms: ["mente"],
        targetTerms: [""],
      },
    ],
  }));

  const hints = buildEditorAiTranslationGlossaryHints(
    "La mente canta.",
    "es",
    "vi",
    model,
  );

  assert.deepEqual(hints, [{
    sourceTerm: "mente",
    targetVariants: [],
    noTranslationPosition: "only",
    notes: [],
  }]);
});

test("translation glossary hints mark omission as preferred when the empty variant is first", () => {
  const model = buildEditorGlossaryModel(glossaryPayload({
    terms: [
      {
        termId: "t1",
        sourceTerms: ["mente"],
        targetTerms: ["", "tam", "tri"],
      },
    ],
  }));

  const hints = buildEditorAiTranslationGlossaryHints(
    "La mente canta.",
    "es",
    "vi",
    model,
  );

  assert.deepEqual(hints, [{
    sourceTerm: "mente",
    targetVariants: ["tam", "tri"],
    noTranslationPosition: "first",
    notes: [],
  }]);
});

test("translation glossary hints append omission guidance when the empty variant is later", () => {
  const model = buildEditorGlossaryModel(glossaryPayload({
    terms: [
      {
        termId: "t1",
        sourceTerms: ["mente"],
        targetTerms: ["tam", "", "tri"],
      },
    ],
  }));

  const hints = buildEditorAiTranslationGlossaryHints(
    "La mente canta.",
    "es",
    "vi",
    model,
  );

  assert.deepEqual(hints, [{
    sourceTerm: "mente",
    targetVariants: ["tam", "tri"],
    noTranslationPosition: "later",
    notes: [],
  }]);
});
