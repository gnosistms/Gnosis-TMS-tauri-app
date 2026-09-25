import test from "node:test";
import assert from "node:assert/strict";

import {
  accentCounterparts,
  createResearchEngine,
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

function fakeModel({ failFirstCounting = false } = {}) {
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
        out = { senses: [{ sense: "the Fatal (noun)", candidates: [{ target: "the Fateful One", recommended: true, note: "noun", rationale: "original term" }] }] };
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

function engine({ model = fakeModel(), store = memoryStore(), limit = 4, items = passages(40), log = () => {}, corpus = fakeCorpus(items) } = {}) {
  return {
    model, store, corpus,
    engine: createResearchEngine({
      model, prices: PRICES, corpus, dictionary, store, log,
      settings: {
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
