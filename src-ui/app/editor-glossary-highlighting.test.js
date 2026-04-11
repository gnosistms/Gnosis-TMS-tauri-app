import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEditorGlossaryModel,
  buildEditorRowGlossaryHighlights,
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
