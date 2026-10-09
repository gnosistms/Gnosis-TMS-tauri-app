import test from "node:test";
import assert from "node:assert/strict";

import {
  borrowingStrength, borrowingText, enforceOriginalWords, languageNameOf, noteNamesTheBook, originalFor, originalSourceLabel,
  signedOnly, originalWordOf, pairFact, placeOriginalWords, requiredOriginalWords,
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
  assert.equal(proposal.entries[0].variants[0].original.book, "The Dayspring of Youth (signed “M.”)");
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
  assert.match(text, /TRADITIONAL ENGLISH TERM: the original word of The Dayspring of Youth \(signed “M\.”\)/);
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
  assert.equal(originalSourceLabel({ author: "H. P. Blavatsky", book: "Isis Unveiled (H. P. Blavatsky)" }), "from H. P. Blavatsky");
  assert.equal(originalSourceLabel({ book: "Isis Unveiled (H. P. Blavatsky)", originalTitle: "Isis Unveiled" }), "from H. P. Blavatsky", "older runs: from the book's name");
  // A book signed only with initials is named by its title: "from M." says nothing.
  assert.equal(originalSourceLabel({ author: "M.", book: "The Dayspring of Youth (signed “M.”)", originalTitle: "The Dayspring of Youth" }), "from The Dayspring of Youth");
  assert.equal(originalSourceLabel({ book: "The Dayspring of Youth (M.)" }), "from The Dayspring of Youth", "older runs");
  assert.equal(signedOnly("M."), true);
  assert.equal(signedOnly("H. P. Blavatsky"), false);
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

test("a borrowing is certain when the sense is not the ordinary one and the book uses it, even once", () => {
  const record = { translated: true, firstSpanishTranslation: "1950", title: "Dioses Atómicos (La aurora de la juventud) — M." };
  const divine = { sense: "the divine Innermost", inDictionary: false, sourceBook: "Dioses Atómicos", exclusivity: "several", firstUseYear: 1950 };
  const strong = borrowingStrength(divine, record);
  assert.equal(strong.strength, "strong");
  assert.match(borrowingText(divine, strong, { author: "Samael Aun Weor", term: "Íntimo", translationTitle: "Dioses Atómicos" }), /^Samael Aun Weor read “Íntimo” in this sense in Dioses Atómicos: the sense is not the ordinary one; the book uses it\. Spanish edition 1950; his first use in this sense 1950\.$/);
  assert.equal(borrowingStrength({ ...divine, inDictionary: true }, record).strength, "weak", "an ordinary meaning is not a borrowing");
  assert.equal(borrowingStrength({ ...divine, exclusivity: "none" }, record).strength, "weak", "the book does not use it in this sense");
  const late = borrowingStrength({ ...divine, firstUseYear: 1948 }, record);
  assert.equal(late.strength, "strong", "dates are shown, not required");
  assert.deepEqual(late.notes, ["the Spanish edition (1950) is later than his first use in this sense (1948)"]);
  const weakStudy = { senses: [{ ...divine, borrowing: { strength: "weak" }, originalWord: { verified: true, languageCode: "en", term: "Innermost" } }] };
  assert.deepEqual(requiredOriginalWords(weakStudy, "en"), [], "an uncertain borrowing does not impose the book's word");
});

// A book whose pairs come from the search site's comparison of the translation with its original.
const isis = {
  title: "Isis sin velo — H. P. Blavatsky",
  translated: true,
  originalLanguage: "en",
  originalTitle: "Isis Unveiled",
  originalAuthor: "H. P. Blavatsky",
  originalBookId: "blavatsky_isis",
  headwordPairs: [],
  termPairs: [{ source: "Daimón", original: "demon", also: ["daimonion"], originalForms: ["demon", "daimonion", "demons"], status: "equivalent_found", basis: "aligned" }],
};
const daimon = { sense: "the inner divine guide", inDictionary: false, sourceBook: "Isis sin velo — H. P. Blavatsky", originalTerm: "demon", exclusivity: "several" };

test("a pair from the site's comparison with the original gives the book's word, like a glossary pair", () => {
  const reads = new Map([["blavatsky_isis", 134]]);
  const word = originalWordOf(daimon, isis, { forms: ["daimón"], pairReads: reads });
  assert.equal(word.verified, true);
  assert.equal(word.pairBasis, "aligned");
  assert.match(word.basis, /^the search site's comparison of the translation with the original pairs it with the term/);
  assert.equal(originalWordOf({ ...daimon, originalTerm: "Daimonion" }, isis, { pairReads: reads }).verified, true, "the book's other wording for the term");
  assert.equal(originalWordOf({ ...daimon, originalTerm: "spirit" }, isis, { pairReads: reads }).verified, false, "a word the pair does not name");
  assert.equal(originalWordOf(daimon, isis, { pairReads: new Map() }).verified, false, "not found in the original text");
  const printed = originalWordOf(noun, { ...dayspring, termPairs: [{ source: "Íntimo", original: "Innermost", basis: "printed" }] }, { pairReads: new Map([["dayspring", 3]]) });
  assert.equal(printed.pairBasis, "printed");
  assert.match(printed.basis, /^the book's own glossary pairs it/);
});

test("an aligned pair counts like a glossary pair for borrowing, under the same rules", () => {
  const strong = borrowingStrength({ ...daimon, exclusivity: "none" }, isis, { pair: "aligned" });
  assert.deepEqual([strong.strength, strong.reasons], ["strong", ["aligned"]]);
  assert.match(borrowingText(daimon, strong, { author: "Samael Aun Weor", term: "daimón", translationTitle: "Isis sin velo" }), /the search site's comparison with the original pairs it with the book's word/);
  assert.equal(borrowingStrength({ ...daimon, inDictionary: true }, isis, { pair: "aligned" }).strength, "weak", "an ordinary meaning is not a borrowing");
  assert.deepEqual(borrowingStrength(daimon, isis, { pair: "printed" }).reasons, ["in-book", "glossary"]);
  assert.deepEqual(borrowingStrength(daimon, isis, { glossaryPair: true }).reasons, ["in-book", "glossary"], "the older option still works");
});

test("an aligned pair's word binds only a glossary in the original's language", () => {
  const word = originalWordOf(daimon, isis, { forms: ["daimón"], pairReads: new Map([["blavatsky_isis", 134]]) });
  const study = { senses: [{ ...daimon, originalWord: word, borrowing: { strength: "strong" } }] };
  assert.deepEqual(requiredOriginalWords(study, "en-GB").map((w) => w.term), ["demon"]);
  for (const code of ["vi", "fr", "zh-Hant", "pt-BR"]) assert.deepEqual(requiredOriginalWords(study, code), [], code);
  const levi = { ...isis, originalLanguage: "fr", originalBookId: "levi_dogma_ritual", termPairs: [{ source: "Adepto", original: "adepte", basis: "aligned" }] };
  const french = originalWordOf({ ...daimon, originalTerm: "adepte" }, levi, { pairReads: new Map([["levi_dogma_ritual", 9]]) });
  const frenchStudy = { senses: [{ ...daimon, originalWord: french }] };
  assert.deepEqual(requiredOriginalWords(frenchStudy, "fr").map((w) => w.term), ["adepte"]);
  assert.deepEqual(requiredOriginalWords(frenchStudy, "en"), []);
});

test("the pair facts say where each pair comes from", () => {
  const base = { site: "Samael Aun Weor", author: "Samael Aun Weor" };
  assert.equal(
    pairFact({ ...base, shortTitle: "Dioses Atómicos (La aurora de la juventud)", record: dayspring, term: "íntimo", pairs: [{ original: "Innermost", basis: "printed" }], occurrences: 189, searched: ["Innermost"] }),
    "The Samael Aun Weor search site lists Dioses Atómicos (La aurora de la juventud) among the books Samael Aun Weor read: the Spanish translation of The Dayspring of Youth (written in English; the author signs only “M.”). Both editions end with a glossary; matched entry by entry, they pair “íntimo” with “Innermost”, which the English original uses 189 times.",
  );
  assert.equal(
    pairFact({ ...base, shortTitle: "Isis sin velo", record: isis, term: "daimón", pairs: isis.termPairs, occurrences: 134, searched: ["demon", "daimonion", "demons"] }),
    "The Samael Aun Weor search site lists Isis sin velo among the books Samael Aun Weor read: the Spanish translation of Isis Unveiled, written in English by H. P. Blavatsky. The site compared the Spanish translation with the English original passage by passage: an AI matched the words, and a program then confirmed that each English word appears in the matching English passages. It pairs “daimón” with “demon” and “daimonion”, which the English original uses 134 times (counting “demons”).",
  );
  const kundalini = { ...isis, title: "Kundalini Yoga — Sivananda", originalTitle: "Kundalini Yoga", originalAuthor: "Sivananda" };
  assert.match(
    pairFact({ ...base, shortTitle: "Kundalini Yoga", record: kundalini, term: "kundalini", pairs: [{ original: "Kundalini", status: "passthrough", basis: "aligned" }], occurrences: 300, searched: ["Kundalini"] }),
    /passages\. The Spanish translation keeps the English original's word: “Kundalini”, used 300 times\.$/,
  );
  // A kept word spelled differently in the original names that spelling; one use reads "once".
  assert.match(
    pairFact({ ...base, shortTitle: "Isis sin velo", record: isis, term: "Akasha", pairs: [{ original: "akasa", status: "passthrough", basis: "aligned" }], occurrences: 1, searched: ["akasa"] }),
    /passages\. The Spanish translation keeps the English original's word; the English original spells it “akasa” and uses it once\.$/,
  );
  const levi = { ...isis, originalLanguage: "fr", originalTitle: null, originalAuthor: "Eliphas Levi" };
  assert.match(
    pairFact({ ...base, shortTitle: "Dogma y ritual de la alta magia", record: levi, term: "adepto", pairs: [{ original: "adepte", basis: "aligned" }], occurrences: 12, searched: ["adepte", "adeptes"] }),
    /the Spanish translation of Dogma y ritual de la alta magia, written in French by Eliphas Levi\. The site compared the Spanish translation with the French original .*each French word appears in the matching French passages\. It pairs “adepto” with “adepte”, which the French original uses 12 times \(counting “adeptes”\)\.$/,
  );
  assert.equal(languageNameOf("de"), "German");
  assert.equal(languageNameOf(null), "");
});
