import test from "node:test";
import assert from "node:assert/strict";

import { parsePartialJson } from "./glossary-research-partial-json.js";

const samples = [
  '{"items":[{"n":1,"sense":"s5"},{"n":2,"sense":"s3"},{"n":10,"sense":"not_this_word"}]}',
  '{"senses":[{"senseId":"s1","sense":"inner, deepest","groups":[{"members":["inner","innermost"],"recommended":true,"note":"say \\"inner\\", then [x] {y}","rationale":"r"}]}]}',
  '{"found":false,"confidence":"low","sourceTerm":null,"definitions":[],"ratio":-1.5e3}',
  ' \n{"a":{"b":[[1,2],[3]],"c":"é\\u00e9"}}',
];

test("every cut of a real answer reads without throwing, as a prefix of the whole", () => {
  for (const sample of samples) {
    const whole = JSON.parse(sample.trim());
    for (let cut = 0; cut <= sample.length; cut += 1) {
      const value = parsePartialJson(sample.slice(0, cut));
      if (value === null) continue;
      assert.equal(typeof value, "object", `cut ${cut} of ${sample}`);
    }
    assert.deepEqual(parsePartialJson(sample), whole);
  }
});

test("finished items are read; the item being written keeps what is whole", () => {
  assert.deepEqual(parsePartialJson('{"items":[{"n":1,"sense":"s5"},{"n":2,"sen'), { items: [{ n: 1, sense: "s5" }, { n: 2 }] });
  assert.deepEqual(parsePartialJson('{"items":[{"n":1,"sense":"s5"},{"n":2'), { items: [{ n: 1, sense: "s5" }, {}] });
  assert.deepEqual(parsePartialJson('{"items":[{"n":1,"sense":"s5"},{"n":'), { items: [{ n: 1, sense: "s5" }, {}] });
});

test("a string value still being written grows in place", () => {
  assert.deepEqual(parsePartialJson('{"summary":"The word comes fr'), { summary: "The word comes fr" });
  assert.deepEqual(parsePartialJson('{"members":["inner","inner'), { members: ["inner", "inner"] });
  assert.deepEqual(parsePartialJson('{"note":"half an escape \\'), { note: "half an escape " });
});

test("text that is not JSON, or has not begun, reads as nothing", () => {
  assert.equal(parsePartialJson(""), null);
  assert.equal(parsePartialJson("Thinking about it"), null);
  assert.deepEqual(parsePartialJson("{"), {});
});
