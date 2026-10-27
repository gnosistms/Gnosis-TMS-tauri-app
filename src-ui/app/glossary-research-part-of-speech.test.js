import test from "node:test";
import assert from "node:assert/strict";

import {
  PARTS_OF_SPEECH, PARTS_SCHEMA, PROPOSAL_SCHEMA, SOURCES_SCHEMA, frozenEntryText, senseClassifyInstructions,
} from "./glossary-research-prompts.js";

test("parts of speech come from one fixed list everywhere a meaning is named", () => {
  const sensePos = PARTS_SCHEMA.properties.senses.items.properties.partOfSpeech;
  assert.deepEqual(sensePos.enum, PARTS_OF_SPEECH);
  assert.deepEqual(SOURCES_SCHEMA.properties.senses.items.properties.partOfSpeech.enum, PARTS_OF_SPEECH);
  assert.deepEqual(PROPOSAL_SCHEMA.properties.partsOfSpeech.items.enum, PARTS_OF_SPEECH);
  const variant = PROPOSAL_SCHEMA.properties.entries.items.properties.variants.items.properties;
  assert.deepEqual(variant.partOfSpeech.enum, PARTS_OF_SPEECH);
  assert.ok(!("wordClass" in SOURCES_SCHEMA.properties.senses.items.properties));
});

test("sorting and counting see each meaning's part of speech", () => {
  const text = senseClassifyInstructions({ languageName: "Spanish", word: "íntimo", senses: [
    { id: "s1", gloss: "inner, deep", partOfSpeech: "adjective" },
    { id: "s6", gloss: "the divine inner Being", partOfSpeech: "noun" },
    { id: "needed", gloss: "no label" },
  ] });
  assert.match(text, /"s1" \(adjective\): inner, deep/);
  assert.match(text, /"s6" \(noun\): the divine/);
  assert.match(text, /"needed": no label/);
  const frozen = frozenEntryText({ entries: [{ id: "e1", kind: "word", sourceTerms: ["íntimo"], generalNote: "", variants: [
    { id: "e1v1", target: "Innermost", note: "divine", partOfSpeech: "noun" },
    { id: "e1v2", target: "inner", note: "default" },
  ] }] }, "English");
  assert.match(frozen, /\[e1v1\] Innermost \(noun\) — divine/);
  assert.match(frozen, /\[e1v2\] inner — default/);
});
