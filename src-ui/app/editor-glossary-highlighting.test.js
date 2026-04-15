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
