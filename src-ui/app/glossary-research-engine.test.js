import test from "node:test";
import assert from "node:assert/strict";

import {
  createResearchEngine,
  validateProposal,
} from "./glossary-research-engine.js";
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

function fakeCorpus(items) {
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
  existingComparison: [{ existing: "fateful", verdict: "count", proposed: "fateful", reason: "measure it" }],
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

function engine({ model = fakeModel(), store = memoryStore(), limit = 4, items = passages(40), log = () => {} } = {}) {
  return {
    model, store,
    engine: createResearchEngine({
      model, prices: PRICES, corpus: fakeCorpus(items), dictionary, store, log,
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
