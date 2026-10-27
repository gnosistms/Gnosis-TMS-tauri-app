import test from "node:test";
import assert from "node:assert/strict";
import { createResearchEngine } from "./glossary-research-engine.js";
import { modelPrices } from "./glossary-research-budget.js";
import { buildEntryDrafts } from "./glossary-research-report-flow.js";
import { carryMeaningNotes, verifiedNumericName, selectCompactEvidence } from "./glossary-research-compact.js";
import { createDictionary, spanishDefinitionSection } from "./glossary-research-dictionary.js";

const passage = (id, text, term = "Vornag") => ({ itemId: id, text,
  occurrences: [{ start: text.indexOf(term), end: text.indexOf(term) + term.length, surface: term }],
  reference: { title: "Author text" }, contextBefore: [], contextAfter: [] });
const storeOf = (initial = {}) => {
  const data = structuredClone(initial);
  return { data, load: (key) => data[key], save: (key, value) => { data[key] = structuredClone(value); } };
};
const prices = modelPrices("claude", "claude-opus-5-5");
function numericEvidence() {
  return { term: "Vornag", sourceCode: "es", targetCode: "vi",
    items: [passage("p1", "Un Vornag equivale a 1.234.567 unidades."), passage("p2", "Se percibe un Vornag completo.")],
    near: [{ form: "Vornak", near: "Vornag" }],
    sources: [{ text: "Un Vornak representa 1.234.567 unidades.", reference: { title: "Source Book — Source Author" } }],
    records: [{ title: "Source Book — Source Author", originalBookId: "sourcebook", originalAuthor: null, originalLanguage: "ru-hy" }],
    originals: [{ bookId: "sourcebook", author: "Source Author", language: "en", items: [{ text: "One Vornak is the named unit." }] }] };
}
function setup({ response, evidence = numericEvidence(), model, log = () => {}, settings = {}, store = storeOf(), corpusOverrides = {} } = {}) {
  const requests = [], dictCalls = [];
  const corpus = { authorName: "Author", description: "Test corpus",
    async formsHint() { return { forms: [{ form: evidence.term, rows: evidence.items.length }] }; },
    async countForm() { return { rows: evidence.items.length, examples: [] }; },
    async population() { return { rows: evidence.items.length, distinct: evidence.items.length, duplicateGroups: 0 }; },
    async sample(_forms, n) { return { items: evidence.items.slice(0, n), meta: { seed: "test" } }; },
    async originalTerms() { return []; }, async sourceBooks() { return evidence.records; },
    async nearForms() { return evidence.near; }, async sourceUsage() { return evidence.sources; },
    async originalSample() { return evidence.originals[0] ?? { items: [] }; }, ...corpusOverrides };
  const engine = createResearchEngine({ corpus, store, log, prices,
    model: model ?? { async call(request) {
      requests.push(request);
      if (!response) throw new Error("A verified name must not call the model");
      return { status: "ok", text: JSON.stringify(response), usage: { inputTokens: 1000, cachedTokens: 0, outputTokens: 100 } };
    } }, dictionary: { async lookup() { throw new Error("Legacy dictionary must not run"); },
      async lookupCompact() { dictCalls.push(1); return { status: "found", text: "A source dictionary definition.", tried: [], notes: [] }; } },
    settings: { researchProcedure: "compact", term: evidence.term, variants: [], existingEntries: [],
      sourceLanguageCode: "es", sourceLanguageName: "Spanish", targetLanguageCode: "vi", targetLanguageName: "Vietnamese",
      reportLanguageCode: "en", reportLanguageName: "English", sampleSize: 40, spendingLimitUsd: 4, ...settings } });
  return { engine, store, requests, dictCalls };
}
function proposal() {
  return { partsOfSpeech: ["noun", "adjective"], entries: [{ id: "e1", kind: "word", sourceTerms: ["Vornag"],
    generalNote: "General condition.", populationOccurrencesCited: 0, rationale: "source evidence",
    variants: [{ id: "e1v1", target: "named being", note: "noun", partOfSpeech: "noun", senses: ["technical"], corpusSense: "technical", rationale: "" },
      { id: "e1v2", target: "close", note: "adjective", partOfSpeech: "adjective", senses: ["ordinary"], corpusSense: null, rationale: "" }] }],
    rejectedExpressions: [], derivativeStudies: [], leftOutRenderings: [], sensesOutsideDictionary: [], openQuestions: [], provenance: [],
    meanings: [{ id: "m1", partOfSpeech: "noun", sourceDefinition: "Una designación técnica, no su definición comparativa.", selectionNote: "Technical noun condition.", variantIds: ["e1v1"], originalTerm: null, bookId: null },
      { id: "m2", partOfSpeech: "adjective", sourceDefinition: "Amistad estrecha o espacio interior.", selectionNote: "Ordinary adjective, distinct from the technical noun.", variantIds: ["e1v2"], originalTerm: null, bookId: null }],
    selectionPolicy: { preferredVariantId: "e1v1", defaultCondition: "Only when naming the technical being.", exceptions: [{ variantIds: ["e1v2"], condition: "When an ordinary adjective describes a relationship." }] } };
}

