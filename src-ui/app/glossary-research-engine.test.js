import test from "node:test";
import assert from "node:assert/strict";

import {
  accentCounterparts,
  createResearchEngine,
  failedVariants,
  familyGroups,
  looksLike,
  pickRepresentative,
  transferAccents,
  unmeasuredRenderings,
  validateProposal,
} from "./glossary-research-engine.js";
import { quotationMarksFor, usesGuillemets } from "./glossary-research-prompts.js";
import {
  createBudget,
  modelPrices,
  usageCost,
  worstCaseCost,
} from "./glossary-research-budget.js";
import { buildOccurrences, sentenceBounds } from "./glossary-research-occurrences.js";
import { coOccurrence, sharedRenderings } from "./glossary-research-convergence.js";

const PRICES = modelPrices("claude", "claude-opus-5-5");

function passages(count) {
  const items = [];
  for (let i = 0; i < count; i += 1) {
    const text = i % 5 === 0
      ? `Frase ${i}. La rueda fatal gira sin fin.`
      : i % 7 === 0
        ? `Frase ${i}. Fueron errores fatales para todos.`
        : `Frase ${i}. Fue un resultado fatal para todos.`;
    const surface = text.includes("fatales") ? "fatales" : "fatal";
    const start = text.indexOf(surface);
    items.push({
      itemId: `p${String(i).padStart(3, "0")}`, text,
      occurrences: [{ start, end: start + surface.length, surface }],
      contextBefore: [], contextAfter: [],
      reference: { title: "Libro", chapter: "I", paragraph: i },
    });
  }
  return items;
}

function fakeCorpus(items, pairs = [{ source: "Fatal", original: "Fateful One" }]) {
  return {
    description: "test texts",
    async formsHint() {
      return { forms: [{ form: "fatal", rows: 20 }, { form: "fatales", rows: 3 }], related: [{ form: "fatalmente", rows: 2 }] };
    },
    async countForm(form) {
      const hits = items.filter((i) => i.occurrences.some((o) => o.surface === form));
      return { rows: hits.length, examples: hits.slice(0, 2).map((i) => ({ text: i.text, start: i.occurrences[0].start, end: i.occurrences[0].end })) };
    },
    async population(forms) {
      const hits = items.filter((i) => i.occurrences.some((o) => forms.includes(o.surface)));
      return { rows: hits.length, distinct: hits.length, duplicateGroups: 0 };
    },
    async sample(forms, n) {
      return { meta: { corpusVersion: "t" }, items: items.filter((i) => i.occurrences.some((o) => forms.includes(o.surface))).slice(0, n) };
    },
    async collocations() {
      return [{ phrase: "rueda fatal", occurrences: 6, paragraphs: 6 }];
    },
    authorName: "the author",
    async sourceBooks() {
      return [{ title: "Libro fuente — M.", translated: true, originalLanguage: "en", originalTitle: "The Source Book", originalAuthor: "M.", originalFirstPrinting: "1933", firstSpanishTranslation: "1950", headwordPairs: pairs, originalBookId: "fuente", originalAccess: "passages_only" }];
    },
    originalSearches: [],
    async originalSample(bookId, forms) {
      this.originalSearches.push({ bookId, forms });
      return { paragraphs: 1, occurrences: 1, items: [{ itemId: "en.p1", text: `The ${forms[0]} guides us.`, occurrences: [{ start: 4, end: 4 + forms[0].length, surface: forms[0] }] }] };
    },
    async sourceUsage() {
      return [0, 1, 2].map((i) => ({
        itemId: `s${i}`, text: `El Fatal nos guía ${i}.`, occurrences: [{ start: 3, end: 8, surface: "Fatal" }],
        reference: { title: "Libro fuente — M." },
      }));
    },
    async authorMentions(phrase) {
      return [{ itemId: "m1", text: `Como dice ${phrase}, el Fatal guía.`, occurrences: [{ start: 10, end: 10 + phrase.length, surface: phrase }], reference: { title: "Obra del autor" } }];
    },
  };
}

const dictionary = {
  async lookup() {
    return { status: "found", sourceName: "DLE", senseCount: 6, complexFormCount: 2, text: "1. adj. inevitable.\n2. adj. Desgraciado, infeliz.", tried: ["DLE"] };
  },
};

