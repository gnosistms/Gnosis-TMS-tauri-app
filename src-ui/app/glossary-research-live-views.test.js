import test from "node:test";
import assert from "node:assert/strict";

import { liveAnswerHtml } from "./glossary-research-live-views.js";

const progress = {
  key: "n", total: 10, unit: "sentence", view: "senses", word: "mortal", language: "English",
  senses: [{ id: "needed", gloss: "Causing death." }, { id: "o1", gloss: "Subject to death." }],
};

test("sorting by meaning is charted per meaning with its name, while it streams", () => {
  const html = liveAnswerHtml({ stage: "frequency", progress, answer: '{"items":[{"n":1,"sense":"o1"},{"n":2,"sense":"needed"},{"n":3,"sense":"o1"},{"n":4,"se' });
  assert.match(html, /Sorting 3 of 10 general English sentences with “mortal” by meaning/);
  assert.match(html, /needed<\/span> Causing death\./);
  assert.match(html, /Subject to death\.[\s\S]*?width:20%[\s\S]*?>2</);
  assert.doesNotMatch(html, /not this word/, "an empty leftover row is not shown");
});

test("a finished sorting says so; unknown steps fall back to the plain answer", () => {
  assert.match(liveAnswerHtml({ stage: "frequency", progress, usage: {}, answer: '{"items":[{"n":1,"sense":"not_this_word"}]}' }), /Sorted 1 general English/);
  assert.equal(liveAnswerHtml({ progress: { key: "n" }, answer: '{"items":[]}' }), null);
  assert.equal(liveAnswerHtml({ stage: "frequency", progress, answer: "not json" }), null);
});

test("batch steps tally the whole batch by translation name", () => {
  const request = { stage: "counting", progress: { variants: { e1v1: "inner", e2v1: "inner", e1v2: "Innermost" } },
    answer: '{"items":[{"occId":"o1","status":"selected","variantId":"e1v2","sentenceTranslation":"the Innermost","chosenWording":"Innermost"}' };
  const other = { answer: '{"items":[{"occId":"o2","status":"selected","variantId":"e1v1"},{"occId":"o3","status":"selected","variantId":"e2v1"}]}' };
  const html = liveAnswerHtml(request, { batch: [request, other] });
  assert.match(html, /all batches so far/);
  assert.equal((html.match(/title="inner: 2"/g) ?? []).length, 1, "one bar for “inner” across entries");
  assert.match(html, /title="Innermost: 1"/);
  assert.match(html, /<mark>Innermost<\/mark>/);
});

test("every step has a view that survives any cut of its answer", () => {
  const answers = {
    forms: '{"forms":[{"form":"íntimo","kind":"inflection","confidence":"high"},{"form":"intimo","kind":"spelling","confidence":"low"}]}',
    candidates: '{"senses":[{"senseId":"s1","sense":"inner","groups":[{"members":["inner","inward"],"recommended":true,"note":"default","rationale":"r"}]}]}',
    checks: '{"candidates":[{"n":1,"target":"inner","words":[{"word":"inner","partOf":null,"forms":[],"neededSense":"inside","lookalike":false,"resembles":null,"otherSenses":[]}],"establishedUsage":false,"establishedBasis":""}]}',
    proposal: '{"partOfSpeech":"adjective","entries":[{"id":"e1","kind":"word","sourceTerms":["íntimo"],"generalNote":"","variants":[{"id":"e1v1","target":"inner","note":"default"}]}],"leftOutRenderings":[{"rendering":"inward","count":2,"reason":"rare"}]}',
    sources: '{"summary":"From M.","senses":[{"sense":"divine Being","label":"as a noun","inDictionary":false,"sourceBook":"Dioses Atómicos","originalLanguage":"English","originalTerm":"Innermost"}]}',
    summary: '{"summary":"Done.","recommendations":["Use inner."],"unresolvedExplanation":""}',
  };
  for (const [stage, answer] of Object.entries(answers)) {
    for (let n = 1; n <= answer.length; n += 1) {
      const html = liveAnswerHtml({ stage, answer: answer.slice(0, n) });
      assert.ok(html === null || typeof html === "string", `${stage} at ${n}`);
    }
    assert.ok(liveAnswerHtml({ stage, answer }), `${stage}: a view of the whole answer`);
  }
});

test("a finished batch step tallies every use and folds the uses behind one line", () => {
  const request = { stage: "counting", usage: {}, progress: { variants: { e1v1: "inner" } }, answer: '{"items":[{"occId":"o1","status":"selected","variantId":"e1v1","sentenceTranslation":"inner life","chosenWording":"inner"}]}' };
  const other = { usage: {}, answer: '{"items":[{"occId":"o2","status":"selected","variantId":"e1v1","sentenceTranslation":"the inner man","chosenWording":"inner"}]}' };
  const html = liveAnswerHtml(request, { batch: [request, other], final: true });
  assert.match(html, /Which translation fits each use \(2 uses\)/);
  assert.match(html, /title="inner: 2"/);
  assert.match(html, /<details class="research-view__more"><summary>Show the 2 uses<\/summary>/);
  assert.doesNotMatch(html, /o1|o2/, "no internal ids");
});
