import test from "node:test";
import assert from "node:assert/strict";

import { liveAnswerHtml, sourceSnippets, stepDisplay } from "./glossary-research-live-views.js";

const progress = {
  key: "n", total: 10, unit: "sentence", view: "senses", word: "mortal", language: "English",
  senses: [{ id: "needed", gloss: "Causing death." }, { id: "o1", gloss: "Subject to death." }],
};

test("sorting by meaning is charted per meaning with its name, while it streams", () => {
  const html = liveAnswerHtml({ stage: "frequency", progress, answer: '{"items":[{"n":1,"sense":"o1"},{"n":2,"sense":"needed"},{"n":3,"sense":"o1"},{"n":4,"se' });
  assert.match(html, /“mortal” in everyday English: which meaning it has in each sentence \(3 of 10\)/);
  assert.match(html, /needed<\/span> Causing death\./);
  assert.match(html, /Subject to death\.[\s\S]*?width:20%[\s\S]*?>2</);
  assert.doesNotMatch(html, /not this word/, "an empty leftover row is not shown");
});

test("a finished sorting says so; unknown steps fall back to the plain answer", () => {
  assert.match(liveAnswerHtml({ stage: "frequency", progress, usage: {}, answer: '{"items":[{"n":1,"sense":"not_this_word"}]}' }), /which meaning it has in each sentence \(1\)/);
  assert.equal(liveAnswerHtml({ progress: { key: "n" }, answer: '{"items":[]}' }), null);
  assert.equal(liveAnswerHtml({ stage: "frequency", progress, answer: "not json" }), null);
});

test("batch steps tally the whole batch by translation name", () => {
  const request = { stage: "counting", progress: { variants: { e1v1: "inner", e2v1: "inner", e1v2: "Innermost" } },
    answer: '{"items":[{"occId":"o1","status":"selected","variantId":"e1v2","sentenceTranslation":"the Innermost","chosenWording":"Innermost"}' };
  const other = { answer: '{"items":[{"occId":"o2","status":"selected","variantId":"e1v1"},{"occId":"o3","status":"selected","variantId":"e2v1"}]}' };
  const html = liveAnswerHtml(request, { batch: [request, other] });
  assert.match(html, /\(3 uses of the word\)/);
  const bar = (name, n) => new RegExp(`research-chart__label" role="cell">${name}</span>\\s*<span class="research-chart__track" role="cell"><span class="research-chart__bar" style="width:[^"]*"></span><span class="research-chart__value">${n}<`, "g");
  assert.equal((html.match(bar("inner", 2)) ?? []).length, 1, "one bar for “inner” across entries");
  assert.match(html, bar("Innermost", 1));
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
  assert.match(html, /Translation chosen for each use of the word \(2 uses of the word\)/);
  assert.match(html, /research-chart__label" role="cell">inner<\/span>[\s\S]*?research-chart__value">2</);
  assert.match(html, /<details class="research-view__more"><summary>Show the 2 uses<\/summary>/);
  assert.doesNotMatch(html, /o1|o2/, "no internal ids");
});