test("a unique numeric/unit source counterpart bypasses AI and dictionary; original edition language is not composition language", async () => {
  for (const targetLanguageCode of ["vi", "en"]) {
    const { engine, store, requests, dictCalls } = setup({ settings: { targetLanguageCode } });
    const review = await engine.runToReview();
    assert.equal(review.proposal.entries[0].variants[0].target, "Vornak");
    assert.equal(review.proposal.verifiedName.author, "Source Author");
    assert.equal(review.proposal.verifiedName.originalEditionLanguage, "en");
    assert.equal(store.data.sources.records[0].originalLanguage, "ru-hy");
    assert.equal(requests.length, 0); assert.equal(dictCalls.length, 0);
    const done = await engine.runCounting(review.proposal, { skipCounting: true });
    assert.equal(done.aggregate.totals.outcomes.not_run, 2);
    assert.equal(store.data.counting.skipped, true); assert.equal(requests.length, 0);
    const drafts = buildEntryDrafts({ ...store.data, meta: { term: "Vornag", settings: { researchProcedure: "compact" } } }, []);
    assert.equal(drafts.e1.variants[0].include, true);
  }
});

test("ambiguous spellings, wrong numeric units and unrelated editions cannot bypass semantic research", () => {
  for (const change of [
    (p) => p.near.push({ form: "Vornam" }),
    (p) => { p.sources[0].text = "Un Vornak representa 1.234.568 unidades."; },
    (p) => { p.sources[0].text = "Un Vornak representa 1.234.567 segundos."; },
    (p) => { p.originals[0].bookId = "anotherbook"; },
    (p) => { p.originals[0].items[0].text = "A different name appears here."; },
  ]) {
    const data = numericEvidence(); change(data); assert.equal(verifiedNumericName(data), null);
  }
});

test("ordinary meanings and operational notes survive proposal, user edits, freeze and zero counting", async () => {
  const evidence = numericEvidence(); evidence.near = [];
  const { engine, store, requests } = setup({ evidence, response: proposal() });
  const review = await engine.runToReview();
  assert.deepEqual(requests.map((r) => r.schemaName), ["compact_proposal"]);
  assert.match(review.proposal.entries[0].generalNote, /Ordinary adjective, distinct/);
  assert.match(review.proposal.entries[0].generalNote, /Only when naming/);
  review.proposal.entries[0].variants[0].target = "User-selected designation";
  await engine.runCounting(review.proposal, { skipCounting: true });
  assert.equal(store.data.frozen.entries[0].variants[0].target, "User-selected designation");
  const run = { ...store.data, meta: { term: "Vornag", settings: { researchProcedure: "compact" } } };
  const drafts = buildEntryDrafts(run, []);
  assert.equal(drafts.e1.variants.length, 2);
  assert.ok(drafts.e1.variants.every((v) => v.include));
  assert.match(drafts.e1.generalNote, /Ordinary adjective/);
  assert.equal(store.data.consistency.skipped, true);
});

