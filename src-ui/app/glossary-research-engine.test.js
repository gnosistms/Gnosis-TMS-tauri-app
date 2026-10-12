import test from "node:test";
import assert from "node:assert/strict";

import {
  accentCounterparts,
  createModelClient,
  createResearchEngine,
  collectMeasurements,
  failedVariants,
  scoreRendering,
  joinListedUnits,
  scoreWords,
  textKey,
  familyGroups,
  writtenForm,
  familyStems,
  addPassedCandidates,
  retestConsistency,
  SKIPPABLE_STEPS,
  mergeMeasurements,
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
      } else if (request.schemaName === "original_note") {
        out = { note: "The traditional English term for this meaning, from The Source Book." };
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

function engine({ model = fakeModel(), store = memoryStore(), limit = 4, items = passages(40), log = () => {}, corpus = fakeCorpus(items), judges = 1, languageData = null, glossaryTerms = [], chooseFamily = undefined, extraSettings = {}, dictionary: dict = dictionary } = {}) {
  return {
    model, store, corpus,
    engine: createResearchEngine({
      model, prices: PRICES, corpus, dictionary: dict, store, log, languageData, glossaryTerms, chooseFamily,
      settings: {
        judges, sourceLanguageCode: "es",
        term: "fatal", variants: [], existingEntries: [{ sourceTerms: ["fatal"], targetTerms: ["fateful"], targetVariantNotes: [""], notesToTranslators: "" }],
        sourceLanguageName: "Spanish", targetLanguageName: "English", targetLanguageCode: "en", reportLanguageName: "English",
        sampleSize: 20, discoverySize: 10, spendingLimitUsd: limit, seed: "s", workers: 3,
        ...extraSettings,
      },
    }),
  };
}

test("research pauses for review, then counts and reconciles every occurrence", async () => {
  const logs = [];
  const { engine: research, model, store } = engine({ log: (event) => logs.push(event) });
  const review = await research.runToReview();
  const headings = logs.filter((event) => event.type === "heading").map((event) => event.text);
  if (headings.includes("Candidate checks")) {
    // Measuring how common the candidates are is its own step, when it can be measured.
    assert.ok(!headings.includes("Candidate frequency") || headings.indexOf("Candidate frequency") === headings.indexOf("Candidate checks") + 1);
  }
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
  assert.match(byStage.proposal.content, /Fateful One: [A-Z]+ \(ORIGINAL WORD/, "the proposal sees the candidate study, with the original word marked");
  assert.doesNotMatch(byStage.proposal.content, /Existing glossary/);
  assert.equal(byStage.comparison.stage, "comparison", "the existing entry is compared afterwards");
  assert.equal(review.proposal.existingComparison[0].proposed, "fateful");
  assert.equal(review.proposal.entries[0].variants.find((v) => v.target === "fateful").fromExisting, true);
  assert.equal(store.data.sources.topBooks[0], "Libro fuente — M.");
  assert.match(byStage.sources.content, /The original text of The Source Book: 1 occurrences of “Fateful One”/, "the glossary pair is read in the original text");
  assert.equal(requests.filter((r) => r.schemaName === "original_check").length, 0, "no check needed when the pair names the word");
});

test("a pair from the site's comparison with the original is read in the original and named as such", async () => {
  const requests = [];
  const logs = [];
  const model = fakeModel();
  const call = model.call;
  model.call = (request, onDelta) => {
    requests.push(request);
    return call(request, onDelta);
  };
  const corpus = fakeCorpus(passages(40), []);
  corpus.originalTerms = async (forms) => {
    corpus.pairRequests = forms;
    return [{ docId: null, title: "Libro fuente — M.", originalLanguage: "en", originalTitle: "The Source Book", originalAuthor: "M.", source: "Fatal", original: "Fateful One", also: [], originalForms: ["Fateful One", "Fateful Ones"], renderings: [{ form: "Fateful Ones", count: 2 }], originalCount: 3, status: "equivalent_found", basis: "aligned" }];
  };
  const { engine: research, store } = engine({ model, corpus, log: (event) => logs.push(event) });
  await research.runToReview();
  assert.deepEqual(corpus.pairRequests, ["fatal", "fatales"]);
  assert.deepEqual(corpus.originalSearches, [{ bookId: "fuente", forms: ["Fateful One", "Fateful Ones"] }]);
  const sources = requests.find((r) => r.stage === "sources" && r.schemaName === "sources");
  assert.match(sources.content, /by the search site's comparison of this translation with its original .*: Fatal = Fateful One \(the original uses Fateful Ones 2 times\)/);
  assert.equal(requests.filter((r) => r.schemaName === "original_check").length, 0, "no check needed when the pair names the word");
  const facts = logs.filter((event) => event.type === "fact").map((event) => event.text);
  assert.ok(facts.includes("The the author search site lists Libro fuente among the books the author read: the Spanish translation of The Source Book (written in English; the author signs only “M.”). The site compared the Spanish translation with the English original passage by passage: an AI matched the words, and a program then confirmed that each English word appears in the matching English passages. It pairs “fatal” with “Fateful One”, which the English original uses once (counting “Fateful Ones”)."), facts.join("\n"));
  const sense = store.data.sources.study.senses[0];
  assert.equal(sense.originalWord.pairBasis, "aligned");
  assert.deepEqual(sense.borrowing.reasons, ["aligned"]);
});

test("a site without the pairs endpoint still reads the book's own glossary pairs", async () => {
  const corpus = fakeCorpus(passages(40));
  corpus.originalTerms = async () => null;
  const { engine: research, store } = engine({ corpus });
  await research.runToReview();
  assert.deepEqual(corpus.originalSearches, [{ bookId: "fuente", forms: ["Fateful One"] }]);
  assert.equal(store.data.sources.study.senses[0].originalWord.pairBasis, "printed");
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

test("a paused research starts no new request until it continues, and a cancel while paused stops it", async () => {
  let paused = true;
  let release = null;
  let cancelled = false;
  const calls = [];
  const client = createModelClient({
    model: { call: async (request) => { calls.push(request.stage); return { status: "ok", text: "{}", usage: { inputTokens: 1, outputTokens: 1 } }; } },
    prices: { input: 1, cached: 0.1, cacheWrite: 1, output: 1 },
    budget: createBudget(10),
    log: () => {},
    isCancelled: () => cancelled,
    maxRetries: 0,
    waitWhilePaused: async () => {
      while (paused) await new Promise((resolve) => { release = resolve; });
    },
  });
  const request = { stage: "forms", instructions: "i", content: "c", maxOutputTokens: 10 };
  const first = client.callJson(request);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(calls, []);
  paused = false;
  release();
  assert.deepEqual(await first, {});
  assert.deepEqual(calls, ["forms"]);

  paused = true;
  const second = client.callJson({ ...request });
  await new Promise((resolve) => setTimeout(resolve, 10));
  cancelled = true;
  paused = false;
  release();
  await assert.rejects(second, (error) => error.kind === "cancelled");
  assert.deepEqual(calls, ["forms"]);
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
        // General English never uses "fatal" in the needed sense; other words are used in theirs.
        const sense = !english ? "s1" : / with fatal\./.test(request.content) ? "o1" : "needed";
        return { status: "ok", text: JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ n: i + 1, sense })) }), usage: { inputTokens: 10, outputTokens: 10 } };
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

test("words that only begin like the term are checked, not taken as related words", async () => {
  const base = fakeCorpus(passages(40));
  const rows = { fatalitos: 2, fatalmente: 2, "fatales1": 1, sobrefatal: 3, sobrefatales: 1, sobrefatalidad: 2 };
  const corpus = {
    ...base,
    async formsHint(term) {
      if (term === "sobrefatal") return { forms: [], related: [{ form: "sobrefatales", rows: 1 }, { form: "sobrefatalidad", rows: 2 }] };
      return { forms: [{ form: "fatal", rows: 20 }, { form: "fatales", rows: 3 }], related: [{ form: "fatalmente", rows: 2 }, { form: "fatales1", rows: 1 }, { form: "fatalitos", rows: 2 }] };
    },
    async countForm(form) {
      return rows[form] ? { rows: rows[form], examples: [{ text: `Un ${form} aquí.`, start: 3, end: 3 + form.length }] } : base.countForm(form);
    },
  };
  const inner = fakeModel();
  const requests = [];
  const answer = (out) => ({ status: "ok", text: JSON.stringify(out), usage: { inputTokens: 10, outputTokens: 10 } });
  const model = {
    calls: inner.calls,
    async call(request, onDelta) {
      requests.push(request);
      if (request.schemaName === "forms_confirm") {
        inner.calls.push(request.stage);
        return answer({ forms: [
          { form: "fatal", keep: true, reason: "ok" }, { form: "fatales", keep: true, reason: "ok" },
          { form: "fatalitos", keep: true, reason: "a form" }, { form: "fatalmente", keep: false, reason: "an adverb made from it" },
        ] });
      }
      if (request.schemaName === "family") {
        inner.calls.push(request.stage);
        return answer({ words: [], suggested: [{ form: "sobrefatal", kind: "prefixed", reason: "test" }] });
      }
      if (request.schemaName === "family_forms") {
        inner.calls.push(request.stage);
        return answer({ forms: [{ form: "sobrefatales", keep: true, reason: "plural" }, { form: "sobrefatalidad", keep: false, reason: "another word" }] });
      }
      return inner.call(request, onDelta);
    },
  };
  const { engine: research, store } = engine({ model, corpus });
  await research.runToReview();
  const confirm = requests.find((request) => request.schemaName === "forms_confirm");
  assert.match(confirm.content, /“fatalitos” \(a word of the texts that begins with the same letters\)/);
  assert.doesNotMatch(confirm.content, /fatales1/, "a word with a footnote number attached is not a word");
  assert.ok(store.data.forms.confirmed.includes("fatalitos"), "a form found among the words that begin alike joins the study");
  assert.deepEqual(store.data.forms.related.map((f) => f.form), ["fatalmente"], "the rest go to the word family");
  const family = requests.find((request) => request.schemaName === "family");
  assert.match(family.content, /begin with the headword's letters \(paragraphs\): fatalmente \(2\)$/m);
  assert.deepEqual(store.data.family.members.map((m) => m.form).sort(), ["sobrefatal", "sobrefatales"],
    "only words the AI lists are related words; a form the check rejects is left out");
});

test("a look-alike absent from the general corpus does not use up a measurement", async () => {
  const base = lookalikeModel();
  const model = {
    calls: base.calls,
    async call(request, onDelta) {
      const answer = await base.call(request, onDelta);
      if (request.stage !== "checks") return answer;
      const parsed = JSON.parse(answer.text);
      const fatal = parsed.candidates.find((c) => c.target === "fatal");
      fatal.words.unshift({ word: "fatales", neededSense: "inevitable", lookalike: true, resembles: "fatales", otherSenses: [] });
      return { ...answer, text: JSON.stringify(parsed) };
    },
  };
  const data = fakeLanguageData();
  const sentences = data.sentences;
  data.sentences = async (code, forms, ...rest) => (code === "en" && forms[0] === "fatales"
    ? { hits: 0, corpusTokens: 1e6, corpus: "en_news", sample: [] }
    : sentences(code, forms, ...rest));
  const { engine: research, store } = engine({ model, languageData: data, extraSettings: { maxSenseChecks: 1 } });
  await research.runToReview();
  const fatal = store.data.checks.candidates.find((c) => c.target === "fatal");
  assert.equal(fatal.verdict, "fail", "“fatal” is still measured after the absent word");
});

test("a word failing in one sense but passing in another is not banned from other renderings", async () => {
  const base = lookalikeModel();
  const model = {
    calls: base.calls,
    async call(request, onDelta) {
      if (request.stage === "candidates") {
        base.calls.push(request.stage);
        return { status: "ok", text: JSON.stringify({ senses: [
          { senseId: "s1", sense: "inevitable", groups: [{ members: ["fatal"], recommended: true, note: "n", rationale: "r" }, { members: ["fateful"], recommended: true, note: "n", rationale: "r" }] },
          { senseId: "s2", sense: "deadly", groups: [{ members: ["fatal blow"], recommended: true, note: "n", rationale: "r" }] },
        ] }), usage: { inputTokens: 10, outputTokens: 10 } };
      }
      if (request.stage === "checks") {
        base.calls.push(request.stage);
        const numbers = [...request.content.matchAll(/^(\d+)\. (.+?) — /gm)].map((m) => [Number(m[1]), m[2]]);
        return { status: "ok", text: JSON.stringify({ candidates: numbers.map(([n, target]) => ({
          n, target, establishedUsage: false, establishedBasis: "",
          words: target === "fateful" ? [{ word: "fateful", neededSense: "decided by fate", lookalike: false, resembles: null, otherSenses: [] }]
            : [{ word: "fatal", neededSense: target === "fatal" ? "inevitable" : "causing death", lookalike: true, resembles: "fatal", otherSenses: ["deadly"] }],
        })) }), usage: { inputTokens: 10, outputTokens: 10 } };
      }
      if (request.stage === "frequency" && request.instructions.includes("ordinary English text")) {
        base.calls.push(request.stage);
        const n = [...request.content.matchAll(/^(\d+)\. /gm)].length;
        const sense = request.instructions.includes("inevitable") ? "o1" : "needed";
        return { status: "ok", text: JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ n: i + 1, sense })) }), usage: { inputTokens: 10, outputTokens: 10 } };
      }
      return base.call(request, onDelta);
    },
  };
  const { engine: research, store } = engine({ model, languageData: fakeLanguageData() });
  await research.runToReview();
  const checks = store.data.checks;
  assert.equal(checks.candidates.find((c) => c.target === "fatal").verdict, "fail");
  assert.equal(checks.candidates.find((c) => c.target === "fatal blow").verdict, "pass");
  assert.deepEqual(checks.failedWords, []);
  assert.deepEqual(checks.failedTargets, ["fatal"]);
});

