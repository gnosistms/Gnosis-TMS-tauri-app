import test from "node:test";
import assert from "node:assert/strict";

import { liveAnswerHtml } from "./glossary-research-live-views.js";

const progress = {
  key: "n", total: 10, unit: "sentence", view: "senses", word: "mortal", language: "English",
  senses: [{ id: "needed", gloss: "Causing death." }, { id: "o1", gloss: "Subject to death." }],
};

test("sorting by meaning is charted per meaning with its name, while it streams", () => {
  const html = liveAnswerHtml({ progress, answer: '{"items":[{"n":1,"sense":"o1"},{"n":2,"sense":"needed"},{"n":3,"sense":"o1"},{"n":4,"se' });
  assert.match(html, /Sorting 3 of 10 general English sentences with “mortal” by meaning/);
  assert.match(html, /needed<\/span> Causing death\./);
  assert.match(html, /Subject to death\.[\s\S]*?width:20%[\s\S]*?>2</);
  assert.doesNotMatch(html, /not this word/, "an empty leftover row is not shown");
});

test("a finished sorting says so; unknown steps fall back to the plain answer", () => {
  assert.match(liveAnswerHtml({ progress, usage: {}, answer: '{"items":[{"n":1,"sense":"not_this_word"}]}' }), /Sorted 1 general English/);
  assert.equal(liveAnswerHtml({ progress: { key: "n" }, answer: '{"items":[]}' }), null);
  assert.equal(liveAnswerHtml({ progress, answer: "not json" }), null);
});