const PROPOSAL = {
  partOfSpeech: "adj.",
  entries: [
    { id: "e1", kind: "word", sourceTerms: ["fatal"], generalNote: "note", populationOccurrencesCited: 0, rationale: "r",
      variants: [
        { id: "e1v1", target: "disastrous", note: "results", senses: ["2"], corpusSense: null, fromExisting: false, rationale: "r" },
        { id: "e1v2", target: "fateful", note: "destiny", senses: ["4"], corpusSense: null, fromExisting: true, rationale: "r" },
      ] },
    { id: "e2", kind: "word", sourceTerms: ["fatales"], generalNote: "plural", populationOccurrencesCited: 0, rationale: "r",
      variants: [{ id: "e2v1", target: "disastrous", note: "plural nouns", senses: ["2"], corpusSense: null, fromExisting: false, rationale: "r" }] },
    { id: "e3", kind: "expression", sourceTerms: ["rueda fatal"], generalNote: "wheel", populationOccurrencesCited: 6, rationale: "r",
      variants: [{ id: "e3v1", target: "wheel of fate", note: "Samsara", senses: [], corpusSense: null, fromExisting: false, rationale: "r" }] },
  ],
  rejectedExpressions: [], derivativeStudies: [{ source: "fatalmente", reason: "adverb" }],
  leftOutRenderings: [],
  sensesOutsideDictionary: [], openQuestions: [],
};

function fakeModel({ failFirstCounting = false, relation = "same" } = {}) {
  const calls = [];
  let countingCalls = 0;
  return {
    calls,
    async call(request, onDelta) {
      calls.push(request.stage);
      onDelta("thinking", "considering…");
      const ids = [...request.content.matchAll(/\[([do]\d{3}\.\d+)\]/g)].map((m) => m[1]);
      const unique = [...new Set(ids)];
      let out;
      if (request.schemaName === "forms") {
        out = { forms: [{ form: "fatal", kind: "inflection", confidence: "high" }, { form: "fatales", kind: "inflection", confidence: "high" }, { form: "fatalmente", kind: "inflection", confidence: "low" }] };
      } else if (request.schemaName === "forms_confirm") {
        out = { forms: [{ form: "fatal", keep: true, reason: "ok" }, { form: "fatales", keep: true, reason: "ok" }, { form: "fatalmente", keep: false, reason: "derived adverb" }] };
      } else if (request.stage === "discovery") {
        out = { items: unique.map((occId) => ({ occId, sense: "2", corpusSense: null, rendering: "disastrous", phraseTranslation: "a disastrous result", expressionCandidate: null, reason: "fake" })) };
      } else if (request.schemaName === "original_check") {
        out = { confirmed: true, originalTerm: null, basis: "the original uses it the same way", meaningInOriginal: "a guide" };
      } else if (request.stage === "sources") {
        out = { summary: "From the source book.", senses: [{ sense: "the Fatal (noun)", inDictionary: false, sourceBook: "Libro fuente — M.", evidence: "named by the author", originalLanguage: "en", originalTerm: "Fateful One", originalTermBasis: "the book's glossary pairs", meaningInSource: "a guide", authorUsage: "follows it", equivalences: [] }] };
      } else if (request.stage === "candidates") {
        out = { senses: [{ senseId: "s1", sense: "the Fatal (noun)", groups: [{ members: ["the Fateful One"], recommended: true, note: "noun", rationale: "original term" }] }] };
      } else if (request.stage === "family") {
        out = { words: [{ form: "fatalmente", kind: "suffixed", reason: "adverb" }, { form: "sobrefatal", kind: "prefixed", reason: "test" }] };
      } else if (request.stage === "parts") {
        out = { isCompound: false, parts: [{ part: "fatal", meaning: "inevitable" }], senses: [{ id: "s1", gloss: "inevitable", usedByAuthor: true }, { id: "s2", gloss: "deadly", usedByAuthor: false }], bases: [] };
      } else if (request.stage === "checks") {
        out = { candidates: [{ n: 1, target: "the Fateful One", words: [{ word: "Fateful", neededSense: "ruled by fate", lookalike: false, resembles: null, otherSenses: [] }, { word: "One", neededSense: "a being", lookalike: false, resembles: null, otherSenses: [] }], establishedUsage: true, establishedBasis: "the original book" }] };
      } else if (request.stage === "frequency") {
        const n = [...request.content.matchAll(/^(\d+)\. /gm)].length;
        out = { items: Array.from({ length: n }, (_, i) => ({ n: i + 1, sense: i % 4 === 0 ? "other" : "needed" })) };
      } else if (request.stage === "convergence") {
        out = { pairs: [...request.content.matchAll(/^\[(\d+)\](.*)$/gm)].map((m) => ({ n: Number(m[1]), relation: typeof relation === "function" ? relation(m[2]) : relation, evidence: "knowledge", reason: "test" })) };
      } else if (request.stage === "footnotes") {
        out = { items: [] };
      } else if (request.stage === "comparison") {
        out = { items: [{ existing: "fateful", verdict: "proposed", proposedVariantId: "e1v2", reason: "same" }] };
      } else if (request.stage === "proposal") {
        out = PROPOSAL;
      } else if (request.stage === "counting") {
        countingCalls += 1;
        if (failFirstCounting && countingCalls === 1) {
          return { status: "failed", message: "HTTP 529", retryable: true, billedUnknown: false };
        }
        out = { items: unique.map((occId) => {
          const wheel = request.content.includes(`${occId}: use entry [e3]`) || request.content.includes(`${occId}: use expression entry [e3]`);
          const plural = request.content.includes(`${occId}: use entry [e2]`);
          const variantId = wheel ? "e3v1" : plural ? "e2v1" : occId.endsWith("1.1") ? "e1v2" : "e1v1";
          const wording = wheel ? "wheel of fate" : variantId === "e1v2" ? "fateful" : "disastrous";
          return { occId, sentenceTranslation: `It was a ${wording} thing.`, chosenWording: wording, status: "selected", variantId, otherRendering: null, unresolvedReason: null, fit: "good", note: "" };
        }) };
      } else if (request.stage === "summary") {
        out = { summary: "Sumario.", recommendations: ["x"], unresolvedExplanation: "" };
      } else {
        throw new Error(request.stage);
      }
      const text = JSON.stringify(out);
      return { status: "ok", text, usage: { inputTokens: 3000, cachedTokens: 2000, cacheWriteTokens: 0, outputTokens: 400, reasoningTokens: 100 } };
    },
  };
}