test("a rendering that fails for one sense but passes for another is not removed", async () => {
  const base = lookalikeModel();
  const model = {
    calls: base.calls,
    async call(request, onDelta) {
      if (request.stage === "candidates") {
        base.calls.push(request.stage);
        return { status: "ok", text: JSON.stringify({ senses: [
          { senseId: "s1", sense: "inevitable", groups: [{ members: ["fatal"], recommended: true, note: "n", rationale: "r" }] },
          { senseId: "s2", sense: "deadly", groups: [{ members: ["fatal"], recommended: true, note: "n", rationale: "r" }] },
        ] }), usage: { inputTokens: 10, outputTokens: 10 } };
      }
      if (request.stage === "checks") {
        base.calls.push(request.stage);
        const numbers = [...request.content.matchAll(/^(\d+)\. (.+?) — (.+)$/gm)].map((m) => [Number(m[1]), m[2], m[3]]);
        return { status: "ok", text: JSON.stringify({ candidates: numbers.map(([n, target, sense]) => ({
          n, target, establishedUsage: false, establishedBasis: "",
          words: [{ word: "fatal", partOf: null, forms: [], neededSense: sense === "deadly" ? "causing death" : "inevitable", lookalike: true, resembles: "fatal", otherSenses: ["deadly"] }],
        })) }), usage: { inputTokens: 10, outputTokens: 10 } };
      }
      if (request.stage === "frequency" && request.instructions.includes("ordinary English text")) {
        base.calls.push(request.stage);
        const n = [...request.content.matchAll(/^(\d+)\. /gm)].length;
        const sense = request.instructions.includes("causing death") ? "needed" : "o1";
        return { status: "ok", text: JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ n: i + 1, sense })) }), usage: { inputTokens: 10, outputTokens: 10 } };
      }
      return base.call(request, onDelta);
    },
  };
  const { engine: research, store } = engine({ model, languageData: fakeLanguageData() });
  await research.runToReview();
  // The fake source study's original word ("Fateful One") is added and checked too.
  const verdicts = store.data.checks.candidates.filter((c) => !c.original).map((c) => [c.senseId, c.verdict]);
  assert.deepEqual(verdicts, [["s1", "fail"], ["s2", "pass"]]);
  assert.deepEqual(store.data.checks.failedTargets, []);
});

