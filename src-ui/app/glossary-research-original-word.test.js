import test from "node:test";
import assert from "node:assert/strict";

import {
  enforceOriginalWords, noteNamesTheBook, originalFor, originalSourceLabel, originalWordOf, placeOriginalWords, requiredOriginalWords,
} from "./glossary-research-original-word.js";
import { frozenEntryText } from "./glossary-research-prompts.js";

const dayspring = {
  title: "Dioses Atómicos (La aurora de la juventud) — M.",
  translated: true,
  originalLanguage: "en",
  originalTitle: "The Dayspring of Youth",
  originalAuthor: "M.",
  originalBookId: "dayspring",
  headwordPairs: [{ source: "Íntimo", original: "Innermost" }],
};
const noun = {
  sense: "Substantive Íntimo: the individual divine inner Being or Spirit",
  inDictionary: false,
  sourceBook: "Dioses Atómicos (La aurora de la juventud) — M.; original: The Dayspring of Youth",
  originalLanguage: "English",
  originalTerm: "Innermost",
};
const adjective = { sense: "Ordinary adjectival inwardness or depth", inDictionary: true, originalTerm: null };

test("a word is verified only when it was read in the original text", () => {
  const forms = ["íntimo", "íntima"];
  const fromPairs = originalWordOf(noun, dayspring, { forms, pairReads: new Map([["dayspring", 12]]) });
  assert.equal(fromPairs.verified, true);
  assert.equal(fromPairs.languageCode, "en");
  assert.equal(originalWordOf(noun, dayspring, { forms, pairReads: new Map() }).verified, false, "pairs not found in the original text");
  assert.equal(originalWordOf(noun, dayspring, { forms: ["vanidad"], pairReads: new Map([["dayspring", 12]]) }).verified, false, "pairs of another word");
  assert.equal(originalWordOf({ ...noun, originalCheck: { confirmed: true } }, dayspring).verified, true);
  assert.equal(originalWordOf({ ...noun, originalCheck: { confirmed: false, originalTerm: "Innermost" } }, dayspring).verified, true, "corrected from the original");
  assert.equal(originalWordOf({ ...noun, originalCheck: { confirmed: false, originalTerm: null } }, dayspring).verified, false);
  assert.equal(originalWordOf(adjective, dayspring), null, "a dictionary sense has no original word");
  assert.equal(originalWordOf(noun, { ...dayspring, translated: false }), null, "a book written in the source language");
});

test("only original words in the glossary's target language bind it", () => {
  const study = { senses: [adjective, { ...noun, originalWord: originalWordOf({ ...noun, originalCheck: { confirmed: true } }, dayspring) }] };
  assert.deepEqual(requiredOriginalWords(study, "en").map((w) => w.term), ["Innermost"]);
  assert.deepEqual(requiredOriginalWords(study, "en-US").map((w) => w.term), ["Innermost"]);
  assert.deepEqual(requiredOriginalWords(study, "vi"), [], "Spanish → Vietnamese: the English word does not apply");
  const unverified = { senses: [{ ...noun, originalWord: originalWordOf(noun, dayspring) }] };
  assert.deepEqual(requiredOriginalWords(unverified, "en"), []);
});

const required = [{ term: "Innermost", sense: noun.sense, originalTitle: "The Dayspring of Youth", originalAuthor: "M.", verified: true, basis: "x" }];

test("the original word stands alone, recommended, in its meaning", () => {
  const candidates = { senses: [
    { senseId: "s1", sense: "inner", groups: [{ members: ["inner", "inward"], recommended: true, note: "n" }] },
    { senseId: "s6", sense: "divine Being", groups: [
      { members: ["inner Being", "innermost Being"], recommended: true, note: "a" },
      { members: ["Inmost", "Innermost"], recommended: false, note: "b" },
    ] },
  ] };
  const placed = placeOriginalWords(candidates, required);
  assert.deepEqual(placed.map((w) => [w.term, w.senseId, w.added]), [["Innermost", "s6", false]]);
  const s6 = candidates.senses[1].groups;
  assert.deepEqual(s6.map((g) => [g.members, g.recommended]), [[["Innermost"], true], [["inner Being", "innermost Being"], false], [["Inmost"], false]]);
  assert.equal(candidates.senses[0].groups[0].recommended, true, "other meanings keep their recommendation");
  assert.ok(originalFor(placed, "Innermost", "s6"));
  assert.equal(originalFor(placed, "Innermost", "s1"), null, "the same word in another meaning is checked as usual");
});

test("an original word the candidates left out is added", () => {
  const candidates = { senses: [{ senseId: "s1", sense: "inner", groups: [{ members: ["inner"], recommended: true, note: "" }] }] };
  const placed = placeOriginalWords(candidates, required);
  assert.equal(placed[0].added, true);
  assert.equal(placed[0].senseId, "none");
  assert.deepEqual(candidates.senses[1].groups[0].members, ["Innermost"]);
});