test("a printed original word is preserved in its language only for its annotated grammatical meaning", () => {
  const p = proposal(); p.meanings[0].originalTerm = "Original Name"; p.meanings[0].bookId = "book";
  carryMeaningNotes(p, { pairs: [{ bookId: "book", original: "Original Name", originalLanguage: "en", originalTitle: "Original Book", originalAuthor: "M." }] }, "en");
  assert.equal(p.entries[0].variants[0].target, "Original Name");
  assert.equal(p.entries[0].variants[1].target, "close");
  assert.equal(p.entries[0].variants[0].original.author, "M.");
  const noMeanings = proposal(); noMeanings.meanings = [];
  assert.throws(() => carryMeaningNotes(noMeanings, { pairs: [] }, "en"), /omitted its source meanings/);
});

test("an exception that names no translation becomes an open question instead of stopping the run", () => {
  const p = proposal();
  p.selectionPolicy = { preferredVariantId: null, defaultCondition: "", exceptions: [
    { variantIds: [], condition: "The wording is too isolated to establish either meaning." },
    { variantIds: [p.entries[0].variants[1].id], condition: "Use for the narrower case." }] };
  carryMeaningNotes(p, { pairs: [] }, "en");
  assert.deepEqual(p.openQuestions?.slice(-1), ["The wording is too isolated to establish either meaning."]);
  assert.equal(p.selectionPolicy.exceptions.length, 1);
  assert.match(p.entries[0].variants[1].note, /narrower case/);
  const blank = proposal();
  blank.selectionPolicy = { preferredVariantId: null, defaultCondition: "", exceptions: [{ variantIds: [blank.entries[0].variants[0].id], condition: " " }] };
  assert.throws(() => carryMeaningNotes(blank, { pairs: [] }, "en"), /no usable condition/);
});

test("counting after a skipped count measures uses once, preserves unused meanings, and resumes without new requests", async () => {
  const evidence = numericEvidence(); evidence.near = [];
  const calls = [];
  const model = { async call(request) {
    calls.push(request.schemaName);
    const answer = request.schemaName === "counting"
      ? { items: [...request.content.matchAll(/^(\S+): use /gm)].map((m) => ({ occId: m[1], status: "selected", variantId: "e1v1", sentenceTranslation: "A named being appears.", chosenWording: "named being", fit: "good", note: "", otherRendering: null, unresolvedReason: null })) }
      : proposal();
    return { status: "ok", text: JSON.stringify(answer), usage: { inputTokens: 1000, cachedTokens: 0, outputTokens: 100 } };
  } };
  const { engine, store } = setup({ evidence, model, settings: { judges: 2 } });
  const review = await engine.runToReview();
  await engine.runCounting(review.proposal, { skipCounting: true });
  const done = await engine.runCounting(review.proposal);
  assert.equal(done.aggregate.entries.e1.variants.e1v1.occurrences, 2);
  assert.equal(done.aggregate.entries.e1.notRun, 0);
  assert.equal(store.data.counting.skipped, undefined);
  assert.deepEqual(calls, ["compact_proposal", "counting"]);
  const drafts = buildEntryDrafts({ ...store.data, meta: { term: evidence.term, settings: { researchProcedure: "compact" } } }, []);
  assert.ok(drafts.e1.variants.every((variant) => variant.include));
  const resumed = setup({ evidence, store, model });
  await resumed.engine.runToReview();
  await resumed.engine.runCounting(review.proposal);
  assert.deepEqual(calls, ["compact_proposal", "counting"]);
});

test("unknown original claims or dangling meaning references do not get cached as a proposal", async () => {
  const evidence = numericEvidence(); evidence.near = [];
  const wrong = proposal(); wrong.meanings[0].variantIds = ["missing"];
  const { engine, store } = setup({ evidence, response: wrong });
  await assert.rejects(engine.runToReview(), /missing translation/);
  assert.equal(store.data.proposal, undefined);
  const falseClaim = proposal(); falseClaim.meanings[0].originalTerm = "Invented"; falseClaim.meanings[0].bookId = "unknown";
  assert.throws(() => carryMeaningNotes(falseClaim, { pairs: [] }, "en"), /no matching source/);
});