test("a run's measurements are collected for later runs, one per word and sense", () => {
  const needed = { zipf: 3.9, upperBound: null, share: 0.3, inSense: 30, classified: 100 };
  const stages = {
    parts: { source: { bases: [{ word: "sensible", neededSense: "perceptible", measure: { wordZipf: 4.5, hits: 900, classified: 100, instances: 100, notWord: 0 }, needed }] } },
    checks: { candidates: [
      { words: [{ word: "sensitive", neededSense: "responsive", lookalike: true, zipf: 4.4, measure: { hits: 500, classified: 100, instances: 100, notWord: 0, needed } }] },
      { words: [{ word: "sensitive", neededSense: "Responsive", lookalike: true, zipf: 4.4, measure: { hits: 500, classified: 100, instances: 100, notWord: 0, needed } }] },
      { words: [{ word: "perception", neededSense: "x", lookalike: false, zipf: 4.1, measure: null }] },
    ] },
  };
  const found = collectMeasurements(stages, "es", "en");
  assert.deepEqual(found.map((m) => [m.language, m.word, m.sense]), [["es", "sensible", "perceptible"], ["en", "sensitive", "responsive"]]);
  assert.equal(mergeMeasurements(found, [{ ...found[1], wordZipf: 0 }, { language: "en", word: "sensory", sense: "of the senses", needed }]).length, 3);
});

test("a related word reuses earlier measurements of the same word in the same sense", async () => {
  const base = lookalikeModel();
  let englishFrequencyCalls = 0;
  const model = {
    calls: base.calls,
    async call(request, onDelta) {
      if (request.stage === "frequency" && request.instructions.includes("ordinary English text") && / with fatal\./.test(request.content)) englishFrequencyCalls += 1;
      const answer = await base.call(request, onDelta);
      if (request.stage !== "checks") return answer;
      const parsed = JSON.parse(answer.text);
      for (const c of parsed.candidates) for (const w of c.words) w.reuse = w.word === "fatal" ? "m1" : null;
      return { ...answer, text: JSON.stringify(parsed) };
    },
  };
  const prior = { language: "en", word: "fatal", sense: "inevitable", wordZipf: 3.2, needed: { zipf: null, upperBound: 1.9, share: 0, inSense: 0, classified: 40 }, hits: 60, classified: 40, instances: 40, notWord: 0 };
  const { engine: research, store } = engine({
    model, items: passages(3), languageData: fakeLanguageData(),
    extraSettings: {
      familyBatch: true, familyHeadword: "fatalismo",
      siblingEntries: [{ sourceTerms: ["fatalismo"], targetTerms: ["fatalism"], notes: [""] }],
      priorMeasurements: [prior],
    },
  });
  await research.runToReview();
  assert.equal(englishFrequencyCalls, 0, "the look-alike was measured in an earlier run");
  const fatal = store.data.checks.candidates.find((c) => c.target === "fatal");
  assert.equal(fatal.verdict, "fail");
  assert.equal(fatal.words[0].measure.reused, true);
});

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);

