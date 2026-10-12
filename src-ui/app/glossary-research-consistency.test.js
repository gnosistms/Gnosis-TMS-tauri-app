import test from "node:test";
import assert from "node:assert/strict";

import { addRound, flipSets, flipsOf, meaningsOfVariants, pickSentences, setVotes, settleMeanings, winnerOf } from "./glossary-research-consistency.js";

const frozen = { entries: [
  { id: "e1", kind: "word", variants: [{ id: "v1" }, { id: "v2" }, { id: "v3" }] },
  { id: "e2", kind: "word", variants: [{ id: "w1" }] },
] };
const proposal = { entries: [
  { id: "e1", variants: [{ id: "v1", senses: ["planet"] }, { id: "v2", senses: ["planet", "everything"] }, { id: "v3", senses: ["society"] }] },
  { id: "e2", variants: [{ id: "w1", senses: ["x"] }] },
] };
const use = (occId, entryId, variantId) => ({ occId, entryId, variantId });
const uses = [use("o1", "e1", "v1"), use("o2", "e1", "v1"), use("o3", "e1", "v2"), use("o4", "e1", "v1"), use("o5", "e1", "v3"), use("o6", "e2", "w1")];
const counting = { occurrences: uses.map(({ occId, entryId }) => ({ occId, entryId })), judgments: Object.fromEntries(uses.map((u) => [u.occId, { status: "selected", variantId: u.variantId }])) };

test("sentences are picked per meaning, the uses the two counts disagreed on first; one-translation entries are not tested", () => {
  const counting2 = { judgments: { o4: { status: "selected", variantId: "v2" } } };
  const picks = pickSentences({ frozen, proposal, counting, counting2, perMeaning: 2 });
  assert.deepEqual(picks, [
    { entryId: "e1", meaning: "planet", occId: "o4" },
    { entryId: "e1", meaning: "planet", occId: "o1" },
    { entryId: "e1", meaning: "society", occId: "o5" },
  ]);
});

test("flips: a sentence translated with more than one translation; sets join translations that flip with one another", () => {
  const tally = new Map();
  const round = (a, b) => [
    { occId: "o1", status: "selected", variantId: a, sentenceTranslation: `on this ${a}` },
    { occId: "o5", status: "selected", variantId: "v3", sentenceTranslation: "society" },
    { occId: "o2", status: "selected", variantId: b, sentenceTranslation: `the ${b}` },
  ];
  for (const [a, b] of [["v1", "v1"], ["v2", "v1"], ["v1", "v1"], ["v1", "v1"], ["v2", "v1"]]) addRound(tally, round(a, b));
  const flips = flipsOf(tally);
  assert.deepEqual(flips.map((f) => [f.occId, f.variantIds, f.choices]), [["o1", ["v1", "v2"], { v1: 3, v2: 2 }]]);
  assert.equal(flips[0].translations.v2, "on this v2");
  const sets = flipSets(flips, () => "e1", new Map([["o1", true]]));
  assert.deepEqual(sets, [{ entryId: "e1", same: true, variantIds: ["v1", "v2"], occIds: ["o1"] }]);
  const votes = setVotes(sets[0], tally);
  assert.deepEqual(votes, { v1: 3, v2: 2 });
  assert.equal(winnerOf(votes), "v1");
  assert.equal(winnerOf({ v1: 4, v2: 4 }), null, "a tie has no winner");
  const meaningOf = new Map([["o1", "planet"], ["o2", "planet"], ["o5", "society"]]);
  const meanings = meaningsOfVariants({ senses: new Map([["v1", ["planet"]], ["v2", ["planet", "everything"]], ["v3", ["society"]]]), tally, meaningOf });
  assert.deepEqual([...meanings.get("v2")], ["planet", "everything"]);
  // "v2" loses "planet" but still serves "everything": it stays, narrowed.
  assert.deepEqual(settleMeanings([{ keep: "v1", variantIds: ["v1", "v2"], meanings: ["planet"] }], meanings),
    { dropped: [], narrowed: [{ variantId: "v2", removed: ["planet"], kept: ["everything"] }] });
});

test("flips that keep and that change the meaning make separate sets", () => {
  const flips = [
    { occId: "o1", variantIds: ["v1", "v2"] },
    { occId: "o2", variantIds: ["v2", "v3"] },
    { occId: "o3", variantIds: ["v1", "v3"] },
  ];
  const sets = flipSets(flips, () => "e1", new Map([["o1", true], ["o2", true], ["o3", false]]));
  assert.deepEqual(sets.map((s) => [s.same, s.variantIds.sort(), s.occIds.sort()]), [
    [true, ["v1", "v2", "v3"], ["o1", "o2"]],
    [false, ["v1", "v3"], ["o3"]],
  ]);
});

test("a translation two meanings both standardise away from is dropped: neither keeps it for the other", () => {
  // "world" serves "planet" and "level of existence"; each meaning standardises on another word.
  const meanings = new Map([["world", new Set(["planet", "level"])], ["planet", new Set(["planet"])], ["realm", new Set(["level"])]]);
  const settled = settleMeanings([
    { keep: "planet", variantIds: ["planet", "world"], meanings: ["planet"] },
    { keep: "realm", variantIds: ["realm", "world"], meanings: ["level"] },
  ], meanings);
  assert.deepEqual(settled, { dropped: ["world"], narrowed: [] });
  // Only one of them standardises away: "world" stays for the other.
  assert.deepEqual(settleMeanings([{ keep: "planet", variantIds: ["planet", "world"], meanings: ["planet"] }], meanings),
    { dropped: [], narrowed: [{ variantId: "world", removed: ["planet"], kept: ["level"] }] });
});