function memoryStore(initial = {}) {
  const data = { ...initial };
  return { data, load: (name) => data[name], save: (name, value) => { data[name] = value; } };
}

function engine({ model = fakeModel(), store = memoryStore(), limit = 4, items = passages(40), log = () => {}, corpus = fakeCorpus(items), judges = 1, languageData = null, glossaryTerms = [], chooseFamily = undefined } = {}) {
  return {
    model, store, corpus,
    engine: createResearchEngine({
      model, prices: PRICES, corpus, dictionary, store, log, languageData, glossaryTerms, chooseFamily,
      settings: {
        judges, sourceLanguageCode: "es",
        term: "fatal", variants: [], existingEntries: [{ sourceTerms: ["fatal"], targetTerms: ["fateful"], targetVariantNotes: [""], notesToTranslators: "" }],
        sourceLanguageName: "Spanish", targetLanguageName: "English", targetLanguageCode: "en", reportLanguageName: "English",
        sampleSize: 20, discoverySize: 10, spendingLimitUsd: limit, seed: "s", workers: 3,
      },
    }),
  };
}

test("research pauses for review, then counts and reconciles every occurrence", async () => {
  const logs = [];
  const { engine: research, model, store } = engine({ log: (event) => logs.push(event) });
  const review = await research.runToReview();
  assert.equal(review.status, "review");
  assert.equal(model.calls.filter((stage) => stage === "counting").length, 0, "nothing is counted before review");
  assert.deepEqual(store.data.forms.confirmed, ["fatal", "fatales"]);
  const sample = store.data.sample;
  assert.equal(sample.measuredIds.filter((id) => sample.discoveryIds.includes(id)).length, 0);

  const done = await research.runCounting(review.proposal);
  assert.equal(done.status, "done");
  const { entries, totals } = done.aggregate;
  assert.equal(totals.occurrencesSampled, 20);
  assert.equal(entries.e3.occurrences, 4, "rueda fatal occurrences go to the expression entry");
  assert.equal(entries.e2.occurrences, 2, "plural forms go to their own entry");
  const all = Object.values(entries).reduce((sum, entry) => sum
    + Object.values(entry.variants).reduce((s, v) => s + v.occurrences, 0) + entry.other + entry.failed + entry.notRun
    + Object.values(entry.unresolved).reduce((s, v) => s + v, 0), 0);
  assert.equal(all, 20);
  assert.ok(logs.some((event) => event.type === "heading" && event.text === "Counting"));
  assert.ok(logs.some((event) => event.type === "thinking"));
});