function listData(table, corpus = {}) {
  const asked = { list: [], corpus: [] };
  return {
    asked,
    async zipf(code, words) {
      asked.list.push(...words);
      return words.map((w) => table[w] ?? 0);
    },
    async corpusZipf(code, phrases) {
      asked.corpus.push(...phrases);
      return phrases.map((phrase) => ({ phrase, hits: corpus[phrase] ? 10 : 0, zipf: corpus[phrase] ?? 0 }));
    },
  };
}

test("target words are looked up with their accents and tone marks", async () => {
  assert.equal(textKey("Phù Phiếm"), "phù phiếm");
  assert.notEqual(textKey("phù"), textKey("phụ"));
  const data = listData({ "phù phiếm": 2.98, "phu phiem": 0 });
  const scores = await scoreWords(data, "vi", [{ word: "phù phiếm" }]);
  near(scores.get("phù phiếm"), 2.98);
  assert.deepEqual(data.asked.corpus, [], "found in the list: no corpus count");
});

test("a word's surface forms are added up", async () => {
  const data = listData({ "غرور": 3.36, "الغرور": 3.63, "والغرور": 2.93 });
  const scores = await scoreWords(data, "ar", [{ word: "غرور", forms: ["الغرور", "والغرور"] }]);
  assert.ok(scores.get("غرور") > 3.63, "together more common than any one form");
});

test("a word the list does not hold is counted whole in the corpus, never split", async () => {
  const data = listData({ "爱慕": 3.5, "虚荣": 3.33 }, { "爱慕虚荣": 1.9 });
  const scores = await scoreWords(data, "zh", [{ word: "爱慕虚荣" }]);
  near(scores.get("爱慕虚荣"), 1.9);
  assert.deepEqual(data.asked.corpus, ["爱慕虚荣"]);
});

test("Persian joiners are dropped as in the data, and a spaced compound is also tried joined", async () => {
  assert.equal(textKey("خود\u200cپسندی", "fa"), "خودپسندی");
  const data = listData({ "خودپسندی": 1.91 });
  const scores = await scoreWords(data, "fa", [{ word: "خود پسندی" }]);
  near(scores.get("خود پسندی"), 1.91);
});

test("Thai words are always counted in the corpus", async () => {
  const data = listData({ "ความหยิ่ง": 4.0 }, { "ความหยิ่ง": 2.2 });
  const scores = await scoreWords(data, "th", [{ word: "ความหยิ่ง" }]);
  near(scores.get("ความหยิ่ง"), 2.2);
  assert.deepEqual(data.asked.list, []);
});

test("a rendering scores as its rarest own word; parts and syllables do not count", () => {
  const scoreOf = new Map([["phù phiếm", 2.98], ["phiếm", 0.4], ["thói", 3.9], ["ham", 3.1], ["ngưỡng mộ", 4.5]]);
  assert.equal(scoreRendering("vi", "phù phiếm", scoreOf, [{ word: "phù phiếm" }, { word: "phiếm", partOf: "phù phiếm" }]), 2.98);
  assert.equal(scoreRendering("vi", "thói ham ngưỡng mộ", scoreOf, [{ word: "thói" }, { word: "ham" }, { word: "ngưỡng mộ" }]), 3.1);
  assert.equal(scoreRendering("vi", "phù phiếm", new Map([["phù phiếm", 0], ["phiếm", 2]])), 0, "never split into syllables");
  assert.equal(scoreRendering("en", "beyond the senses", new Map([["beyond the senses", 0], ["beyond", 4.6], ["senses", 3.9]])), 3.9);
});

test("neighbouring words the frequency list holds as one unit are scored as that unit", async () => {
  const list = new Map([["khoe của", 1.98], ["hư vinh", 2.28], ["khoe", 4.84], ["của", 7.12], ["ham", 3.93], ["thích", 5.2]]);
  const languageData = { zipf: async (_code, forms) => forms.map((form) => list.get(form) ?? 0) };
  const candidates = [
    { n: 1, target: "khoe của", words: [{ word: "khoe", partOf: null }, { word: "của", partOf: null }] },
    { n: 2, target: "ham hư vinh", words: [{ word: "ham", partOf: null }, { word: "hư vinh", partOf: null }] },
    { n: 3, target: "thích khoe", words: [{ word: "thích", partOf: null }, { word: "khoe", partOf: null }] },
  ];
  await joinListedUnits(languageData, "vi", candidates);
  const scoreOf = new Map([...list].map(([k, v]) => [k, v]));
  assert.equal(scoreRendering("vi", "khoe của", scoreOf, candidates[0].words), 1.98);
  assert.deepEqual(candidates[0].words.filter((w) => w.partOf).map((w) => w.word), ["khoe", "của"]);
  // A free combination of ordinary words keeps its words: the rarest one scores it.
  assert.equal(scoreRendering("vi", "ham hư vinh", scoreOf, candidates[1].words), 2.28);
  assert.equal(scoreRendering("vi", "thích khoe", scoreOf, candidates[2].words), 4.84);
});

test("the word that sets a passing translation's score is sorted by meaning and judged on that meaning", async () => {
  const base = lookalikeModel();
  let sortedFateful = 0;
  const model = {
    calls: base.calls,
    async call(request, onDelta) {
      if (request.stage === "frequency" && request.instructions.includes("ordinary English text") && / with fateful\./.test(request.content)) {
        sortedFateful += 1;
        const n = [...request.content.matchAll(/^(\d+)\. /gm)].length;
        // General English uses "fateful" only in other meanings.
        return { status: "ok", text: JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ n: i + 1, sense: "other" })) }), usage: { inputTokens: 10, outputTokens: 10 } };
      }
      return base.call(request, onDelta);
    },
  };
  const { engine: research, store } = engine({ model, languageData: fakeLanguageData() });
  await research.runToReview();
  const fateful = store.data.checks.candidates.find((c) => c.target === "fateful");
  assert.equal(sortedFateful, 1, "the deciding word is sorted once");
  assert.equal(fateful.verdict, "fail");
  assert.match(fateful.reasons.join(" "), /never used in everyday English in the meaning needed/);
  assert.ok(fateful.words[0].measure?.needed, "the report can show the meaning's score");
});

test("every request that writes for the reader carries the plain-writing rule, once", async () => {
  const requests = [];
  const model = fakeModel();
  const call = model.call;
  model.call = (request, onDelta) => {
    requests.push(request);
    return call(request, onDelta);
  };
  const { engine: research } = engine({ model });
  await research.runToReview();
  const writing = requests.filter((r) => r.stage !== "frequency");
  assert.ok(writing.length > 5);
  for (const request of writing) {
    assert.equal(request.instructions.split("WRITING.").length - 1, 1, `${request.stage}: the rule once`);
  }
  assert.match(writing[0].instructions, /not "substantive"/, "English reports get the everyday grammar words");
  assert.ok(requests.filter((r) => r.stage === "frequency").every((r) => !r.instructions.includes("WRITING.")));
});