test("zero hits, budgets and cancellation stop before unnecessary AI requests", async () => {
  const zero = numericEvidence(); zero.items = [];
  const empty = setup({ evidence: zero }); await assert.rejects(empty.engine.runToReview(), /does not occur/);
  assert.equal(empty.requests.length, 0);
  const ordinary = numericEvidence(); ordinary.near = [];
  const limited = setup({ evidence: ordinary, response: proposal(), settings: { spendingLimitUsd: 0.00001 } });
  await assert.rejects(limited.engine.runToReview(), /limit|budget|cost/i); assert.equal(limited.requests.length, 0);
  const cancelled = setup(); cancelled.engine.cancel();
  await assert.rejects(cancelled.engine.runToReview(), /cancelled/i);
});

test("empty forms hints and saved zero-hit checkpoints stop without AI or empty searches, showing corpus spellings", async () => {
  for (const store of [storeOf(), storeOf({ forms: { confirmed: ["Vornak"], searched: [] } })]) {
    const check = setup({ store, settings: { term: "Vornak" }, corpusOverrides: {
      async formsHint() { return { forms: [] }; },
      async countForm() { return { rows: 0, examples: [] }; },
      async nearCorpusForms() { return [{ form: "Vornag", rows: 2 }]; },
      async population() { throw new Error("Must not issue an empty search"); },
    } });
    await assert.rejects(check.engine.runToReview(), (error) => error.kind === "spelling-choice" && /Similar spellings.*Vornag.*2 passages/.test(error.message));
    assert.equal(check.requests.length, 0);
    assert.equal(check.dictCalls.length, 0);
  }
});

test("source-proof recommendations are cached; adding an approved spelling continues the name shortcut without AI", async () => {
  const evidence = numericEvidence();
  const suggestions = [{ form: "Vornag", rows: 2, examples: evidence.items }, { form: "Vornar", rows: 7, examples: [passage("other", "Un Vornar aparece aquí.", "Vornar")] }];
  const first = setup({ evidence, settings: { term: "Vornak" }, corpusOverrides: {
    async formsHint() { return { forms: [] }; }, async countForm() { return { rows: 0, examples: [] }; },
    async nearCorpusForms() { return suggestions; },
  } });
  await assert.rejects(first.engine.runToReview(), (error) => {
    assert.equal(error.kind, "spelling-choice");
    assert.deepEqual(error.suggestions.map((p) => p.recommended), [true, false]);
    return true;
  });
  const resumedChoice = setup({ evidence, store: first.store, settings: { term: "Vornak" }, corpusOverrides: {
    async formsHint() { return { forms: [] }; }, async countForm() { return { rows: 0, examples: [] }; },
    async nearCorpusForms() { throw new Error("Cached choice should not query the API again"); },
  } });
  await assert.rejects(resumedChoice.engine.runToReview(), (error) => error.suggestions[0].recommended);
  first.store.save("forms", null); first.store.save("spellingChoice", null);
  const continued = setup({ evidence, store: first.store, settings: { term: "Vornak", variants: ["Vornag"] }, corpusOverrides: {
    async formsHint() { return { forms: [] }; }, async countForm(form) { return { rows: form === "Vornag" ? 2 : 0, examples: [] }; },
  } });
  const review = await continued.engine.runToReview();
  assert.deepEqual(review.proposal.entries[0].sourceTerms, ["Vornag"]);
  assert.equal(review.proposal.entries[0].variants[0].target, "Vornak");
  assert.equal(continued.store.data.proposal.verifiedName.observed, "Vornag");
  assert.equal(continued.requests.length, 0); assert.equal(continued.dictCalls.length, 0);
});