test("the proposal is made without the glossary, from the source study and the candidate study", async () => {
  const requests = [];
  const model = fakeModel();
  const call = model.call;
  model.call = (request, onDelta) => {
    requests.push(request);
    return call(request, onDelta);
  };
  const { engine: research, store } = engine({ model });
  const review = await research.runToReview();
  const byStage = Object.fromEntries(requests.map((r) => [r.stage, r]));
  assert.match(byStage.sources.content, /The Source Book/);
  assert.match(byStage.sources.content, /Fatal = Fateful One/);
  assert.match(byStage.sources.content, /Como dice ⟦Libro fuente⟧/);
  assert.match(byStage.candidates.content, /Fateful One/, "the candidate study sees the source study");
  assert.match(byStage.proposal.content, /the Fateful One/, "the proposal sees the candidate study");
  assert.doesNotMatch(byStage.proposal.content, /Existing glossary/);
  assert.equal(byStage.comparison.stage, "comparison", "the existing entry is compared afterwards");
  assert.equal(review.proposal.existingComparison[0].proposed, "fateful");
  assert.equal(review.proposal.entries[0].variants.find((v) => v.target === "fateful").fromExisting, true);
  assert.equal(store.data.sources.topBooks[0], "Libro fuente — M.");
  assert.match(byStage.sources.content, /The original text of The Source Book: 1 occurrences of “Fateful One”/, "the glossary pair is read in the original text");
  assert.equal(requests.filter((r) => r.schemaName === "original_check").length, 0, "no check needed when the pair names the word");
});

test("a believed original word is checked against the original text", async () => {
  const requests = [];
  const model = fakeModel();
  const call = model.call;
  model.call = (request, onDelta) => {
    requests.push(request);
    return call(request, onDelta);
  };
  const corpus = fakeCorpus(passages(40), []);
  const { engine: research, store } = engine({ model, corpus });
  await research.runToReview();
  assert.deepEqual(corpus.originalSearches, [{ bookId: "fuente", forms: ["Fateful One"] }]);
  const check = requests.find((r) => r.schemaName === "original_check");
  assert.match(check.content, /The ⟦Fateful One⟧ guides us/);
  const sense = store.data.sources.study.senses[0];
  assert.match(sense.originalTermBasis, /checked in the original text/);
  assert.equal(sense.meaningInOriginal, "a guide");
});

test("an edited proposal gets a new version and earlier counts are not reused", async () => {
  const { engine: research } = engine();
  const review = await research.runToReview();
  const first = await research.runCounting(review.proposal);
  const edited = structuredClone(review.proposal);
  edited.entries[0].variants[0].note = "edited";
  const second = await research.runCounting(edited);
  assert.notEqual(first.frozen.version, second.frozen.version);
});

test("the spending limit stops work before a request that could exceed it", async () => {
  const { engine: research, store } = engine({ limit: 0.05 });
  await assert.rejects(research.runToReview(), (error) => error.kind === "budget" || /could cost up to/.test(error.message));
  assert.ok(research.budget.spent <= 0.05 + 1e-9);
  assert.ok(Array.isArray(store.data.usage));
});

test("retryable failures are retried; finished stages are reused on resume", async () => {
  const model = fakeModel({ failFirstCounting: true });
  const { engine: research, store } = engine({ model });
  const review = await research.runToReview();
  const done = await research.runCounting(review.proposal);
  assert.equal(done.aggregate.totals.outcomes.failed ?? 0, 0);
  const again = engine({ store });
  const resumed = await again.engine.runToReview();
  assert.equal(again.model.calls.length, 0, "no model call is repeated on resume");
  assert.equal(resumed.status, "review");
});

test("proposal validation catches forms in two entries and forms in none", () => {
  const broken = structuredClone(PROPOSAL);
  broken.entries[1].sourceTerms = ["fatal"];
  assert.match(validateProposal(broken, ["fatal", "fatales"]).join(" "), /in entries e1 and e2/);
  assert.match(validateProposal(broken, ["fatal", "fatales"]).join(" "), /forms in no entry: fatales/);
});