test("the origin study sees where the author names a book next to the term, and his earliest dated uses", async () => {
  const requests = [];
  const model = fakeModel();
  const call = model.call;
  model.call = (request, onDelta) => {
    requests.push(request);
    return call(request, onDelta);
  };
  const corpus = fakeCorpus(passages(40));
  corpus.authorName = "Samael Aun Weor";
  corpus.authorCitations = async (phrases, forms) => [{ itemId: "c1", text: `Como dice Libro fuente, el ${forms[0]} guía.`, occurrences: [{ start: 26, end: 26 + forms[0].length }], reference: { title: "EL FALSO SENTIMIENTO DEL YO" } }];
  corpus.earliestUses = async (forms) => [{ itemId: "e1", year: 1950, text: `El ${forms[0]} primero.`, occurrences: [{ start: 3, end: 3 + forms[0].length }], reference: { title: "LA REVOLUCIÓN DE BEL" } }];
  const { engine: research, store } = engine({ model, corpus });
  await research.runToReview();
  const sources = requests.find((request) => request.stage === "sources" && /which are ordinary/.test(request.purpose));
  assert.match(sources.content, /## Where the author names those books next to the term[\s\S]*Como dice Libro fuente/);
  assert.match(sources.content, /## The author's earliest dated uses of the term \(year: work\)[\s\S]*\[1950: LA REVOLUCIÓN DE BEL\]/);
  const sense = store.data.sources.study.senses[0];
  assert.ok(sense.borrowing, "the borrowing is judged for a sense from a source book");
});

test("the origin request says what the AI adds when a book's glossary already gave the word", async () => {
  const { sourcesPurpose } = await import("./glossary-research-engine.js");
  assert.equal(sourcesPurpose("Samael Aun Weor", "íntimo", ["Dioses Atómicos"]), "check which of Samael Aun Weor's meanings of “íntimo” come from Dioses Atómicos and which are ordinary");
  assert.match(sourcesPurpose("Samael Aun Weor", "íntimo", []), /^study how Samael Aun Weor uses “íntimo”: which of the meanings are ordinary/);
});

test("the studies name the term as the texts write it, not as it was typed", async () => {
  const occ = (text, surface) => ({ text, occurrences: [{ start: text.indexOf(surface), end: text.indexOf(surface) + surface.length, surface }] });
  const items = [occ("Íntimo es el Ser.", "Íntimo"), occ("Un amigo íntimo vino.", "íntimo"), occ("Lo más íntimo.", "íntimo"), occ("Unirse con el Íntimo.", "Íntimo")];
  assert.equal(writtenForm("Íntimo", items), "íntimo", "a capital at the start of a sentence does not count");
  assert.equal(writtenForm("samael", [occ("Dijo Samael.", "Samael")]), "Samael");
  assert.equal(writtenForm("Íntimo", []), "Íntimo", "no passages: the typed term");
  assert.equal(writtenForm("Íntimo", [occ("el Íntimo", "Íntimo"), occ("lo íntimo", "íntimo")]), "Íntimo", "a tie keeps the typed term");

  const base = fakeCorpus(passages(40));
  const corpus = { ...base, async sample(forms, n, seed) {
    const found = await base.sample(forms.map((f) => f.toLowerCase()), n, seed);
    return found;
  } };
  const inner = fakeModel();
  const seen = [];
  const model = { calls: inner.calls, async call(request, onDelta) { seen.push(request); return inner.call(request, onDelta); } };
  const { engine: research, store } = engine({ model, corpus, extraSettings: { term: "Fatal" } });
  await research.runToReview();
  assert.equal(store.data.forms.headword, "fatal");
  const parts = seen.find((request) => request.stage === "parts");
  assert.match(parts.content, /^# Term: fatal$/m);
  assert.doesNotMatch(seen.map((request) => `${request.instructions}\n${request.content}`).join("\n"), /“Fatal”/);
});

test("the books the author read are searched for the term's other spellings there, judged by the AI", async () => {
  const base = fakeCorpus(passages(40));
  const searched = [];
  const example = (form) => ({ title: "Libro fuente — M.", text: `Habla del ${form} aquí.`, start: 10, end: 10 + form.length });
  const corpus = {
    ...base,
    async nearForms() {
      return [
        { form: "Fatall", near: "fatal", rows: 2, books: [{ title: "Libro fuente — M.", rows: 2 }], examples: [example("Fatall")] },
        { form: "fetal", near: "fatal", rows: 5, books: [{ title: "Otro libro", rows: 5 }], examples: [example("fetal")] },
        { form: "fatales", near: "fatal", rows: 3, books: [], examples: [] },
      ];
    },
    async sourceUsage(forms, seed) {
      searched.push(forms);
      return base.sourceUsage(forms, seed);
    },
  };
  const inner = fakeModel();
  const requests = [];
  const model = {
    calls: inner.calls,
    async call(request, onDelta) {
      requests.push(request);
      if (request.schemaName === "near_forms") {
        inner.calls.push(request.stage);
        return { status: "ok", text: JSON.stringify({ forms: [{ form: "Fatall", keep: true, reason: "a misprint" }, { form: "fetal", keep: false, reason: "another word" }] }), usage: { inputTokens: 10, outputTokens: 10 } };
      }
      return inner.call(request, onDelta);
    },
  };
  const logs = [];
  const { engine: research, store } = engine({ model, corpus, log: (event) => logs.push(event) });
  await research.runToReview();
  const check = requests.find((request) => request.schemaName === "near_forms");
  assert.match(check.content, /“Fatall” \(near “fatal”\): 2 passages\n   \[Libro fuente — M\.\] Habla del ⟦Fatall⟧ aquí/);
  assert.doesNotMatch(check.content, /fatales/, "a spelling already searched is not checked again");
  assert.deepEqual(searched[0], ["fatal", "fatales", "Fatall"]);
  assert.ok(logs.some((event) => event.type === "fact" && event.text === "Searched too, as other spellings of “fatal” in the books the author read: “Fatall” (2 passages, in Libro fuente)."));
  assert.match(requests.find((request) => request.schemaName === "sources").content, /Also searched in the reference books, which spell it differently: Fatall/);
  assert.equal(store.data.sources.spellings, undefined, "the study keeps its own record");
});

test("the origin step saves how many books use the term, the counts, and the citations", async () => {
  const logs = [];
  const base = fakeCorpus(passages(40));
  const corpus = { ...base, async authorCitations() { return [{ itemId: "c1", text: "Libro fuente dice: el Fatal.", occurrences: [{ start: 0, end: 5, surface: "Libro" }], reference: { title: "Obra" } }]; } };
  const { engine: research } = engine({ corpus, log: (event) => logs.push(event) });
  await research.runToReview();
  const counts = logs.find((event) => event.type === "result" && event.kind === "bookCounts").data[0];
  assert.equal(counts.term, "fatal");
  assert.equal(counts.held, 1);
  assert.equal(counts.using, 1);
  assert.deepEqual(counts.books, [{ title: "Libro fuente — M.", occurrences: 3, passages: 3 }]);
  assert.deepEqual(counts.citations, [{ title: "Libro fuente — M.", passages: 1 }]);
  const senses = logs.filter((event) => event.type === "result" && event.kind === "senses").flatMap((event) => event.data);
  assert.ok(senses.every((sense) => "why" in sense && "strength" in sense));
});

test("when no book the author read uses the term, the step says how many books were searched", async () => {
  const base = fakeCorpus(passages(40));
  const corpus = { ...base, async sourceUsage() { return []; }, async sourceBooks() { return [{ title: "A" }, { title: "B" }]; } };
  const logs = [];
  const { engine: research } = engine({ corpus, log: (event) => logs.push(event) });
  await research.runToReview();
  assert.ok(logs.some((event) => event.type === "fact" && event.text === "None of the 2 books the search site holds of those the author read uses “fatal”."));
});

test("the word family starts from the texts' own words containing the stem, sorted by the AI", async () => {
  assert.deepEqual(familyStems(["mundo", "mundos"]), ["mund"]);
  assert.deepEqual(familyStems(["íntimo", "íntima", "intimo", "intimas"]), ["íntim", "intim"]);
  assert.deepEqual(familyStems(["sensible", "sensibles"]), ["sensib"]);
  assert.deepEqual(familyStems(["fe", "fes"]), [], "a stem under 4 letters matches too many words");

  const base = fakeCorpus(passages(40));
  const rows = { celestial: 4, inmundo: 0, fatalismo: 3 };
  const corpus = {
    ...base,
    stemsAsked: null,
    async stemWords(stems) {
      this.stemsAsked = stems;
      return [{ form: "fatalidad", rows: 9 }, { form: "fatalidades", rows: 2 }, { form: "fatalismo", rows: 3 }, { form: "rafatalo", rows: 1 }, { form: "fatal21", rows: 1 }];
    },
    async countForm(form) {
      return form in rows ? { rows: rows[form], examples: [{ text: `Un ${form} aquí.`, start: 3, end: 3 + form.length }] } : base.countForm(form);
    },
  };
  const inner = fakeModel();
  const requests = [];
  const answer = (out) => ({ status: "ok", text: JSON.stringify(out), usage: { inputTokens: 10, outputTokens: 10 } });
  const model = {
    calls: inner.calls,
    async call(request, onDelta) {
      requests.push(request);
      if (request.schemaName === "family") {
        inner.calls.push(request.stage);
        return answer({
          words: [
            { form: "fatalidad", kind: "suffixed", of: null, verdict: "related", reason: "noun" },
            { form: "fatalidades", kind: "suffixed", of: "fatalidad", verdict: "related", reason: "plural" },
            { form: "fatalismo", kind: "suffixed", of: null, verdict: "unsure", reason: "may be" },
          ],
          suggested: [{ form: "celestial", kind: "suffixed", reason: "changed stem" }, { form: "inmundo", kind: "prefixed", reason: "x" }],
        });
      }
      if (request.schemaName === "family_check") {
        inner.calls.push(request.stage);
        return answer({ forms: [{ form: "fatalismo", keep: true, reason: "built on it" }] });
      }
      return inner.call(request, onDelta);
    },
  };
  const { engine: research, store } = engine({ model, corpus });
  await research.runToReview();
  assert.deepEqual(corpus.stemsAsked, ["fatal"]);
  const family = requests.find((request) => request.schemaName === "family");
  assert.match(family.content, /contain “fatal” \(paragraphs\): fatalidad \(9\), fatalidades \(2\), fatalismo \(3\), rafatalo \(1\)$/m);
  assert.doesNotMatch(family.content, /fatal21/, "a word with a footnote number is not a word");
  assert.match(family.instructions, /stem is changed/);
  const check = requests.find((request) => request.schemaName === "family_check");
  assert.match(check.content, /^“fatalismo”: 3 passages\n   Un ⟦fatalismo⟧ aquí\./m, "only the unsure word is read in an example");
  const members = Object.fromEntries(store.data.family.members.map((m) => [m.form, m]));
  assert.deepEqual(Object.keys(members).sort(), ["celestial", "fatalidad", "fatalidades", "fatalismo"]);
  assert.equal(members.fatalidad.rows, 9, "listed words keep the list's count");
  assert.equal(members.fatalidades.of, "fatalidad");
  assert.ok(!members.inmundo, "a suggestion not in the texts is dropped");
});

test("measuring how common the candidates are is its own step, right after checking them", async () => {
  const logs = [];
  const { engine: research } = engine({ model: lookalikeModel(), languageData: fakeLanguageData(), log: (event) => logs.push(event) });
  await research.runToReview();
  const headings = logs.filter((event) => event.type === "heading").map((event) => event.text);
  assert.equal(headings[headings.indexOf("Candidate checks") + 1], "Candidate frequency");
  const at = (predicate) => logs.findIndex(predicate);
  const frequencyHeading = at((event) => event.type === "heading" && event.text === "Candidate frequency");
  assert.ok(at((event) => event.type === "request" && event.stage === "checks") < frequencyHeading, "the analysis belongs to the check");
  assert.ok(logs.slice(frequencyHeading).some((event) => event.type === "result" && event.kind === "checks"), "the verdicts belong to the measuring step");
});

test("every candidate is checked and reaches the vote; a group member is never hidden behind another", async () => {
  const inner = fakeModel();
  const requests = [];
  const answer = (out) => ({ status: "ok", text: JSON.stringify(out), usage: { inputTokens: 10, outputTokens: 10 } });
  const many = Array.from({ length: 44 }, (_, i) => `rendering ${i + 1}`);
  const model = {
    calls: inner.calls,
    async call(request, onDelta) {
      requests.push(request);
      if (request.stage === "candidates") {
        inner.calls.push(request.stage);
        return answer({ senses: [
          { senseId: "s1", sense: "Earth or another planet.", groups: [{ members: ["world", "planet", "plan-et"], recommended: true, note: "For a planet. Also for Earth.", rationale: "r" }] },
          { senseId: "s2", sense: "Many things.", groups: [{ members: many, recommended: false, note: "n", rationale: "r" }] },
        ] });
      }
      if (request.stage === "checks") {
        inner.calls.push(request.stage);
        const numbers = [...request.content.matchAll(/^(\d+)\. (.+?) — /gm)].map((m) => [Number(m[1]), m[2]]);
        return answer({ candidates: numbers.map(([n, target]) => ({ n, target, establishedUsage: false, establishedBasis: "", words: [{ word: target, neededSense: "x", lookalike: false, resembles: null, otherSenses: [] }] })) });
      }
      return inner.call(request, onDelta);
    },
  };
  const logs = [];
  const { engine: research, store } = engine({ model, log: (event) => logs.push(event) });
  const review = await research.runToReview();
  const checks = requests.filter((request) => request.stage === "checks");
  assert.equal(checks.length, 2, "46 candidates are checked in two parts of at most 40");
  const checked = checks.flatMap((request) => [...request.content.matchAll(/^\d+\. (.+?) — /gm)].map((m) => m[1]));
  assert.ok(checked.includes("world") && checked.includes("planet"), "both members of the group are checked");
  assert.ok(!checked.includes("plan-et"), "the same wording spelled with a hyphen is checked once");
  // 46 candidates, plus the required original word of the test's source book, placed in its sense.
  assert.deepEqual(store.data.checks.candidates.map((c) => c.target).filter((t) => !/^rendering /.test(t)).sort(), ["Fateful One", "planet", "world"].sort());
  const targets = review.proposal.entries.flatMap((entry) => entry.variants.map((variant) => variant.target));
  assert.ok(targets.includes("planet") && targets.includes("world"), "every passed candidate reaches the vote");
  assert.ok(logs.some((event) => event.type === "fact" && /Added to the translators' choice because they passed the checks: .*“planet”/.test(event.text)));
});

test("passed candidates are added to the word entries; failed ones, original-word senses and expressions are not", () => {
  const proposal = { entries: [
    { id: "e1", kind: "word", sourceTerms: ["mundo"], variants: [{ id: "e1v1", target: "world", note: "Default.", senses: ["s1"] }] },
    { id: "e2", kind: "word", sourceTerms: ["mundos"], variants: [{ id: "e2v1", target: "worlds", note: "Default.", senses: ["s1"] }] },
    { id: "e3", kind: "expression", sourceTerms: ["venir al mundo"], variants: [{ id: "e3v1", target: "be born", note: "", senses: [] }] },
  ], leftOutRenderings: [{ rendering: "planet", count: 0, reason: "near-synonym" }] };
  const checks = { candidates: [
    { target: "World", senseId: "s2", sense: "Earth.", verdict: "pass" },
    { target: "planet", senseId: "s2", sense: "Earth or another planet.", verdict: "pass" },
    { target: "orb", senseId: "s2", sense: "Earth.", verdict: "fail" },
    { target: "Innermost", senseId: "s5", sense: "Divine spirit.", verdict: "pass" },
  ] };
  const candidates = { senses: [{ senseId: "s2", groups: [{ members: ["planet"], note: "For a physical planet. Not for spiritual worlds." }] }] };
  const added = addPassedCandidates(proposal, checks, candidates, new Set(["s5"]));
  assert.deepEqual(added, ["planet"]);
  assert.deepEqual(proposal.entries[0].variants.at(-1), { id: "e1v2", target: "planet", note: "For a physical planet.", senses: ["Earth or another planet."], corpusSense: null, fromExisting: false, rationale: "Passed its checks; the translators' votes decide whether it is needed.", addedForVote: true });
  assert.equal(proposal.entries[1].variants.at(-1).target, "planet");
  assert.equal(proposal.entries[2].variants.length, 1, "expressions keep their own translations");
  assert.deepEqual(proposal.leftOutRenderings, [], "no longer listed as left out");
});

test("the counting lines name the texts being searched", async () => {
  const logs = [];
  const corpus = { ...fakeCorpus(passages(40)), textsName: "Samael Aun Weor's books and lectures" };
  const { engine: research } = engine({ corpus, log: (event) => logs.push(event) });
  await research.runToReview();
  assert.ok(logs.some((event) => event.type === "info" && event.text === "Counting how many paragraphs in Samael Aun Weor's books and lectures use each spelling…"));
});

test("a step the person may skip ends with what it has; a step the others need cannot be skipped", async () => {
  // The dictionary page waits (a check box): skipping ends the wait, research goes on.
  let research;
  const logs = [];
  const waiting = { lookup: () => new Promise(() => {}) };
  const made = engine({ dictionary: waiting, log: (event) => {
    logs.push(event);
    if (event.type === "info" && /^Looking up/.test(event.text)) setTimeout(() => research.skip(), 0);
  } });
  research = made.engine;
  const review = await research.runToReview();
  assert.equal(review.status, "review");
  assert.equal(made.store.data.dictionary.status, "skipped");
  assert.ok(logs.some((event) => event.type === "fact" && /^Skipped by you/.test(event.text)));

  // Word forms feeds everything after it: no skip.
  const second = engine({ log: (event) => {
    if (event.type === "heading" && event.text === "Word forms") assert.equal(second.engine.skip(), false);
  } });
  await second.engine.runToReview();
  assert.ok(!SKIPPABLE_STEPS.has("Word forms") && !SKIPPABLE_STEPS.has("Proposal") && !SKIPPABLE_STEPS.has("Counting"));
});

test("skipping the candidate check sends every candidate on unchecked, and all reach the vote", async () => {
  const inner = fakeModel();
  let research;
  const model = {
    calls: inner.calls,
    async call(request, onDelta) {
      if (request.stage === "checks") {
        assert.equal(research.currentStep(), "Candidate checks");
        assert.equal(research.skip(), true);
        return { status: "cancelled" };
      }
      return inner.call(request, onDelta);
    },
  };
  const made = engine({ model });
  research = made.engine;
  const review = await research.runToReview();
  assert.equal(made.store.data.checks.skipped, true);
  assert.ok(made.store.data.checks.candidates.every((c) => c.verdict === "unchecked"));
  const targets = review.proposal.entries.flatMap((entry) => entry.variants.map((variant) => variant.target));
  for (const c of made.store.data.checks.candidates) assert.ok(targets.includes(c.target), `${c.target} reaches the vote`);
});

test("skipping the second translator leaves the first count to decide", async () => {
  const inner = fakeModel();
  let research;
  const model = {
    calls: inner.calls,
    async call(request, onDelta) {
      if (request.stage === "counting" && research.currentStep() === "Counting (second judge)") {
        research.skip();
        return { status: "cancelled" };
      }
      return inner.call(request, onDelta);
    },
  };
  const made = engine({ model, judges: 2 });
  research = made.engine;
  const review = await research.runToReview();
  const done = await research.runCounting(review.proposal);
  assert.equal(done.status, "done");
  assert.equal(made.store.data.counting2.skipped, true);
  assert.notEqual(done.aggregate.totals.judges, 2, "one count only");
  assert.ok(done.aggregate.totals.occurrencesSampled > 0);
});

/** A model whose translator takes turns on one sentence: `pattern` gives its choice per try. */
function flippingModel({ pattern, sameMeaning }) {
  const inner = fakeModel();
  let flipped = null;
  let tries = 0;
  const seen = [];
  return {
    calls: inner.calls, seen,
    async call(request, onDelta) {
      if (request.schemaName === "consistency") {
        const answer = await inner.call({ ...request, stage: "counting" }, onDelta);
        const parsed = JSON.parse(answer.text);
        flipped ??= parsed.items.find((row) => row.variantId === "e1v1")?.occId;
        for (const row of parsed.items) {
          if (row.occId !== flipped) continue;
          const choice = pattern[tries % pattern.length];
          tries += 1;
          if (choice === "other") Object.assign(row, { status: "unresolved", variantId: null, unresolvedReason: "insufficient_context" });
          else Object.assign(row, { variantId: choice, sentenceTranslation: `It was a ${choice} thing.` });
        }
        return { ...answer, text: JSON.stringify(parsed) };
      }
      if (request.schemaName === "consistency_meaning") {
        seen.push(request);
        const ids = [...request.content.matchAll(/^### (\S+)$/gm)].map((m) => m[1]);
        return { status: "ok", text: JSON.stringify({ items: ids.map((occId) => ({ occId, sameMeaning, reason: "r" })) }), usage: { inputTokens: 10, outputTokens: 10 } };
      }
      return inner.call(request, onDelta);
    },
    flipped: () => flipped,
  };
}

test("consistency test: a flip that keeps the meaning is standardised; a translation another meaning uses is kept", async () => {
  const model = flippingModel({ pattern: ["e1v1", "e1v2", "e1v1", "e1v2", "e1v1"], sameMeaning: true });
  const { engine: research, store } = engine({ model });
  const review = await research.runToReview();
  await research.runCounting(review.proposal);
  const result = store.data.consistency;
  assert.equal(result.flips.length, 1);
  assert.match(model.seen[0].content, /with “disastrous” \(3 of 5 tries\)[\s\S]*with “fateful” \(2 of 5 tries\)/);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.standardised[0].keep, "e1v1");
  // "fateful" (e1v2) is listed for another meaning (sense 4): it stays, taken off this one only.
  assert.deepEqual(result.dropped, []);
  assert.deepEqual(result.narrowed.map((n) => [n.variantId, n.removed, n.kept]), [["e1v2", ["2"], ["4"]]]);
});

test("consistency test: a flip that changes the meaning is left to the person", async () => {
  const model = flippingModel({ pattern: ["e1v1", "e1v2", "e1v1", "e1v2", "e1v1"], sameMeaning: false });
  const logs = [];
  const { engine: research, store } = engine({ model, log: (event) => logs.push(event) });
  const review = await research.runToReview();
  await research.runCounting(review.proposal);
  const result = store.data.consistency;
  assert.deepEqual(result.standardised, []);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].kind, "meaning");
  assert.deepEqual(result.conflicts[0].variantIds.sort(), ["e1v1", "e1v2"]);
  assert.ok(logs.some((event) => event.type === "fact" && /Your decision is needed before saving/.test(event.text)));
});

test("consistency test: a tie is broken by translating the same sentences again", async () => {
  // Two each and one unclear in the first five tries, then "fateful" every time.
  const model = flippingModel({ pattern: ["e1v1", "e1v2", "e1v1", "e1v2", "other", "e1v2", "e1v2", "e1v2", "e1v2", "e1v2"], sameMeaning: true });
  const { engine: research, store } = engine({ model });
  const review = await research.runToReview();
  await research.runCounting(review.proposal);
  const result = store.data.consistency;
  assert.equal(result.standardised[0].keep, "e1v2");
  assert.deepEqual(result.standardised[0].votes, { e1v1: 2, e1v2: 7 });
});

test("test again translates the conflict's sentences with the edited entry and says whether the translator still takes turns", async () => {
  const runSaved = {
    meta: { term: "mundo", sourceLanguage: { name: "Spanish" }, targetLanguage: { name: "English" }, reportLanguage: { name: "English", code: "en" } },
    counting: { occurrences: [{ occId: "o1.1", entryId: "e1", itemId: "p1", start: 10, end: 15, surface: "mundos", sentenceStart: 0, sentenceEnd: 22 }] },
    sample: { items: { p1: { itemId: "p1", text: "En otros mundos viven.", occurrences: [{ start: 9, end: 15, surface: "mundos" }] } } },
  };
  const entry = { id: "e1", kind: "word", sourceTerms: ["mundo"], generalNote: "", variants: [{ id: "v1", target: "world", note: "Spiritual worlds." }, { id: "v2", target: "planet", note: "A physical planet." }] };
  const sent = [];
  const client = (choices) => ({
    async callMany(keyed) {
      sent.push(...keyed.map(([, request]) => request));
      return new Map(keyed.map(([key], index) => [key, { items: [{ occId: "o1.1", status: "selected", variantId: choices[index % choices.length], sentenceTranslation: "x" }] }]));
    },
  });
  const steady = await retestConsistency({ client: client(["v2"]), run: runSaved, entry, occIds: ["o1.1"] });
  assert.equal(steady.flips.length, 0);
  assert.equal(steady.answered, 5);
  assert.match(sent[0].instructions, /\[v2\] planet — A physical planet\./, "the edited note is what the translator sees");
  const turns = await retestConsistency({ client: client(["v1", "v2"]), run: runSaved, entry, occIds: ["o1.1"] });
  assert.equal(turns.flips.length, 1);
});