const divine = ["Outside dictionary: individual divine inner Being or Spirit"];
const proposalOf = () => ({ entries: [
  { id: "e1", kind: "word", sourceTerms: ["íntimo"], variants: [
    { id: "e1v1", target: "inner", note: "Default.", senses: ["DLE 1"] },
    { id: "e1v2", target: "Innermost", note: "Divine noun.", senses: divine },
    { id: "e1v3", target: "inner Being", note: "Explanatory.", senses: divine },
  ] },
  { id: "e2", kind: "word", sourceTerms: ["íntima", "íntimas"], variants: [{ id: "e2v1", target: "inner", note: "", senses: ["DLE 1"] }] },
] });
const placed = [{ ...required[0], senseId: "s6", senseText: "divine Being" }];

test("the proposal keeps the original word first and drops other renderings of its meaning", () => {
  const proposal = proposalOf();
  const { added, removed } = enforceOriginalWords(proposal, placed, { headword: "íntimo" });
  assert.deepEqual(added, []);
  assert.deepEqual(removed.map((r) => r.target), ["inner Being"]);
  assert.deepEqual(proposal.entries[0].variants.map((v) => v.target), ["Innermost", "inner"]);
  assert.equal(proposal.entries[0].variants[0].original.book, "The Dayspring of Youth (M.)");
  assert.match(proposal.leftOutRenderings[0].reason, /original word/);
  assert.deepEqual(proposal.entries[1].variants.map((v) => v.target), ["inner"], "the adjective-only entry is untouched");
});

test("a proposal without the original word gets it in the headword's entry", () => {
  const proposal = proposalOf();
  proposal.entries[0].variants.splice(1, 1);
  const { added } = enforceOriginalWords(proposal, placed, { headword: "íntimo" });
  assert.deepEqual(added, [{ entryId: "e1", target: "Innermost" }]);
  assert.equal(proposal.entries[0].variants[0].target, "Innermost");
  assert.equal(proposal.entries[0].variants[0].id, "e1v4", "a free id");
});

test("the note must name the book; the counting judges see the mark", () => {
  const proposal = proposalOf();
  enforceOriginalWords(proposal, placed, { headword: "íntimo" });
  const variant = proposal.entries[0].variants[0];
  assert.equal(noteNamesTheBook(variant), false);
  variant.note = "Traditional English term for this meaning, from The Dayspring of Youth; use it whenever íntimo names the divine Being.";
  assert.equal(noteNamesTheBook(variant), true);
  assert.equal(noteNamesTheBook(proposal.entries[0].variants[1]), true, "an ordinary variant needs no book");
  const text = frozenEntryText({ entries: [{ ...proposal.entries[0], generalNote: "" }] }, "English");
  assert.match(text, /TRADITIONAL ENGLISH TERM: the original word of The Dayspring of Youth \(M\.\)/);
});

test("the word with an article counts as the word, a longer rendering does not", () => {
  const candidates = { senses: [{ senseId: "s6", sense: "divine Being", groups: [
    { members: ["the Innermost"], recommended: false, note: "" },
    { members: ["innermost Being"], recommended: true, note: "" },
  ] }] };
  const placed = placeOriginalWords(candidates, required);
  assert.equal(placed[0].senseId, "s6");
  assert.deepEqual(candidates.senses[0].groups.map((g) => [g.members, g.recommended]), [[["Innermost"], true], [["innermost Being"], false]]);
});

test("an original word is labelled by the author of its book", () => {
  assert.equal(originalSourceLabel({ author: "M.", book: "The Dayspring of Youth (M.)" }), "from M.");
  assert.equal(originalSourceLabel({ book: "The Dayspring of Youth (M.)", originalTitle: "The Dayspring of Youth" }), "from M.", "older runs: from the book's name");
  assert.equal(originalSourceLabel({ book: "Isis Unveiled", originalTitle: "Isis Unveiled" }), "from Isis Unveiled", "no author known");
});

test("the word as written wins over a lower-case variant listed for another meaning", () => {
  const candidates = { senses: [
    { senseId: "s1", sense: "deep within", groups: [{ members: ["inner", "inward", "innermost"], recommended: true, note: "" }] },
    { senseId: "s6", sense: "divine Being", groups: [{ members: ["Innermost"], recommended: true, note: "divine" }] },
  ] };
  const placed = placeOriginalWords(candidates, required);
  assert.equal(placed[0].senseId, "s6");
  assert.deepEqual(candidates.senses[0].groups[0].members, ["inner", "inward", "innermost"], "the adjective stays where it is");
  assert.equal(candidates.senses[0].groups[0].recommended, true);
  assert.equal(originalFor(placed, "innermost", "s6"), null, "the lower-case adjective is checked as usual");
  const proposal = { entries: [{ id: "e1", kind: "word", sourceTerms: ["íntimo"], variants: [
    { id: "e1v1", target: "innermost", note: "adjective", senses: ["DLE 1"] },
    { id: "e1v2", target: "Innermost", note: "divine", senses: ["divine"] },
  ] }] };
  enforceOriginalWords(proposal, placed, { headword: "íntimo" });
  assert.deepEqual(proposal.entries[0].variants.map((v) => [v.target, Boolean(v.original)]), [["Innermost", true], ["innermost", false]]);
});