test("budget arithmetic uses cache read and write rates", () => {
  const cost = usageCost(PRICES, { inputTokens: 10000, cachedTokens: 6000, cacheWriteTokens: 2000, outputTokens: 1000 });
  assert.equal(cost.toFixed(6), ((2000 * 4 + 6000 * 0.2 + 2000 * 5 + 1000 * 20) / 1e6).toFixed(6));
  const budget = createBudget(0.01);
  const need = worstCaseCost(PRICES, "x".repeat(100), "y", 1000);
  assert.ok(!budget.fitsAtAll(need));
});

test("sentences and expression spans", () => {
  const text = "Así gira la Rueda Fatal del Samsara. Es un resultado fatal y funesto.";
  const i = text.indexOf("Fatal");
  const j = text.indexOf("fatal");
  const occurrences = buildOccurrences([{ itemId: "a", text, occurrences: [
    { start: i, end: i + 5, surface: "Fatal" }, { start: j, end: j + 5, surface: "fatal" }] }],
  [{ id: "x", kind: "expression", sourceTerms: ["rueda fatal"], match: ["rueda fatal"], variants: [] },
    { id: "w", kind: "word", sourceTerms: ["fatal"], variants: [] }]);
  assert.deepEqual(occurrences.map((o) => o.entryId), ["x", "w"]);
  assert.equal(occurrences[0].marked, "Rueda Fatal");
  const [s, e] = sentenceBounds(text, j, j + 5);
  assert.equal(text.slice(s, e), "Es un resultado fatal y funesto.");
});

test("forms differing only in capitals are merged, keeping the lowercase spelling", async () => {
  const { mergeCaseVariants } = await import("./glossary-research-engine.js");
  const merged = mergeCaseVariants(
    ["Íntimo", "íntimo", "ÍNTIMO", "Intimo", "intimo", "íntimas"].map((form) => ({ form })),
    (item) => item.form,
  ).map((item) => item.form);
  assert.deepEqual(merged, ["íntimo", "intimo", "íntimas"]);
});

test("accented and unaccented spellings are both searched", () => {
  assert.equal(transferAccents("Íntimo", "intimas"), "íntimas");
  assert.equal(transferAccents("Íntimo", "INTIMOS"), "ÍNTIMOS");
  const found = accentCounterparts(["Íntimo", "intima", "intimos", "intimas"]).map((f) => f.toLowerCase()).sort();
  assert.deepEqual(found, ["intimo", "íntima", "íntimas", "íntimos"]);
});

test("frequent readings must be measured or explained; case variants in one entry are not duplicates", () => {
  const proposal = structuredClone(PROPOSAL);
  const discovery = { readings: { a: { rendering: "Chân ngã" }, b: { rendering: "chân ngã" }, c: { rendering: "disastrous" }, d: { rendering: "once" } } };
  assert.deepEqual(unmeasuredRenderings(proposal, discovery), ["“Chân ngã” (2 readings) is neither measured nor explained"]);
  proposal.leftOutRenderings = [{ rendering: "chân ngã", count: 2, reason: "synonym" }];
  assert.deepEqual(unmeasuredRenderings(proposal, discovery), []);
  proposal.entries[0].sourceTerms = ["Fatal", "fatal"];
  assert.doesNotMatch(validateProposal(proposal, ["fatal", "fatales"]).join(" "), /in entries e1 and e1/);
});

test("quotation marks follow the target language", () => {
  assert.equal(quotationMarksFor("vi"), "“…”");
  assert.equal(usesGuillemets("vi"), false);
  assert.equal(usesGuillemets("en-US"), false);
  assert.equal(usesGuillemets("fr"), true);
});

test("a resumed run that already has a proposal does not run the new studies", async () => {
  const store = memoryStore({ proposal: structuredClone(PROPOSAL) });
  const { engine: research, model } = engine({ store });
  await research.runToReview();
  assert.ok(!model.calls.includes("sources"));
  assert.ok(!model.calls.includes("candidates"));
});

// --- frequency checks and two judges ---------------------------------------------

