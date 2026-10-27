import test from "node:test";
import assert from "node:assert/strict";
import { exploratoryContext, focusedSample, rankRecoveryParagraphs } from "./glossary-research-studio-sampling.js";

function fixture(n = 80) {
  const passages = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, text: `forma ${i}`,
    reference: { doc_id: `book${i % 5}` }, occurrences: [{ id: "o", start: 0, end: 5, surface: "forma" }] }));
  return { scope: { seed: 11 }, passages, meanings: [{ id: "m" }] };
}
const assignments = (s) => s.passages.map((p) => ({ paragraphId: p.id, occurrenceId: "o", meaningId: "m" }));

test("focused sampling caps dominant meanings, preserves contrasts, and remains stable across repairs", () => {
  const s = fixture();
  s.passages[70].recovered = true;
  s.passages[71].occurrences[0].surface = "formas";
  s.passages[72].text = "más forma";
  s.passages[73].text = "la forma"; s.passages[73].occurrences[0].start = 3;
  const original = structuredClone(s);
  const a = assignments(s); const sample = focusedSample(s, "m", a);
  assert.equal(sample.paragraphs.length, 10);
  for (const id of ["p70", "p71", "p72", "p73"]) assert(sample.paragraphs.some((p) => p.id === id));
  assert.equal(sample.totalParagraphs, 80);
  s.candidates = [{ text: "changed translation" }];
  assert.deepEqual(focusedSample(s, "m", a), sample);
  assert.deepEqual(s.passages, original.passages);
  assert.deepEqual(sample.paragraphs, s.passages.filter((p) => sample.paragraphs.includes(p)), "source order survives selection");
});

test("rare meanings retain every paragraph and explicit expansion restores the whole pool", () => {
  const s = fixture(4); assert.equal(focusedSample(s, "m", assignments(s)).paragraphs.length, 4);
  const large = fixture(); large.focusedSampleLimits = { m: Number.MAX_SAFE_INTEGER };
  assert.equal(focusedSample(large, "m", assignments(large)).paragraphs.length, 80);
});

test("local recovery ranking promotes a late clue while protecting different missing meanings", () => {
  const paragraphs = fixture(500).passages;
  paragraphs[489].text = "la conciencia ilumina las profundidades";
  paragraphs[488].text = "una noche sin luz";
  const ranked = rankRecoveryParagraphs(paragraphs, [{ meaningId: "psychology", clues: ["conciencia", "profundidades"] },
    { meaningId: "physical", clues: ["noche sin luz"] }], 11);
  assert(ranked.slice(0, 2).some((p) => p.id === "p489"));
  assert(ranked.slice(0, 2).some((p) => p.id === "p488"));
  assert.equal(new Set(ranked.map((p) => p.id)).size, 500);
  assert.deepEqual(rankRecoveryParagraphs(paragraphs, [], 11), paragraphs);
});

test("exploratory context is selective without modifying full source evidence", () => {
  const p = { id: "p", text: "complete source paragraph", contextBefore: ["before"], contextAfter: ["after"] };
  assert.deepEqual(exploratoryContext({}, p), { before: [], after: [] });
  for (const s of [{ expandedContextIds: ["p"] }, { contextIncludedIds: ["p"] }]) assert.deepEqual(exploratoryContext(s, p), { before: ["before"], after: ["after"] });
  assert.equal(p.text, "complete source paragraph"); assert.deepEqual(p.contextBefore, ["before"]);
});