test("a different source definition leaves the similar spelling unchecked", async () => {
  const evidence = numericEvidence(); evidence.sources[0].text = "Un Vornak representa 1.234.568 unidades.";
  const check = setup({ evidence, settings: { term: "Vornak" }, corpusOverrides: {
    async formsHint() { return { forms: [] }; }, async countForm() { return { rows: 0, examples: [] }; },
    async nearCorpusForms() { return [{ form: "Vornag", rows: 2, examples: evidence.items }]; },
  } });
  await assert.rejects(check.engine.runToReview(), (error) => error.kind === "spelling-choice" && error.suggestions[0].recommended === false);
  assert.equal(check.requests.length, 0); assert.equal(check.dictCalls.length, 0);
});

test("a user-supplied corpus spelling remains usable when the headword's forms hint is empty", async () => {
  const evidence = numericEvidence(); evidence.near = [];
  const check = setup({ evidence, response: proposal(), settings: { term: "Vornak", variants: ["Vornag"] }, corpusOverrides: {
    async formsHint() { return { forms: [] }; },
    async countForm(form) { return { rows: form === "Vornag" ? 2 : 0, examples: [] }; },
  } });
  await check.engine.runToReview();
  assert.deepEqual(check.store.data.forms.searched, ["Vornag"]);
  assert.deepEqual(check.requests.map((p) => p.schemaName), ["compact_proposal"]);
});

test("small corpus evidence is complete; large evidence stays bounded and keeps multiple documents", () => {
  const small = [passage("a", "Vornag is here."), passage("b", "Another Vornag is here.")];
  assert.equal(selectCompactEvidence(small).items.length, 2);
  const large = Array.from({ length: 400 }, (_, i) => ({ ...passage(String(i), `Vornag ${i}. ${"x".repeat(300)}`), reference: { title: `Book ${i % 4}` } }));
  const selected = selectCompactEvidence(large);
  assert.equal(selected.items.length, 12); assert.ok(selected.characters <= 20000);
  assert.equal(new Set(selected.items.map((p) => p.reference.title)).size, 4);
});

test("a large corpus gets one source-only coverage pass and honours a larger requested counting sample", async () => {
  const evidence = numericEvidence(); evidence.near = [];
  evidence.items = Array.from({ length: 400 }, (_, i) => passage(String(i), `Vornag ${i}. ${"texto ".repeat(80)}`));
  const calls = [];
  const model = { async call(request) {
    calls.push(request);
    const answer = request.schemaName === "compact_coverage"
      ? { passageIds: JSON.parse(request.content).windows.slice(0, 12).map((p) => p.id), meanings: ["Un uso sustantivo."], uncertainty: "" }
      : proposal();
    return { status: "ok", text: JSON.stringify(answer), usage: { inputTokens: 1000, cachedTokens: 0, outputTokens: 100 } };
  } };
  const { engine, store } = setup({ evidence, model, settings: { sampleSize: 400 } });
  await engine.runToReview();
  assert.deepEqual(calls.map((p) => p.schemaName), ["compact_coverage", "compact_proposal"]);
  assert.equal(store.data.sample.measuredIds.length, 400);
  assert.equal(JSON.parse(calls[1].content).passages.length, 12);
  assert.ok(JSON.parse(calls[0].content).windows.every((p) => typeof p.text === "string"));
});

test("fast dictionary retains Spanish definitions and discards translations and other language sections", async () => {
  const wikitext = "== {{lengua|es}} ==\n=== Adjetivo ===\n;1: Interior, interno.\n;2: Amistad estrecha.\n==== Traducciones ====\nSECRET TARGET\n== {{lengua|fr}} ==\nFrench text";
  assert.doesNotMatch(spanishDefinitionSection(wikitext), /SECRET TARGET|French/);
  const dict = createDictionary({ languageCode: "es", invoke: () => { throw new Error("No DLE webview"); },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ parse: { wikitext: { "*": wikitext } } }) }) });
  const result = await dict.lookupCompact("íntimo");
  assert.equal(result.status, "found"); assert.equal(result.senseCount, 2);
  assert.match(result.text, /Interior, interno/); assert.match(result.sourceName, /CC BY-SA/);
});