function fakeLanguageData({ available = true } = {}) {
  const asked = [];
  return {
    asked,
    async ensure(code) {
      asked.push(code);
      return available ? { available: true, corpus: `${code}_news`, sentences: 1000 } : { available: false };
    },
    async zipf(code, words) {
      return words.map(() => 3.2);
    },
    async sentences(code, forms) {
      return { hits: 60, corpusTokens: 1e6, corpus: `${code}_news`, sample: Array.from({ length: 40 }, (_, i) => `Sentence ${i} with ${forms[0]}.`) };
    },
  };
}

/** A model whose candidate list contains a look-alike that general English never uses in the needed sense. */
function lookalikeModel() {
  const base = fakeModel();
  return {
    calls: base.calls,
    async call(request, onDelta) {
      if (request.stage === "candidates") {
        base.calls.push(request.stage);
        return { status: "ok", text: JSON.stringify({ senses: [{ senseId: "s1", sense: "inevitable", groups: [
          { members: ["fateful"], recommended: true, note: "n", rationale: "r" },
          { members: ["fatal"], recommended: false, note: "n", rationale: "r" },
        ] }] }), usage: { inputTokens: 10, outputTokens: 10 } };
      }
      if (request.stage === "checks") {
        base.calls.push(request.stage);
        const numbers = Object.fromEntries([...request.content.matchAll(/^(\d+)\. (\S+) —/gm)].map((m) => [m[2], Number(m[1])]));
        return { status: "ok", text: JSON.stringify({ candidates: [
          { n: numbers.fatal, target: "fatal", words: [{ word: "fatal", neededSense: "inevitable", lookalike: true, resembles: "fatal", otherSenses: ["deadly"] }], establishedUsage: false, establishedBasis: "" },
          { n: numbers.fateful, target: "fateful", words: [{ word: "fateful", neededSense: "decided by fate", lookalike: false, resembles: null, otherSenses: [] }], establishedUsage: false, establishedBasis: "" },
        ] }), usage: { inputTokens: 10, outputTokens: 10 } };
      }
      if (request.stage === "frequency") {
        base.calls.push(request.stage);
        const n = [...request.content.matchAll(/^(\d+)\. /gm)].length;
        const english = request.instructions.includes("ordinary English text");
        return { status: "ok", text: JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ n: i + 1, sense: english ? "o1" : "s1" })) }), usage: { inputTokens: 10, outputTokens: 10 } };
      }
      if (request.stage === "proposal") {
        base.calls.push(request.stage);
        const proposal = structuredClone(PROPOSAL);
        proposal.entries[0].variants.push({ id: "e1v3", target: "fatal", note: "n", senses: ["1"], corpusSense: null, fromExisting: false, rationale: "r" });
        return { status: "ok", text: JSON.stringify(proposal), usage: { inputTokens: 10, outputTokens: 10 } };
      }
      return base.call(request, onDelta);
    },
  };
}

test("a look-alike never used in the needed sense fails its check and is removed from the proposal", async () => {
  const logs = [];
  const languageData = fakeLanguageData();
  const { engine: research, store } = engine({ model: lookalikeModel(), languageData, log: (event) => logs.push(event) });
  const review = await research.runToReview();
  const checks = store.data.checks;
  const fatal = checks.candidates.find((c) => c.target === "fatal");
  assert.equal(fatal.verdict, "fail");
  assert.match(fatal.reasons[0], /0 of 40 sentences/);
  assert.equal(checks.candidates.find((c) => c.target === "fateful").verdict, "pass");
  assert.deepEqual(checks.failedWords, ["fatal"]);
  assert.ok(!review.proposal.entries[0].variants.some((v) => v.target === "fatal"), "the failed rendering is not counted");
  assert.equal(review.proposal.removedByChecks[0].target, "fatal");
  assert.deepEqual([...new Set(languageData.asked)], ["es", "en"]);
  assert.ok(store.data.parts.source.term.senses.s1.zipf > 0, "the source sense is measured");
});

test("without data for a language the research tells whom to ask and goes on without scores", async () => {
  const logs = [];
  const { engine: research, store } = engine({ languageData: fakeLanguageData({ available: false }), log: (event) => logs.push(event) });
  const review = await research.runToReview();
  assert.equal(review.status, "review");
  assert.ok(logs.some((event) => event.type === "problem" && event.text.includes("gnosistms@gmail.com")));
  assert.equal(store.data.parts.source, null);
  assert.ok(store.data.checks.candidates.every((c) => c.verdict === "unchecked"));
});