test("each counted use shows its source sentence, the word marked", () => {
  const text = "### Passage o001\no001.1: use entry [e1]\n(previous passage) …otra cosa. Más ⟦íntimo⟧ texto.\nPrimera frase. Aquellos que llegan a la Auto-Realización ⟦Intima⟧ [o001.1] mediante la evolución, son mentirosos.\n(next passage) La Auto-Realización Intima es…";
  const snippet = sourceSnippets(text).get("o001.1");
  assert.deepEqual(snippet, { before: "Aquellos que llegan a la Auto-Realización ", word: "Intima", after: " mediante la evolución, son mentirosos." });
  const request = { stage: "counting", text, usage: {}, progress: { variants: { e1v1: "inner" } }, answer: '{"items":[{"occId":"o001.1","status":"selected","variantId":"e1v1","sentenceTranslation":"inner Self-realization","chosenWording":"inner"}]}' };
  assert.match(liveAnswerHtml(request, { final: true }), /research-view__source" lang="es">Aquellos que llegan a la Auto-Realización <mark>Intima<\/mark>/);
});

test("after the second count, the uses where the two AIs differ are listed with the source and both translations", () => {
  const text = "o1.1 x\nUno ⟦íntimo⟧ [o1.1] aquí.\nDos ⟦íntima⟧ [o2.1] allí.";
  const req = (answer) => ({ stage: "counting", text, usage: {}, progress: { variants: { a: "Innermost", b: "within" } }, answer });
  const first = { heading: "Counting", items: [], requests: [req('{"items":[{"occId":"o1.1","status":"selected","variantId":"a","sentenceTranslation":"the Innermost","chosenWording":"Innermost"},{"occId":"o2.1","status":"selected","variantId":"a","sentenceTranslation":"x Innermost","chosenWording":"Innermost"}]}')] };
  const second = { heading: "Counting (second judge)", items: [], requests: [req('{"items":[{"occId":"o1.1","status":"selected","variantId":"a","sentenceTranslation":"the Innermost","chosenWording":"Innermost"},{"occId":"o2.1","status":"selected","variantId":"b","sentenceTranslation":"Christ within","chosenWording":"within"}]}')] };
  const shown = stepDisplay(second, { sections: [first, second], source: "Spanish" });
  assert.match(shown.html, /The two AIs chose differently for 1 of 2 uses/);
  assert.match(shown.html, /Dos <mark>íntima<\/mark> allí\./);
  assert.match(shown.html, /First AI<strong>Innermost<\/strong>[\s\S]*x <mark>Innermost<\/mark>[\s\S]*Second AI<strong>within<\/strong>[\s\S]*Christ <mark>within<\/mark>/);
  assert.match(shown.html, /Each card: the Spanish sentence/);
  assert.ok(shown.after && shown.results.has("agreement"));
});

test("a word that only begins like the term shows among the spellings once the check keeps it", () => {
  const result = (form, rows, kind) => ({ kind: "result", resultKind: "formCount", data: [{ form, rows, added: kind !== "user", kind }] });
  const propose = { requestId: "r1", stage: "forms", usage: {}, answer: '{"forms":[{"form":"cohabitar","kind":"user","confidence":"high"}]}' };
  const confirm = (answer, usage) => ({ requestId: "r2", stage: "forms", ...(usage ? { usage } : {}), answer });
  const section = (check) => ({ heading: "Word forms", items: [result("cohabitar", 20, "user"), result("cohabitaremos", 1, "extension"), result("cohabitación", 4, "extension")], requests: [propose, check] });
  const running = stepDisplay(section(confirm('{"forms":[{"form":"cohabitar","keep":true,"reason":"ok"}')));
  assert.doesNotMatch(running.html, /cohabitaremos|cohabitación/, "not shown before the check");
  const done = stepDisplay(section(confirm('{"forms":[{"form":"cohabitar","keep":true,"reason":"ok"},{"form":"cohabitaremos","keep":true,"reason":"future tense"},{"form":"cohabitación","keep":false,"reason":"a noun made from it"}]}', {})));
  assert.match(done.html, /✓ cohabitaremos \(1\)/);
  assert.doesNotMatch(done.html, /cohabitación/, "a word made from the term belongs to the word family, not the spellings");
  assert.doesNotMatch(done.html, /Crossed out/);
});

test("a form of a related word that the check rejects is not shown with it", () => {
  const family = { requestId: "f1", stage: "family", usage: {}, answer: '{"words":[{"form":"intimidad","kind":"suffixed","reason":"noun"}]}' };
  const check = { requestId: "f2", stage: "family", usage: {}, answer: '{"forms":[{"form":"intimidades","keep":true,"reason":"plural"},{"form":"intimidado","keep":false,"reason":"from intimidar"}]}' };
  const count = (form, rows, of) => ({ kind: "result", resultKind: "familyCount", data: [{ form, rows, ...(of ? { of } : {}) }] });
  const shown = stepDisplay({
    heading: "Word family",
    items: [count("intimidad", 13), count("intimidades", 4, "intimidad"), count("intimidado", 1, "intimidad"),
      { kind: "line", entry: { type: "fact", text: "Related words in the texts (paragraphs): intimidad (13), intimidades (4)" } }],
    requests: [family, check],
  });
  assert.ok(shown.requests.has("f2"), "the check has no conversation of its own");
  assert.match(shown.html, /intimidades \(4\) \(a form\)/);
  assert.doesNotMatch(shown.html, /intimidado/);
});