test("two judges vote on every occurrence and their agreement is reported", async () => {
  const { engine: research, model } = engine({ judges: 2 });
  const review = await research.runToReview();
  const done = await research.runCounting(review.proposal);
  const { totals, entries } = done.aggregate;
  assert.equal(totals.occurrencesSampled, 20);
  assert.equal(totals.votes, 40);
  assert.equal(totals.judges, 2);
  assert.equal(totals.agreement.compared, 20);
  const votes = Object.values(entries).reduce((sum, e) => sum + e.occurrences, 0);
  assert.equal(votes, 40);
  assert.ok(model.calls.filter((stage) => stage === "counting").length >= 2);
});

test("failedVariants finds failed candidates and coinages built on a failed word", () => {
  const proposal = { entries: [{ id: "e1", variants: [
    { id: "a", target: "superword" }, { id: "b", target: "plain terms" }, { id: "c", target: "the word" },
  ] }] };
  const found = failedVariants(proposal, { failedWords: ["word"], failedTargets: [] });
  assert.deepEqual(found.map((f) => f.variantId), ["a", "c"]);
  assert.deepEqual(failedVariants(proposal, null), []);
});

test("a group is represented by the member whose score fits the source sense", () => {
  const scores = { terrible: 4.7, awful: 4.5, dreadful: 3.6, atrocious: 3.1 };
  const pick = (target) => pickRepresentative(["atrocious", "dreadful", "awful", "terrible"], (m) => scores[m], target);
  assert.equal(pick(3.5), "dreadful", "closest, not below by more than half a point");
  assert.equal(pick(4.68), "terrible");
  assert.equal(pick(null), "terrible", "no source score: the best-known member");
  assert.equal(pick(6), "terrible", "nothing close: the best-known member");
});

test("looksLike flags renderings that share the start of a source word", () => {
  assert.ok(looksLike("fateful", ["fatal"]));
  assert.ok(looksLike("supersensible", ["suprasensible", "sensible"]));
  assert.ok(!looksLike("deadly", ["fatal"]));
  assert.ok(!looksLike("unseen worlds", ["suprasensible"]));
});

test("a calque built on a base word of the source term has that base measured", async () => {
  const base = lookalikeModel();
  const model = {
    calls: base.calls,
    async call(request, onDelta) {
      if (request.stage === "parts") {
        return { status: "ok", text: JSON.stringify({ isCompound: true, parts: [{ part: "sobre", meaning: "above" }, { part: "fatal", meaning: "fated" }], senses: [{ id: "s1", gloss: "beyond fate", usedByAuthor: true }], bases: [{ word: "fatal", forms: ["fatal"], neededSense: "decided by fate", otherSenses: ["deadly"] }] }), usage: { inputTokens: 10, outputTokens: 10 } };
      }
      if (request.stage === "candidates") {
        return { status: "ok", text: JSON.stringify({ senses: [{ senseId: "s1", sense: "beyond fate", groups: [{ members: ["superfatal"], recommended: true, note: "n", rationale: "r" }] }] }), usage: { inputTokens: 10, outputTokens: 10 } };
      }
      if (request.stage === "checks") {
        const n = Number(/^(\d+)\. superfatal/m.exec(request.content)[1]);
        return { status: "ok", text: JSON.stringify({ candidates: [{ n, target: "superfatal", words: [{ word: "superfatal", neededSense: "beyond fate", lookalike: true, resembles: "sobrefatal", otherSenses: [] }], establishedUsage: false, establishedBasis: "" }] }), usage: { inputTokens: 10, outputTokens: 10 } };
      }
      if (request.stage === "frequency") {
        const n = [...request.content.matchAll(/^(\d+)\. /gm)].length;
        const english = request.instructions.includes("ordinary English text");
        return { status: "ok", text: JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ n: i + 1, sense: english ? "o1" : (request.instructions.includes('"needed"') ? "needed" : "s1") })) }), usage: { inputTokens: 10, outputTokens: 10 } };
      }
      return base.call(request, onDelta);
    },
  };
  const { engine: research, store } = engine({ model, languageData: fakeLanguageData() });
  await research.runToReview();
  const check = store.data.checks.candidates.find((c) => c.target === "superfatal");
  assert.ok(check.words.some((w) => w.word === "fatal" && w.measure), "the base word is measured");
  assert.equal(check.verdict, "fail");
  assert.ok(store.data.checks.failedWords.includes("fatal"));
});

test("family members are grouped by word; prefixed words are suggested for study", () => {
  const groups = familyGroups([
    { form: "fatalmente", kind: "suffixed", rows: 4 },
    { form: "sobrefatal", kind: "prefixed", rows: 3 },
    { form: "sobrefatales", kind: "prefixed", rows: 2, of: "sobrefatal" },
  ]);
  assert.deepEqual(groups.map((g) => [g.form, g.forms, g.rows, g.suggested]), [
    ["sobrefatal", ["sobrefatal", "sobrefatales"], 5, true],
    ["fatalmente", ["fatalmente"], 4, false],
  ]);
});

test("co-occurrence counts passages and sentences; a word inside a longer phrase counts as the phrase", () => {
  const items = [
    { text: "El mundo sensible es ilusorio. Lo suprasensible es real." },
    { text: "Lo sensible y lo suprasensible se unen aquí." },
    { text: "Solo lo suprasensible." },
  ];
  assert.equal(coOccurrence(items, ["suprasensible"], ["sensible"], "es").passages, 2);
  const phrase = coOccurrence(items, ["suprasensible"], ["mundo sensible"], "es");
  assert.equal(phrase.passages, 1);
  assert.equal(phrase.sameSentence, 0);
  const same = coOccurrence(items, ["sensible"], ["suprasensible"], "es");
  assert.equal(same.sameSentence, 1);
  assert.equal(coOccurrence(items, ["sensible"], ["mundo sensible"], "es").passages, 0, "“sensible” inside “mundo sensible” is the phrase, not the word");
});

test("shared renderings are found within the proposal and against other entries", () => {
  const pairs = sharedRenderings(PROPOSAL, [{ sourceTerms: ["funesto"], targetTerms: ["Fateful"], origin: "glossary" }]);
  assert.deepEqual(pairs.map((p) => [p.target, p.otherSourceTerms[0], p.origin]), [
    ["disastrous", "fatales", "proposal"],
    ["fateful", "funesto", "glossary"],
  ]);
});

test("a rendering shared with a word of different meaning is taken out of the proposal", async () => {
  const logs = [];
  const { engine: research, model, store } = engine({
    model: fakeModel({ relation: (line) => (line.includes("fateful") ? "different" : "same") }), log: (event) => logs.push(event),
    glossaryTerms: [{ sourceTerms: ["funesto"], targetTerms: ["fateful"] }],
  });
  const review = await research.runToReview();
  assert.equal(model.calls.filter((stage) => stage === "proposal").length, 2, "the proposal is revised once");
  assert.ok(store.data.convergence.conflicts.some((pair) => pair.target === "fateful"));
  const e1 = review.proposal.entries.find((e) => e.id === "e1");
  assert.ok(!e1.variants.some((v) => v.target === "fateful"));
  assert.ok(logs.some((event) => event.type === "problem" && /funesto/.test(event.text)));
});

test("words meaning the same may share a rendering, even in one sentence", async () => {
  const { engine: research, model, store } = engine({
    glossaryTerms: [{ sourceTerms: ["funesto"], targetTerms: ["fateful"] }],
  });
  const review = await research.runToReview();
  assert.equal(model.calls.filter((stage) => stage === "proposal").length, 1);
  assert.equal(store.data.convergence.conflicts.length, 0);
  assert.ok(review.proposal.entries.find((e) => e.id === "e1").variants.some((v) => v.target === "fateful"));
});

test("the person chooses the related words to research next", async () => {
  let offered = null;
  const base = fakeCorpus(passages(40));
  const { engine: research } = engine({
    corpus: { ...base, countForm: async (form) => (form === "sobrefatal" ? { rows: 3, examples: [] } : base.countForm(form)) },
    chooseFamily: async ({ groups }) => {
      offered = groups;
      return groups.filter((g) => g.suggested).map(({ form, forms }) => ({ form, forms }));
    },
  });
  const review = await research.runToReview();
  assert.ok(offered.length >= 1);
  assert.deepEqual(review.familyWords, offered.filter((g) => g.suggested).map(({ form, forms }) => ({ form, forms })));
});
