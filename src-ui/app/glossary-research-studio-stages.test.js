import test from "node:test";
import assert from "node:assert/strict";
import { assignMeanings, prepareReadingTranslations, runResearchStage } from "./glossary-research-studio-stages.js";
import { newStudioStudy, deduplicatePassages, shuffled, buildStudioDraft } from "./glossary-research-studio-workflow.js";

function study() {
  const s = newStudioStudy({ term: "marche", forms: ["marche"], seed: 9,
    sourceLanguage: { code: "fr", name: "French" }, targetLanguage: { code: "en", name: "English" } }, "test");
  s.recoveryBudget = 500; s.recoveryProfiles = [];
  s.forms = [{ text: "marche" }]; s.model = { providerId: "openai", modelId: "test" };
  return s;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function meaningReply(data, meaningFor) {
  if (data.missingMeaningIds) return { matches: data.missingMeaningIds.flatMap((meaningId) => {
    for (const p of data.paragraphs) for (const [i, o] of p.occurrences.entries()) if (meaningFor(p, o, i) === meaningId) return [{ meaningId, paragraphId: p.id, occurrenceId: o.id }];
    return [];
  }) };
  return { paragraphMeanings: data.paragraphs.map((p) => ({ paragraphId: p.id, meaningIds: p.occurrences.map((o, i) => meaningFor(p, o, i)) })) };
}

test("ambiguous assignments request neighbors only for flagged paragraphs", async () => {
  const s = study(); s.meanings = [{ id: "m" }];
  s.passages = deduplicatePassages([{ id: "p", text: "marche", contextBefore: ["decisive context"] }], ["marche"], "fr");
  let calls = 0;
  await assignMeanings(s, { ask: async (_q, data) => {
    calls += 1;
    assert.deepEqual(data.paragraphs[0].before ?? [], calls === 1 ? [] : ["decisive context"]);
    return { ...meaningReply(data, () => "m"), contextParagraphIds: calls === 1 ? ["p"] : [] };
  } });
  assert.equal(calls, 2); assert.deepEqual(s.contextIncludedIds, ["p"]);
});

test("default recovery checks one hundred additional paragraphs and permits an explicit extension", async () => {
  const s = study(); delete s.recoveryBudget;
  s.population = deduplicatePassages(Array.from({ length: 301 }, (_, i) => ({ id: `p${i}`, text: `marche ${i}` })), ["marche"], "fr");
  s.passages = s.population.slice(0, 1); s.meanings = [{ id: "m" }, { id: "absent" }];
  const tools = { ask: async (_q, data) => meaningReply(data, () => "m") };
  await assignMeanings(s, tools); assert.equal(s.recoveryConsidered, 100);
  s.recoveryBudget = 200;
  await assignMeanings(s, tools); assert.equal(s.recoveryConsidered, 200);
  assert.equal(new Set(s.recoveryScanned).size, 200);
});

test("preliminary translations use two independent batches after assignment and preserve out-of-order results", async () => {
  const s = study();
  s.passages = deduplicatePassages(Array.from({ length: 34 }, (_, i) => ({ id: `p${i}`, text: `marche ${i}` })), ["marche"], "fr");
  s.meanings = [{ id: "m1", definition: "Walk" }];
  s.displayTranslations = { p0: "Previously prepared" };
  const pending = []; const progress = [];
  let active = 0; let maximum = 0;
  const tools = {
    ask: async (_question, data) => {
      assert.equal(pending.length, 0, "source assignment must finish before any translation starts");
      assert(!JSON.stringify(data).includes("Previously prepared"));
      return meaningReply(data, () => "m1");
    },
    run: async (kind, payload) => {
      assert.equal(kind, "translate"); assert.equal(s.assignments.length, 34);
      assert.deepEqual(payload.glossaryHints, []);
      active += 1; maximum = Math.max(maximum, active);
      await new Promise((resolve) => pending.push({ payload, resolve }));
      active -= 1;
      return { rows: payload.rows.map((r) => ({ rowId: r.rowId, translatedText: `Translation of ${r.sourceText}` })) };
    },
    reportProgress: (message) => progress.push(message),
  };
  await assignMeanings(s, tools);
  const running = prepareReadingTranslations(s, tools, s.passages.map((p) => p.id));
  await new Promise(setImmediate);
  assert.equal(pending.length, 2);
  pending[1].resolve(); await new Promise(setImmediate);
  assert.equal(pending.length, 3);
  assert.equal(s.displayTranslations.p16, "Translation of marche 16");
  pending[0].resolve(); pending[2].resolve();
  await running;
  assert.equal(maximum, 2);
  assert.equal(Object.keys(s.displayTranslations).length, 34);
  assert.equal(s.displayTranslations.p0, "Previously prepared");
  for (const p of s.passages.slice(1)) assert.equal(s.displayTranslations[p.id], `Translation of ${p.text}`);
  assert(progress.at(-1).includes("33 of 33 paragraphs"));
});

test("a preliminary batch failure stops dispatch and awaits other active work before returning", async () => {
  const s = study();
  s.passages = deduplicatePassages(Array.from({ length: 31 }, (_, i) => ({ id: `p${i}`, text: `marche ${i}` })), ["marche"], "fr");
  s.meanings = [{ id: "m1" }];
  s.assignments = s.passages.flatMap((p) => p.occurrences.map((o) => ({ paragraphId: p.id, occurrenceId: o.id, meaningId: "m1" })));
  const pending = [];
  const running = prepareReadingTranslations(s, { run: async (_kind, payload) => {
    await new Promise((resolve, reject) => pending.push({ resolve, reject }));
    return { rows: payload.rows.map((r) => ({ rowId: r.rowId, translatedText: r.sourceText })) };
  } }, s.passages.map((p) => p.id));
  let settled = false;
  running.then(() => { settled = true; }, () => { settled = true; });
  const checked = assert.rejects(running, /AI unavailable/);
  await new Promise(setImmediate);
  pending[0].reject(new Error("AI unavailable"));
  await new Promise(setImmediate);
  assert.equal(settled, false);
  assert.equal(pending.length, 2);
  pending[1].resolve(); await checked;
  assert.equal(pending.length, 2);
  assert.equal(Object.keys(s.displayTranslations).length, 15);
  const { studioToolSignature } = await import("./glossary-research-studio-workflow.js");
  const payload = { ...s.model, sourceLanguage: "French", targetLanguage: "English", sourceLanguageCode: "fr", targetLanguageCode: "en",
    glossaryHints: [], rows: s.passages.slice(0, 15).map((p, i) => ({ rowId: String(i + 1), sourceText: p.text })) };
  assert.equal(s.lastToolSignature, await studioToolSignature("translate", payload), "Retry must target the failed batch, not the later finishing successful batch");
});

test("missing meanings share 500 additional paragraphs; recovered examples exceed 100 and absent meanings stay report-only", async () => {
  const s = study();
  s.population = deduplicatePassages(Array.from({ length: 750 }, (_, i) => ({ id: `p${i}`, text: `marche ${i}` })), ["marche"], "fr");
  s.passages = s.population.slice(0, 100);
  s.meanings = [{ id: "common" }, { id: "rare" }, { id: "outside" }];
  const extra = shuffled(s.population, 10).filter((p) => !s.passages.includes(p));
  const rare = extra[499].id; const outside = extra[500].id; const checked = [];
  const tools = {
    ask: async (_q, data) => {
      checked.push(...data.paragraphs.map((p) => p.id));
      return meaningReply(data, (p) => p.id === rare ? "rare" : p.id === outside ? "outside" : "common");
    },
    run: async (_kind, payload) => ({ rows: payload.rows.map((r) => ({ rowId: r.rowId, translatedText: "walking" })) }),
  };
  const result = await assignMeanings(s, tools);
  assert.equal(result.recoveryConsidered, 500);
  assert.equal(s.passages.length, 101);
  assert.equal(new Set(checked).size, 600);
  assert(!checked.includes(outside));
  assert.equal(s.meanings[1].unused, false); assert.equal(s.meanings[2].unused, true);
  assert.equal(s.displayTranslations[rare], undefined, "reading aids are requested separately from source assignment");
  await assignMeanings(s, tools);
  assert.equal(checked.length, 600, "resuming must not scan beyond the shared budget");
});
test("a recovered paragraph with a second unmatched occurrence requires human review", async () => {
  const s = study();
  s.population = deduplicatePassages([{ id: "initial", text: "marche" }, { id: "extra", text: "marche marche" }], ["marche"], "fr");
  s.passages = s.population.slice(0, 1); s.meanings = [{ id: "a" }, { id: "b" }];
  const result = await assignMeanings(s, { ask: async (_q, data) => data.paragraphs
    ? meaningReply(data, (p, _o, i) => p.id === "initial" ? "a" : i === 0 ? "b" : null)
    : { definition: "New meaning", translation: "walk march" } });
  assert.equal(result.pending, true);
  assert.equal(s.pendingDecision.paragraphId, "extra");
  assert.equal(s.pendingDecision.occurrenceId, "o1");
});
test("French dictionaries use the native edition then English, independently of optional forms research", async () => {
  const s = study(); s.step = "4.1"; const calls = [];
  const result = await runResearchStage(s, {
    run: async (kind, payload) => { calls.push({ kind, ...payload }); return { status: payload.language === "fr" ? "not_found" : "found", extract: "dictionary" }; },
    ask: async (q) => q.startsWith("Identify whether") ? { originLanguage: null, originTerm: null } : { meanings: [], summary: "Dictionary evidence" },
  }, []);
  assert.deepEqual(calls.map((c) => [c.kind, c.language]), [["dictionary", "fr"], ["dictionary", "en"]]);
  assert.equal(result.evidence.native.status, "not_found");
  assert.equal(result.evidence.englishEdition.status, "found");
});

test("original-language dictionary evidence uses the resolved edition without duplicate English lookups", async () => {
  for (const status of ["found", "not_found", "unreachable"]) {
    const s = study(); s.step = "4.1";
    s.origin = { proposal: { originLanguage: "grc", originTerm: "ἱεροφάντης" } };
    const calls = [];
    const result = await runResearchStage(s, {
      run: async (kind, payload, purpose) => {
        calls.push({ kind, payload, purpose });
        return kind === "web" ? { summary: "Cited source" } : { status: payload.language === "grc" ? status : "found", edition: payload.language === "grc" ? "en" : payload.language, language: payload.language };
      },
      ask: async (_question, data) => {
        assert.equal(data.original.native.edition, "en");
        assert.equal(data.original.native.language, "grc");
        return { meanings: [], summary: "Dictionary findings" };
      },
    }, []);
    assert.equal(result.original.native.status, status);
    assert.deepEqual(calls.filter((c) => c.kind === "dictionary").map((c) => c.payload.language), ["fr", "grc"]);
    assert.equal(calls.some((c) => c.purpose.includes("grc Wiktionary")), false);
    assert.equal(calls.filter((c) => c.kind === "web").length, status === "found" ? 0 : 1);
  }
});

test("form discovery publishes incremental candidates and corpus evidence before the final identity verdict", async () => {
  const s = study(); s.step = "2a"; s.scope.corpus = "samael"; const updates = [];
  await runResearchStage(s, {
    checkpoint: async (message) => updates.push({ message, phase: s.formDiscovery.phase, forms: structuredClone(s.forms) }),
    ask: async (q) => q.startsWith("List genuine") ? { forms: ["marches"], originLanguage: null }
      : { forms: [{ text: "marche", sameWord: true, found: true, reason: "source evidence" }, { text: "marches", sameWord: true, found: true, reason: "Plural" }] },
    run: async (_kind, payload) => payload.path === "/api/search/forms"
      ? { candidates: [{ form: "marché" }] }
      : { population_distinct: payload.params.forms === "marche" ? 40 : 0, items: payload.params.forms === "marche" ? [{ text: "marche" }] : [] },
  }, []);
  assert.deepEqual(updates[0].forms.map((f) => f.text), ["marche"]);
  assert(updates.some((u) => u.phase === "checking" && u.forms.some((f) => f.text === "marches")));
  assert(updates.every((u) => !u.forms.some((f) => f.text === "marché")), "raw fuzzy matches stay out of the selectable list");
  assert(updates.some((u) => u.message.includes("Checking 3 possible forms")));
  assert(updates.some((u) => u.forms.some((f) => f.text === "marche" && f.discoveryStatus.startsWith("40 matching paragraphs"))));
  assert(updates.some((u) => u.phase === "verifying"));
  assert.equal(s.formDiscovery.phase, "complete");
  assert.deepEqual(s.forms.map((f) => [f.text, f.selected]), [["marche", true], ["marches", false]]);
});

test("corpus checks overlap a slow origin search and publish counts while identity waits for both", async () => {
  const s = study(); s.step = "2a"; s.scope.corpus = "samael";
  const updates = []; const calls = [];
  let releaseSearch; const heldSearch = new Promise((resolve) => { releaseSearch = resolve; });
  let searchStarted; const started = new Promise((resolve) => { searchStarted = resolve; });
  const corpusDone = deferred();
  const cited = { summary: "Original spelling found in a cited source.", citations: [{ url: "https://example.org/original" }] };
  const running = runResearchStage(s, {
    checkpoint: async (message) => {
      updates.push({ message, forms: structuredClone(s.forms), origin: structuredClone(s.origin) });
      if (message.startsWith("Corpus checks complete")) corpusDone.resolve();
    },
    ask: async (q, data) => {
      if (q.startsWith("List genuine")) return { forms: ["marches"], originLanguage: "la", originTerm: "original" };
      calls.push("identity"); assert.deepEqual(data.origin, cited);
      assert(updates.some((u) => u.origin?.evidence?.summary === cited.summary));
      return { forms: ["marche", "marches"].map((text) => ({ text, sameWord: true, reason: "Same word." })) };
    },
    run: async (kind, payload) => {
      if (kind === "web") { calls.push("web"); searchStarted(); await heldSearch; return cited; }
      if (payload.path === "/api/search/forms") return { candidates: [] };
      calls.push(`corpus:${payload.params.forms}`);
      return { population_distinct: 7, items: [{ text: payload.params.forms }] };
    },
  }, []);
  await Promise.all([started, corpusDone.promise]);
  assert.equal(calls[0], "web");
  assert.deepEqual(calls.slice(1), ["corpus:marche", "corpus:marches"]);
  assert.equal(s.formDiscovery.phase, "checking-origin");
  assert.deepEqual(s.formDiscovery.corpusResults, [{ text: "marche", paragraphCount: 7 }, { text: "marches", paragraphCount: 7 }]);
  assert(s.forms.every((f) => f.paragraphCount === 7));
  assert(updates.at(-1).forms.every((f) => f.paragraphCount === 7));
  assert.equal(updates.at(-1).origin.proposal.originTerm, "original");
  releaseSearch(); await running;
  assert.equal(s.formDiscovery.phase, "complete");
  assert.deepEqual(s.origin.evidence, cited);
  assert.equal(calls.filter((c) => c === "web").length, 1);
});

test("two form checks overlap, early origin findings persist, and out-of-order results preserve complete ordered evidence", async () => {
  const s = study(); s.step = "2a"; s.scope.corpus = "samael";
  const proposed = ["marche", "marches", "marchant"];
  const alternatives = ["marché", "marchons", "marchâmes"];
  const gates = Object.fromEntries([...proposed, ...alternatives].map((form) => [form, deferred()]));
  const started = Object.fromEntries([...proposed, ...alternatives].map((form) => [form, deferred()]));
  const originDone = deferred(); const requests = []; let review = null;
  const cited = { summary: "Cited original spelling.", citations: [{ url: "https://example.org/original" }] };
  let active = 0; let peak = 0;
  const running = runResearchStage(s, {
    checkpoint: async (message) => { if (message === "Original-spelling findings received") originDone.resolve(); },
    ask: async (q, data) => {
      if (q.startsWith("List genuine")) return { forms: proposed, originLanguage: "la", originTerm: "original" };
      review = structuredClone(data);
      return { forms: [...proposed, ...alternatives].map((text) => ({ text, sameWord: true, reason: "Supported form." })) };
    },
    run: async (kind, payload) => {
      requests.push({ kind, payload: structuredClone(payload) });
      if (kind === "web") return cited;
      active++; peak = Math.max(peak, active);
      try {
        if (payload.path === "/api/search/forms") {
          const index = proposed.indexOf(payload.params.q);
          started[payload.params.q].resolve(); await gates[payload.params.q].promise;
          return { candidates: [{ form: alternatives[index], relation: "spelling", examples: [{ text: `${alternatives[index]} witness` }] }] };
        }
        const form = payload.params.forms;
        if (alternatives.includes(form)) { started[form].resolve(); await gates[form].promise; }
        return { population_distinct: [...proposed, ...alternatives].indexOf(form) + 1,
          items: [{ text: `${form} exact witness.`, representative: { doc_id: form } }] };
      } finally { active--; }
    },
  }, []);
  await Promise.all([started.marche.promise, started.marches.promise, originDone.promise]);
  assert.equal(requests.filter((r) => r.payload.path === "/api/search/forms").length, 2);
  assert.deepEqual(s.origin.evidence, cited);
  assert.equal(s.formDiscovery.phase, "checking"); assert.equal(review, null);
  gates.marches.resolve(); await started.marchant.promise;
  gates.marchant.resolve(); gates.marche.resolve();
  await Promise.all([started[alternatives[0]].promise, started[alternatives[1]].promise]);
  assert.equal(requests.filter((r) => r.payload.path === "/api/sample" && alternatives.includes(r.payload.params.forms)).length, 2);
  assert.deepEqual(review.proposed, proposed);
  assert.deepEqual(review.candidateForms, [...proposed, ...alternatives]);
  assert.deepEqual(review.exactWitnesses.map((row) => [row.form, row.paragraphCount]), proposed.map((form, i) => [form, i + 1]));
  assert(review.exactWitnesses.every((row) => row.examples[0].text === `${row.form} exact witness.`));
  assert.deepEqual(review.origin, cited);
  gates[alternatives[1]].resolve(); await started[alternatives[2]].promise;
  gates[alternatives[2]].resolve(); gates[alternatives[0]].resolve();
  const result = await running;
  assert.equal(peak, 2);
  assert.deepEqual(result.forms.map((form) => [form.text, form.paragraphCount]), [...proposed, ...alternatives].map((form, i) => [form, i + 1]));
  assert.deepEqual(s.formDiscovery.corpusResults.map((form) => form.text), proposed);
  assert.equal(requests.filter((r) => r.kind === "web").length, 1);
  assert.equal(requests.find((r) => r.kind === "web").payload.query,
    "marche original original spelling la transliteration French English");
  assert.equal(requests.filter((r) => r.payload.path === "/api/search/forms").length, 3);
  assert.equal(requests.filter((r) => r.payload.path === "/api/sample").length, 6, "accepted proposed forms reuse exact checks");
  assert(requests.filter((r) => r.payload.path === "/api/sample").every((r) => r.payload.params.n === "3" && r.payload.params.context === "0"));
});

test("a failed concurrent form stops queued checks, drains siblings, and retains the failed request identity", async () => {
  const s = study(); s.step = "2a"; s.scope.corpus = "samael";
  const failed = deferred(); const sibling = deferred(); const origin = deferred(); const started = [];
  const failure = Object.assign(new Error("Exact corpus result incomplete"), { studioToolSignature: "failed-form" });
  let identity = false;
  const running = runResearchStage(s, {
    ask: async (q) => {
      if (q.startsWith("List genuine")) return { forms: ["marche", "marches", "marchant"], originLanguage: "la" };
      identity = true; return {};
    },
    run: async (kind, payload) => {
      if (kind === "web") { await origin.promise; return { summary: "Preserved original evidence." }; }
      started.push(payload.params.q ?? payload.params.forms);
      if (payload.params.q === "marche") { failed.resolve(); throw failure; }
      if (payload.params.q === "marches") { await sibling.promise; s.lastToolSignature = "later-sibling"; return { candidates: [] }; }
      return { population_distinct: 1, items: [{ text: payload.params.forms }] };
    },
  }, []);
  let settled = false;
  const observed = assert.rejects(running, (error) => { settled = true; return error === failure; });
  await failed.promise;
  assert.equal(settled, false);
  sibling.resolve(); origin.resolve();
  await observed;
  assert(!started.includes("marchant"));
  assert.equal(identity, false);
  assert.equal(s.lastToolSignature, "failed-form");
  assert.equal(s.origin.evidence.summary, "Preserved original evidence.");
  assert.notEqual(s.formDiscovery.phase, "complete");
});

test("concurrent project forms share one in-flight snapshot and keep independent exact counts", async () => {
  const s = study(); s.step = "2a"; s.scope.corpus = "projects";
  const read = deferred(); const started = deferred(); let requests = 0;
  const running = runResearchStage(s, {
    ask: async (q) => q.startsWith("List genuine") ? { forms: ["marche", "marches"], originLanguage: null }
      : { forms: ["marche", "marches"].map((text) => ({ text, sameWord: true })) },
    run: async (kind) => {
      assert.equal(kind, "projects"); requests++; started.resolve(); await read.promise;
      return { items: [{ id: "one", text: "marche" }, { id: "two", text: "marches" }, { id: "three", text: "Les marches." }] };
    },
  }, []);
  await started.promise;
  read.resolve(); const result = await running;
  assert.equal(requests, 1);
  assert.deepEqual(result.forms.map((form) => [form.text, form.paragraphCount]), [["marche", 1], ["marches", 2]]);
});

test("lexical explanations reach checkpoints before newly accepted alternatives finish checking", async () => {
  const s = study(); s.step = "2a"; s.scope.corpus = "samael";
  const updates = [];
  await runResearchStage(s, {
    checkpoint: async () => updates.push(structuredClone(s.forms)),
    ask: async (q) => q.startsWith("List genuine") ? { forms: [], originLanguage: null }
      : { forms: [{ text: "marche", sameWord: true, reason: "Original form confirmed." }, { text: "marches", sameWord: true, reason: "Plural confirmed." }] },
    run: async (_kind, payload) => {
      if (payload.path === "/api/search/forms") return { candidates: [{ form: "marches" }] };
      if (payload.params.forms === "marches") {
        assert(updates.some((rows) => rows.some((f) => f.text === "marche" && f.reason === "Original form confirmed.")));
      }
      return { population_distinct: 2, items: [{ text: payload.params.forms }] };
    },
  }, []);
});

test("mundo case variants collapse and exact plural counts determine inclusion independently of AI found flags", async () => {
  const s = study(); s.step = "2a";
  Object.assign(s.scope, { term: "Mundo", forms: ["Mundo", "mundo"], sourceLanguage: { code: "es", name: "Spanish" } });
  const requests = [];
  const result = await runResearchStage(s, {
    ask: async (q, data) => {
      if (q.startsWith("List genuine")) return { forms: ["mundo", "Mundos", "mundos"], originLanguage: null };
      assert.deepEqual(data.proposed, ["Mundo", "Mundos"]);
      assert.equal(data.exactWitnesses[1].paragraphCount, 2026);
      assert(data.exactWitnesses[1].examples[0].text.includes("mundos"));
      return { forms: [{ text: "mundo", sameWord: true, reason: "A world" },
        { text: "Mundo", sameWord: true }, { text: "mundos", sameWord: true, found: false, reason: "Regular plural" }] };
    },
    run: async (_kind, payload) => {
      requests.push(payload);
      if (payload.path === "/api/search/forms") return { candidates: [{ form: "mundo" }, { form: "mundos" }] };
      assert.equal(payload.path, "/api/sample"); assert.equal(payload.params.mode, "exact");
      const plural = payload.params.forms.toLowerCase() === "mundos";
      return { population_distinct: plural ? 2026 : 5600, items: [{ text: plural ? "Los mundos internos." : "Todo el mundo." }] };
    },
  }, []);
  assert.deepEqual(result.forms.map((f) => [f.text, f.selected, f.paragraphCount]), [["Mundo", true, 5600], ["Mundos", true, 2026]]);
  assert.equal(requests.filter((r) => r.path === "/api/sample").length, 2, "case variants do not duplicate corpus checks");
});

test("an accepted spelling discovered by corpus recall receives its own exact check", async () => {
  const s = study(); s.step = "2a";
  const checked = [];
  const result = await runResearchStage(s, {
    ask: async (q) => q.startsWith("List genuine") ? { forms: ["marche"] }
      : { forms: [{ text: "marche", sameWord: true }, { text: "marches", sameWord: true, found: false }, { text: "supramarche", sameWord: false }] },
    run: async (_kind, payload) => {
      if (payload.path === "/api/search/forms") return { candidates: [{ form: "marches" }] };
      checked.push(payload.params.forms);
      return { population_distinct: 8, items: [{ text: payload.params.forms }] };
    },
  }, []);
  assert.deepEqual(checked, ["marche", "marches"]);
  assert(result.forms.every((f) => f.selected && f.paragraphCount === 8));
});

test("an incomplete exact lookup fails instead of labeling a form absent", async () => {
  const s = study(); s.step = "2a";
  await assert.rejects(runResearchStage(s, {
    ask: async () => ({ forms: ["marche"] }),
    run: async (_kind, payload) => payload.path === "/api/search/forms" ? { candidates: [] }
      : { population_distinct: 10, items: [{ text: "unrelated text" }] },
  }, []), /exact corpus check.*incomplete/);
  assert.notEqual(s.formDiscovery.phase, "complete");
});

test("dictionary research checks capitalization variants and supplies corpus context to exclude unrelated names", async () => {
  const s = study(); s.step = "4.1";
  Object.assign(s.scope, { term: "Mundo", sourceLanguage: { code: "es", name: "Spanish" } });
  s.forms = [{ text: "Mundo" }]; s.passages = [{ id: "p", text: "El planeta y el mundo." }];
  s.origin = { proposal: { originLanguage: null } };
  const calls = [];
  const result = await runResearchStage(s, {
    run: async (kind, payload) => {
      calls.push({ kind, ...payload });
      if (kind === "dle") return { status: "unreachable" };
      return { status: "found", entry: { extract: payload.term === "Mundo" ? "Apellido" : "Planeta Tierra" } };
    },
    ask: async (question, data) => {
      assert(question.includes("Exclude senses of unrelated names"));
      assert(question.includes("2–4 short sentences"));
      assert(question.includes("raw field names"));
      assert.equal(data.examples[0].text, "El planeta y el mundo.");
      assert.equal(data.evidence.native.entry.extract, "Apellido");
      assert.equal(data.evidence.caseVariants[0].entry.extract, "Planeta Tierra");
      return { meanings: [{ definition: "Planet Earth" }] };
    },
  }, []);
  assert.deepEqual(calls.map((c) => [c.kind, c.term ?? c.path]), [["dle", "Mundo"], ["dictionary", "Mundo"], ["dictionary", "mundo"]]);
  assert.equal(result.dictionaryVersion, 3);
  assert.equal(result.evidence.native.entry.extract, "Apellido");
  assert.equal(result.evidence.caseVariants[0].entry.extract, "Planeta Tierra");
});

test("words without separable components do not send an empty request for a second analysis", async () => {
  const s = study(); s.step = "4.3"; const calls = [];
  const result = await runResearchStage(s, {
    ask: async (question, data) => { calls.push({ question, data }); return { parts: [] }; },
  }, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].data.term, "marche");
  assert.deepEqual(result.meanings, []);
  assert(result.summary.includes("No separate word components"));
  assert(result.summary.includes("marche"));
});

test("meaning consolidation uses curated senses without resurrecting excluded raw dictionary entries", async () => {
  const s = study(); s.step = "4.5";
  s.steps["4.1"] = { approved: { meanings: [{ definition: "Planet", evidence: [{ url: "https://example.org/mundo" }] }],
    summary: "An unrelated surname was excluded", evidence: { native: { extract: "Unrelated surname" } } } };
  await runResearchStage(s, {
    ask: async (_question, data) => {
      assert.equal(data.term, "marche");
      assert.equal(data.sourceMeanings[0].definition, "Planet");
      assert.equal(data.sourceMeanings[0].evidence, undefined);
      assert(!JSON.stringify(data).includes("Unrelated surname"));
      return { meanings: [{ id: "planet", definition: "Planet", sourceIds: ["4.1:1"] }], excludedSources: [] };
    },
  }, []);
  assert.equal(s.meanings[0].definition, "Planet");
  assert.equal(s.meanings[0].evidence[0].url, "https://example.org/mundo");
});

test("candidate research separates detailed evidence from brief translator guidance and preserves human notes", async () => {
  const manual = "Human selection instructions that must remain unchanged.";
  for (const human of ["", manual]) {
    const s = study(); s.step = "6"; s.generalNote = human; s.footnote = human;
    s.scope.targetLanguage = { code: "vi", name: "Vietnamese" };
    s.meanings = [{ id: "m1", definition: "Walk" }];
    s.steps["4.1"] = { approved: { summary: "Verified author and original spelling", meanings: [] } };
    const reportOnly = "A detailed explanation of the verified source, evidence and why this candidate was chosen.";
    const result = await runResearchStage(s, { ask: async (question, data, shape) => {
      assert(question.includes("never reference meaning IDs"));
      assert(question.includes("roughly 10–25 English words or comparable brevity in the target language"));
      assert(question.includes("longer note ONLY"));
      assert(question.includes("generalNote empty"));
      assert(shape.includes("researchSummary"));
      assert.equal(data.term, "marche");
      assert.deepEqual(data.forms, ["marche"]);
      assert.equal(data.sourceReports[0].summary, "Verified author and original spelling");
      return { candidates: [{ id: "c1", text: "đi bộ", meaningIds: ["m1"], note: "Di chuyển bằng chân.", explanation: reportOnly }],
        generalNote: "", researchSummary: "Verified provenance belongs in the research report.", footnote: "Verified reader citation" };
    } }, []);
    assert.equal(result.generalNote, human);
    assert.equal(result.footnote, human || "Verified reader citation");
    assert.equal(result.research.candidates[0].explanation, reportOnly);
    assert.match(result.research.summary, /provenance/);
    assert.equal(s.candidates[0].explanation, undefined);
    const draft = buildStudioDraft(s, s.candidates);
    assert.deepEqual(draft.targetVariantNotes, ["Di chuyển bằng chân."]);
    assert(!JSON.stringify(draft).includes(reportOnly));
    assert(!JSON.stringify(draft).includes("Verified provenance"));
  }
});


test("split candidate research supplies the complete expression rather than only its parent meaning", async () => {
  const s = study(); s.step = "6"; s.scope.term = "todo el mundo";
  s.forms = [{ text: "todo el mundo" }]; s.parentId = "parent-mundo";
  s.meanings = [{ id: "people", definition: "Humanity or society collectively" }];
  await runResearchStage(s, { ask: async (question, data) => {
    assert.equal(data.term, "todo el mundo");
    assert.deepEqual(data.forms, ["todo el mundo"]);
    assert(question.includes("do not propose translations of the parent word alone"));
    return { candidates: [{ id: "everyone", text: "everyone", meaningIds: ["people"], note: "All relevant people" }] };
  } }, []);
  assert.equal(s.candidates[0].text, "everyone");
});


test("rechecking forms preserves explicit human inclusion and exclusion while refreshing exact evidence", async () => {
  const s = study(); s.step = "2a"; s.scope.corpus = "samael"; s.scope.forms = ["marche", "marches"];
  s.formDiscovery = { phase: "complete", version: 3 };
  s.forms = [{ text: "marche", selected: false, paragraphCount: 40 }, { text: "marches", selected: true, paragraphCount: 0 }];
  await runResearchStage(s, {
    checkpoint: async () => {},
    ask: async (q) => q.startsWith("List genuine") ? { forms: ["marche", "marches"], originLanguage: null }
      : { forms: ["marche", "marches"].map((text) => ({ text, sameWord: true })) },
    run: async (_kind, payload) => payload.path === "/api/search/forms" ? { candidates: [] }
      : { population_distinct: payload.params.forms === "marche" ? 41 : 0,
        items: payload.params.forms === "marche" ? [{ text: "marche" }] : [] },
  }, []);
  assert.deepEqual(s.forms.map((f) => [f.text, f.selected, f.paragraphCount]), [["marche", false, 41], ["marches", true, 0]]);
});


function sharedReferenceFixture(books, { witnesses = [{ id: "reference", text: "Author reference" }], genuine = true } = {}) {
  return { books, author_references: { schema_version: 2, ready: true, corpus_fingerprint: "current-corpus" },
    authors: books.map((book, index) => ({ author_id: book.original_author, author: book.original_author, books: [book],
      schema_version: 2, fingerprint: `author-${index}`, review_rules: "author-or-work-reference-v2",
      review_status: genuine === null ? "reviewed" : "verified", count_unit: "distinct_paragraph_texts",
      candidate_mentions: witnesses.length, confirmed_paragraphs: genuine ? witnesses.length : 0,
      confirmed_copies: genuine ? witnesses.length : 0, confirmed_occurrences: genuine ? witnesses.length : 0,
      verified_mentions: genuine === null ? null : genuine ? witnesses.length : 0,
      pending_witnesses: 0, unresolved_witnesses: genuine === null ? witnesses.length : 0,
      witnesses, judgments: witnesses.map((w) => ({ id: w.id, genuine, reason: "Saved reference review" })) })) };
}

test("bibliography reuses shared author evidence without author searches or verification AI calls", async () => {
  const s = study(); s.step = "4.4.1"; s.scope.corpus = "samael";
  const fixture = sharedReferenceFixture([{ doc_id: "source-a", title: "Book A — Author A", original_author: "Author A" }]);
  const calls = [];
  const result = await runResearchStage(s, {
    run: async (kind, payload) => { calls.push({ kind, ...payload });
      if (payload.path === "/api/sample/source-books") return fixture;
      if (payload.path === "/api/sample/original-terms") return {};
      assert.equal(payload.params.kind, "source", "no Samael author-reference search is performed");
      return { items: [{ item_id: "source-p", text: "marche", representative: { doc_id: "source-a" } }] };
    },
    ask: async (question, data) => {
      assert(question.startsWith("Identify possible"), "only term-specific comparisons use AI");
      assert.equal(data.authors[0].verifiedMentions, 1);
      return { meanings: [], summary: "No borrowing established" };
    },
  }, []);
  assert.equal(calls.length, 4);
  assert(calls.every((call) => !call.params.author_id), "only compact catalogs are read");
  assert.equal(result.evidence.authors[0].review.source, "shared-corpus-index");
  assert.equal(result.evidence.authors[0].mentionEvidence.witnesses, undefined);
  assert.equal(result.evidence.authors[0].mentionEvidence.confirmed_paragraphs, 1);
});

test("each bibliography attempt refreshes the catalog while source requests carry its corpus version", async () => {
  const s = study(); s.step = "4.4.1"; s.scope.corpus = "samael";
  const fixture = sharedReferenceFixture([{ doc_id: "source-a", title: "Book — Author", original_author: "Author" }]);
  const requests = [];
  const tools = {
    run: async (_kind, payload) => {
      requests.push(payload);
      if (payload.path === "/api/sample/source-books") return fixture;
      assert.match(payload.researchCorpusVersion, /^sha256:[a-f0-9]{64}$/u);
      return payload.path === "/api/sample/original-terms" ? {} : { items: [{ item_id: "p", text: "marche", representative: { doc_id: "source-a" } }] };
    }, ask: async () => ({ meanings: [], summary: "Compared source uses" }),
  };
  await runResearchStage(s, tools, []); await runResearchStage(s, tools, []);
  const snapshots = requests.filter((p) => p.referenceSnapshotRequest);
  assert.equal(snapshots.length, 4); assert.notEqual(snapshots[0].referenceSnapshotRequest, snapshots[1].referenceSnapshotRequest);
});

test("missing or unreviewed shared metadata stops before any per-term author AI work", async () => {
  for (const response of [{ books: [] }, { ...sharedReferenceFixture([]), author_references: { schema_version: 2, ready: false } }]) {
    const s = study(); s.step = "4.4.1"; s.scope.corpus = "samael"; let calls = 0;
    await assert.rejects(runResearchStage(s, { run: async () => { calls++; return response; }, ask: async () => assert.fail("No AI call allowed") }, []), /corpus maintenance/);
    assert.equal(calls, 1);
  }
});

test("changed or incomplete shared reference details do not fall back to local verification", async () => {
  for (const corrupt of [(r) => { r.authors[0].pending_witnesses = 1; }, (r) => { r.author_references.corpus_fingerprint = "changed"; }, (r) => { r.authors[0].confirmed_copies = "<img>"; }]) {
    const s = study(); s.step = "4.4.1"; s.scope.corpus = "samael";
    const fixture = sharedReferenceFixture([{ doc_id: "source-a", title: "Book — Author", original_author: "Author" }]);
    let snapshots = 0;
    await assert.rejects(runResearchStage(s, {
      run: async (_kind, p) => {
        if (p.path === "/api/sample/source-books") { const r = structuredClone(fixture); if (p.referenceSnapshotRequest && ++snapshots === 2) corrupt(r); return r; }
        if (p.path === "/api/sample/original-terms") return {};
        return { items: [{ item_id: "source", text: "marche", representative: { doc_id: "source-a" } }] };
      }, ask: async () => assert.fail("No AI call allowed"),
    }, []), /changed or is incomplete/);
  }
});

test("large bibliography synthesis batches whole paragraphs and preserves compact reference provenance", async () => {
  const s = study(); s.step = "4.4.1"; s.scope.corpus = "samael";
  const source = Array.from({ length: 4 }, (_, i) => ({ item_id: `source-${i}`, text: `marche ${i} ` + "evidence ".repeat(18000),
    representative: { doc_id: i < 2 ? "book-a" : "book-b" } }));
  const seen = []; const requests = [];
  const result = await runResearchStage(s, {
    run: async (_kind, payload) => payload.path === "/api/sample/source-books"
      ? sharedReferenceFixture(["a", "b"].map((id) => ({ doc_id: `book-${id}`, title: `Book ${id} — Author ${id}`, original_author: `Author ${id}` })), { witnesses: [{ id: "mention", text: "ambiguous mention" }], genuine: null })
      : payload.path === "/api/sample/original-terms" ? { originals: [] }
        : payload.params.kind === "source" ? { items: source }
          : { items: [{ item_id: "mention", text: "ambiguous mention", representative: { line_id: 42 } }], populationFingerprint: "fp" },
    ask: async (question, data) => {
      requests.push(JSON.stringify(data).length);
      assert(!question.startsWith("Classify every"));
      if (data.authors) {
        assert(JSON.stringify(data).length < 350000, "each synthesis request fits the evidence guard");
        for (const author of data.authors) {
          assert.equal(author.verifiedMentions, null);
          assert.equal(author.mentionAudit.unresolved, 1);
          assert.equal(author.mentionEvidence, undefined);
          for (const paragraph of author.passages) { seen.push(paragraph.id); assert(source.some((p) => p.text === paragraph.text)); }
        }
      } else assert(data.findings.length > 1);
      return { meanings: [{ definition: "Source sense", evidence: [{ quotation: "marche", url: "https://example.test/book" }] }], summary: "Origin remains uncertain" };
    },
  }, []);
  assert.deepEqual(seen.sort(), source.map((p) => p.item_id).sort());
  assert(requests.every((size) => size < 350000));
  assert.equal(result.evidence.authors.length, 2);
  assert.equal(result.evidence.authors[0].mentionEvidence.unresolved_witnesses, 1);
  assert.equal(result.evidence.authors[0].review.source, "shared-corpus-index");
  assert.equal(result.evidence.authors.flatMap((a) => a.passages).length, 4);
});


test("large reference audits remain in the shared service instead of entering local comparisons", async () => {
  const s = study(); s.step = "4.4.1"; s.scope.corpus = "samael";
  const witnesses = Array.from({ length: 5 }, (_, i) => ({ id: `w-${i}`, text: `Author ${i} ` + "context ".repeat(20000) }));
  const fixture = sharedReferenceFixture([{ doc_id: "source-a", title: "Book — Author", original_author: "Author" }], { witnesses });
  let asks = 0;
  const result = await runResearchStage(s, {
    run: async (_kind, payload) => payload.path === "/api/sample/source-books" ? fixture
      : payload.path === "/api/sample/original-terms" ? {}
        : { items: [{ item_id: "source", text: "marche", representative: { doc_id: "source-a" } }] },
    ask: async (question, data) => {
      asks++; assert(question.startsWith("Identify possible")); assert(JSON.stringify(data).length < 10000);
      assert.equal(data.authors[0].verifiedMentions, 5);
      return { meanings: [], summary: "No borrowing established" };
    },
  }, []);
  assert.equal(asks, 1);
  assert.equal(result.evidence.authors[0].mentionEvidence.witnesses, undefined);
  assert.equal(result.evidence.authors[0].mentionEvidence.confirmed_paragraphs, 5);
});


test("source summary retains curated citations and uncertainty without resending the raw author audit", async () => {
  const s = study(); s.step = "4.4.4";
  const meaning = { definition: "Perceptible through the senses", originalTerm: null,
    evidence: [{ url: "https://example.test/source", quotation: "Exact source quote" }] };
  const audit = { rawWitnesses: "complete audit ".repeat(40000) };
  s.steps["4.4.1"] = { approved: { summary: "A parallel, not proven borrowing; date uncertain.", meanings: [meaning], evidence: audit } };
  const result = await runResearchStage(s, { ask: async () => { assert.fail("No repeated model synthesis for one meaning source"); } }, []);
  assert.deepEqual(result.meanings, [meaning]);
  assert(result.summary.includes("date uncertain"));
  assert.equal(s.steps["4.4.1"].approved.evidence, audit);
});

test("source synthesis remains available when both branches contribute meanings", async () => {
  const s = study(); s.step = "4.4.4";
  s.steps["4.4.1"] = { approved: { summary: "date uncertain", meanings: [{ definition: "Dark", evidence: [{ quotation: "Exact source quote" }] }] } };
  s.steps["4.4.2"] = { approved: { summary: "Other source", meanings: [{ definition: "Secret" }] } };
  let calls = 0;
  await runResearchStage(s, { ask: async (_question, data) => {
    calls++;
    assert(JSON.stringify(data).length < 10000);
    assert(JSON.stringify(data).includes("date uncertain"));
    assert(JSON.stringify(data).includes("Exact source quote"));
    return { meanings: [], summary: "Uncertain source" };
  } }, []);
  assert.equal(calls, 1);
});


test("compound research counts only exact parent research witnesses, not source citations or child expressions", async () => {
  const s = study(); s.step = "5"; s.scope.term = "sensible"; s.forms = [{ text: "sensible" }];
  s.passages = deduplicatePassages([{ id: "a", text: "sensibles mallas" }, { id: "b", text: "Las sensibles mallas ganglionares" },
    { id: "c", text: "receptividad sensible" }, { id: "child", text: "cuerpo sensible" }], ["sensible", "sensibles"]);
  s.meanings = [{ id: "m1", definition: "Responsive", evidence: [{ paragraphId: "foreign-source", quotation: "nervios sensibles" }] }, { id: "m2", definition: "Sensory receptivity" }];
  s.assignments = s.passages.map((p) => ({ paragraphId: p.id, occurrenceId: "o0", meaningId: p.id === "c" ? "m2" : "m1", ...(p.id === "child" ? { entryId: "child-study" } : {}) }));
  const result = await runResearchStage(s, { ask: async (_question, data) => {
    assert(!JSON.stringify(data.meanings).includes("foreign-source"));
    assert(!data.paragraphs.some((p) => p.id === "child"));
    assert.equal(data.assignments, undefined);
    assert(data.paragraphs.every((p) => p.occurrences.every((o) => ["m1", "m2"].includes(o.meaningId))));
    return { compounds: [{ phrase: "sensibles mallas", meaningId: "m1", paragraphIds: ["foreign-source"], explanation: "Nerve networks" },
      { phrase: "nervios sensibles", meaningId: "m1", paragraphIds: ["foreign-source", "another-source"], explanation: "Source-book phrase" },
      { phrase: "receptividad sensible", meaningId: "m2", paragraphIds: ["c"], specialMeaning: true, explanation: "A technical philosophical application" },
      { phrase: "cuerpo sensible", meaningId: "m1", paragraphIds: ["child"], specialMeaning: true, explanation: "Only in child" }] };
  } }, []);
  assert.deepEqual(result.compounds.map((c) => c.phrase), ["sensibles mallas", "receptividad sensible"]);
  assert.deepEqual(result.compounds[0].paragraphIds, ["a", "b"]);
  assert.deepEqual(result.unverifiedCompounds.map((c) => c.phrase), ["nervios sensibles", "cuerpo sensible"]);
  assert.equal(s.passages.length, 4);
});

test("bibliography declares future work before lookup and adds authors and batches before their requests", async () => {
  const { createStudioActivity } = await import("./glossary-research-studio-activity.js");
  const s = study(); s.step = "4.4.1"; s.scope.corpus = "samael";
  const activity = createStudioActivity(s, () => {}, () => true);
  let requests = 0;
  const items = () => s.activitySteps[s.step].items;
  const operations = {
    run: async (_kind, payload) => {
      requests++;
      assert.equal(items().length, 6, "all top-level operations precede the first request");
      if (payload.path === "/api/sample/source-books") {
        if (payload.params.author_id) assert.deepEqual(items().find((n) => n.id === "authors").children.map((n) => n.label), ["Author A", "Author B"]);
        return sharedReferenceFixture(["A", "B"].map((name) => ({ doc_id: name, title: `Book ${name}`, original_author: `Author ${name}` })));
      }
      if (payload.path === "/api/sample/original-terms") return {};
      if (payload.params.kind === "source") return { items: ["A", "B"].map((name) => ({ item_id: name, text: "marche", representative: { doc_id: name } })) };
      assert.deepEqual(items().find((n) => n.id === "authors").children.map((n) => n.label), ["Author A", "Author B"]);
      return { items: [{ item_id: "w", text: "An author", representative: { line_id: 1 } }] };
    },
    ask: async (question) => {
      requests++;
      assert(!question.startsWith("Classify every"));
      assert(items().find((n) => n.id === "comparisons").children.length > 0);
      return { meanings: [{ definition: "A source meaning" }], summary: "No unique borrowing established." };
    },
  };
  function tools(path = []) { return { ...operations,
    planActivity: (nodes) => activity.plan(nodes, path), forActivity: (id) => tools([...path, id]),
    finishActivity: (summary) => activity.finish(path, summary),
  }; }
  const result = await runResearchStage(s, tools(), []);
  assert.equal(requests, 5, "two compact snapshot reads replace per-author audit retrievals");
  assert.equal(result.evidence.authors.length, 2);
  assert.match(items().find((n) => n.id === "authors").result, /2 authors/);
  assert.match(items().find((n) => n.id === "consolidate").result, /No unique borrowing/);
});

test("form identity review retains candidates and witnesses without repeated book frequency tables", async () => {
  const s = study(); s.step = "2a"; s.scope.corpus = "samael";
  const seen = [];
  const tools = {
    ask: async (question, data) => {
      seen.push({ question, data });
      if (question.startsWith("List genuine")) return { forms: ["marche", "marches"] };
      assert.deepEqual(data.candidateForms, ["marche", "marches", "marqué"]);
      assert.equal(data.candidates.find((c) => c.form === "marqué").relationships.length, 2);
      assert.equal(data.candidates.find((c) => c.form === "marqué").witnesses.length, 1);
      assert(!JSON.stringify(data).includes("Large per-book frequency table"));
      assert.equal(data.exactWitnesses.length, 2);
      assert(data.exactWitnesses.every((row) => row.examples[0].text.includes("full paragraph")));
      return { forms: ["marche", "marches"].map((text) => ({ text, sameWord: true })) };
    },
    run: async (_kind, payload) => payload.path === "/api/search/forms"
      ? { candidates: [{ form: "marqué", relation: "typo", books: [{ title: "Large per-book frequency table" }], examples: [{ doc_id: "a", line_id: 7 }] }] }
      : { population_distinct: 1, items: [{ text: `${payload.params.forms} full paragraph`, representative: { doc_id: "a" } }] },
  };
  await runResearchStage(s, tools, []);
  assert.equal(seen.length, 2);
  assert.deepEqual(s.forms.map((f) => f.text), ["marche", "marches"]);
});

test("existing-entry research matches verified forms without AI and excludes longer phrases", async () => {
  const s = study(); s.step = "2b"; s.forms = [{ text: "marche" }, { text: "marches" }];
  const entries = [
    { termId: "exact", sourceTerms: ["MARCHE", "marches"] },
    { termId: "longer", sourceTerms: ["une marche lente"] },
    { termId: "other", sourceTerms: ["lointain"] },
  ];
  const result = await runResearchStage(s, { ask: () => { throw new Error("No AI needed"); } }, entries);
  assert.deepEqual(result.entries, [entries[0]]);
  assert.equal(result.exactMatches, 1); assert.equal(result.additionalReviewed, 0);
});

test("existing-entry research sends only plausible alternatives to AI in bounded batches", async () => {
  const s = study(); s.step = "2b"; s.scope.sourceLanguage = { code: "es" }; s.scope.term = "tenebroso";
  s.forms = [{ text: "tenebroso" }];
  const entries = [{ termId: "exact", sourceTerms: ["Tenebroso"] },
    { termId: "typo", sourceTerms: ["tenebrosso", "a much longer unrelated phrase"] },
    { termId: "other", sourceTerms: ["completamente ajeno"] }];
  let asked = 0;
  const result = await runResearchStage(s, { ask: async (_q, data) => {
    asked++; assert.deepEqual(data.entries, [{ termId: "typo", sourceTerms: ["tenebrosso"] }]);
    return { termIds: ["typo"] };
  } }, entries);
  assert.equal(asked, 1); assert.deepEqual(result.entries.map((e) => e.termId), ["exact", "typo"]);
});

test("duplicate plausible forms keep every entry and large shortlists use forty-entry batches", async () => {
  const s = study(); s.step = "2b"; s.scope.sourceLanguage = { code: "es" }; s.scope.term = "tenebroso"; s.forms = [{ text: "tenebroso" }];
  const entries = Array.from({ length: 81 }, (_, i) => ({ termId: `entry-${i}`, sourceTerms: ["tenebrosso"] }));
  const batches = [];
  const result = await runResearchStage(s, { ask: async (_q, { entries: batch }) => {
    batches.push(batch.length); return { termIds: batch.map((entry) => entry.termId) };
  } }, entries);
  assert.deepEqual(batches, [40, 40, 1]);
  assert.equal(result.entries.length, 81);
});

test("seeded research sampling requests one hundred full paragraphs and fills missing form coverage", async () => {
  const s = study(); s.step = "3"; s.scope.corpus = "samael"; s.forms = [{ text: "marche" }, { text: "marches" }];
  const calls = [];
  const result = await runResearchStage(s, { run: async (_kind, payload) => {
    calls.push(payload); assert.equal(payload.all, undefined);
    return payload.params.n === "100" ? { population_distinct: 885, population_fingerprint: "snapshot", has_more: true,
      items: Array.from({ length: 100 }, (_, i) => ({ item_id: `p${i}`, text: `marche ${i}`, context_before: ["Complete preceding paragraph"], context_after: ["Complete following paragraph"] })) }
      : { items: [{ item_id: "rare", text: "marches rare", context_before: ["Rare full context"] }] };
  } }, []);
  assert.deepEqual(calls.map((p) => p.params.n), ["100", "1"]);
  assert.equal(result.total, 885); assert.equal(result.paragraphs, 100); assert.deepEqual(result.missing, []);
  assert(s.passages.some((p) => p.id === "rare")); assert.equal(s.population.length, 101);
  assert(s.passages.find((p) => p.id !== "rare").contextBefore[0].includes("Complete"));
  assert.equal(s.sampling.offset, 100);
});

test("bounded sampling retrieves recovery evidence only for missing meanings and never mixes corpus snapshots", async () => {
  const s = study(); s.scope.corpus = "samael"; s.step = "4.6";
  s.passages = deduplicatePassages([{ id: "p0", text: "marche 0" }], ["marche"], "fr");
  s.population = [...s.passages]; s.meanings = [{ id: "common" }, { id: "missing" }];
  s.sampling = { version: 2, seed: "9", fingerprint: "snapshot", offset: 1, hasMore: true, recoveryReady: false };
  const calls = [];
  await assert.rejects(assignMeanings(s, {
    ask: async (_q, data) => meaningReply(data, () => "common"),
    run: async (kind, payload) => { calls.push({ kind, payload }); return { population_fingerprint: "changed", has_more: false, items: [] }; },
  }), /corpus changed/);
  assert.equal(calls.length, 1); assert.equal(calls[0].payload.params.n, "500");
  assert.equal(calls[0].payload.params.offset, "1"); assert.equal(s.sampling.offset, 1);
  s.meanings = [{ id: "common" }]; calls.length = 0;
  await assignMeanings(s, { run: async (kind, payload) => {
    calls.push(kind); assert.equal(kind, "translate"); return { rows: payload.rows.map((r) => ({ rowId: r.rowId, translatedText: "Preliminary" })) };
  } });
  assert.deepEqual(calls, [], "no corpus retrieval or automatic reading translation when all meanings already have witnesses");
});

test("bounded recovery keeps the shared five-hundred-paragraph budget and includes its last rare witness", async () => {
  const s = study(); s.scope.corpus = "samael"; s.step = "4.6";
  s.passages = deduplicatePassages([{ id: "p0", text: "marche 0" }], ["marche"], "fr");
  s.population = [...s.passages]; s.meanings = [{ id: "common" }, { id: "rare" }];
  s.sampling = { version: 2, seed: "9", fingerprint: "snapshot", offset: 1, hasMore: true, recoveryReady: false };
  const extraRows = Array.from({ length: 500 }, (_, i) => ({ id: `p${i + 1}`, text: `marche ${i + 1}` }));
  const rare = shuffled([...s.passages, ...extraRows], s.scope.seed + 1).filter((p) => p.id !== "p0").at(-1).id;
  let corpusCalls = 0; const checked = [];
  await assignMeanings(s, {
    ask: async (_q, data) => {
      checked.push(...data.paragraphs.map((p) => p.id));
      return meaningReply(data, (p) => p.id === rare ? "rare" : "common");
    },
    run: async (kind, payload) => {
      if (kind === "corpus") {
        corpusCalls++; assert.equal(payload.params.n, "500");
        return { population_fingerprint: "snapshot", has_more: true,
          items: extraRows };
      }
      return { rows: payload.rows.map((r) => ({ rowId: r.rowId, translatedText: "Preliminary" })) };
    },
  });
  assert.equal(corpusCalls, 1); assert.equal(s.recoveryConsidered, 500);
  assert.equal(new Set(checked).size, 501); assert(s.passages.some((p) => p.id === rare));
  assert.equal(s.passages.length, 2); assert.equal(s.meanings[1].unused, false);
});

test("dictionary review uses a small form-diverse sample and preserves full dictionary evidence and context", async () => {
  const s = study(); s.step = "4.1"; s.scope.sourceLanguage = { code: "en", name: "English" }; s.scope.term = "walk";
  s.forms = ["walk", "walked", "walking"].map((text) => ({ text })); s.origin = { proposal: { originLanguage: null } };
  s.passages = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, text: `${s.forms[i % 3].text} ${i}`, contextBefore: ["Complete context"] }));
  const fullDictionary = { status: "found", extract: "Complete source entry with all senses and labels" };
  const result = await runResearchStage(s, {
    run: async () => fullDictionary,
    ask: async (question, data) => {
      assert(question.includes("only dictionary senses"));
      assert.equal(data.examples.length, 3);
      assert.deepEqual(data.examples.map((p) => p.text.split(" ")[0]), ["walk", "walked", "walking"]);
      assert(data.examples.every((p) => p.contextBefore[0] === "Complete context"));
      assert.deepEqual(data.evidence.native, fullDictionary);
      return { meanings: [{ definition: "Move on foot", grammar: "verb", sourceSense: "1", evidence: [] }], summary: "Cited dictionary findings" };
    },
  }, []);
  assert.deepEqual(result.evidence.native, fullDictionary);
});

test("corpus meaning discovery reuses bounded document-diverse full paragraphs without repeated searches or duplicate evidence", async () => {
  const s = study(); s.step = "4.2"; s.forms = [{ text: "marche" }, { text: "marches" }];
  s.passages = deduplicatePassages(Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, text: `marche et marches ${i}. Whole source paragraph.`,
    reference: { doc_id: `book-${i % 8}`, title: `Book ${i % 8}` } })), ["marche", "marches"], "fr");
  const result = await runResearchStage(s, {
    run: () => { throw new Error("No additional retrieval needed"); },
    ask: async (question, data) => {
      assert(question.includes("bounded sample"));
      assert.equal(data.forms.length, 2); assert(data.forms.every((f) => f.paragraphIds.length === 8));
      assert.equal(new Set(data.paragraphs.map((p) => p.id)).size, data.paragraphs.length);
      assert(data.paragraphs.length <= 16);
      assert(data.paragraphs.every((p) => p.text.endsWith("Whole source paragraph.")));
      for (const form of data.forms) assert.equal(new Set(form.paragraphIds.map((id) => data.paragraphs.find((p) => p.id === id).reference.doc_id)).size, 8);
      return { meanings: [{ definition: "Move on foot", evidence: [data.paragraphs[0].id] }], summary: "Bounded source findings" };
    },
  }, []);
  assert.equal(result.meanings.length, 1);
});

test("historical morphology reuses whole-word dictionary findings and does not cascade bound-root lookups", async () => {
  const s = study(); s.step = "4.3";
  s.steps["4.1"] = { approved: { summary: "The cited dictionary derives the whole adjective from a Latin lexeme.", meanings: [{ definition: "Dark", grammar: "adjective" }] } };
  const result = await runResearchStage(s, {
    run: () => { throw new Error("No root lookup needed"); },
    ask: async (_q, data) => {
      assert.equal(data.dictionary.summary, s.steps["4.1"].approved.summary);
      assert.deepEqual(data.dictionary.meanings, [{ definition: "Dark", grammar: "adjective" }]);
      return { parts: [], summary: "Historical Latin morphology does not add a separate source-language meaning." };
    },
  }, []);
  assert.deepEqual(result.meanings, []);
  assert.match(result.summary, /Historical Latin/);
});


test("bibliography bounds each author while retaining full definition witnesses and author-local references", async () => {
  const s = study(); s.step = "4.4.1"; s.scope.corpus = "samael";
  const fixture = sharedReferenceFixture(["a", "b"].map((id) => ({ doc_id: id, title: `Book ${id}`, original_author: `Author ${id}` })));
  const source = Array.from({ length: 60 }, (_, i) => ({ item_id: `p-${i}`, text: `${i} marche ${i === 59 ? "significa contraparte sabiduría" : "ordinary context"}`,
    copies: [{ doc_id: "a", title: "Book a" }, { doc_id: "b", title: "Book b" }], representative: { doc_id: "a" } }));
  const result = await runResearchStage(s, {
    run: async (_k, p) => p.path === "/api/sample/source-books" ? fixture : p.path === "/api/sample/original-terms" ? {} : { items: source },
    ask: async (_q, data) => {
      for (const a of data.authors) {
        assert.equal(a.passages.length, 3); assert(a.passages.some((p) => p.id === "p-59"));
        for (const p of a.passages) { assert.equal(p.text, source.find((row) => row.item_id === p.id).text); assert.equal(p.reference.doc_id, a.author.at(-1)); }
      }
      return { meanings: [], summary: "No proven borrowing" };
    },
  }, []);
  assert.equal(result.evidence.authors[0].matchingParagraphs, 60);
});

test("catalog or alias updates invalidate source retrieval reuse even with unchanged corpus text", async () => {
  const s = study(); s.step = "4.4.1"; s.scope.corpus = "samael";
  const fixture = sharedReferenceFixture([{ doc_id: "a", title: "A", original_author: "Author" }]);
  const versions = [];
  const tools = { run: async (_k, p) => {
    if (p.path === "/api/sample/source-books") return fixture;
    versions.push(p.researchCorpusVersion);
    return p.path === "/api/sample/original-terms" ? {} : { items: [] };
  }, ask: async () => ({ meanings: [], summary: "No source matches" }) };
  await runResearchStage(s, tools, []);
  fixture.author_references.aliases_fingerprint = "new-aliases";
  await runResearchStage(s, tools, []);
  assert.notEqual(versions[0], versions[2]);
});


test("bibliography attaches source metadata from supplied IDs instead of model-copied references", async () => {
  const s = study(); s.step = "4.4.1"; s.scope.corpus = "samael";
  const book = { doc_id: "a", title: "Actual book", original_author: "Author" };
  const tools = { run: async (_k, p) => p.path === "/api/sample/source-books" ? sharedReferenceFixture([book])
    : p.path === "/api/sample/original-terms" ? {} : { items: [{ item_id: "citation", text: "marche", representative: book }] },
    ask: async () => ({ meanings: [{ definition: "Sense", evidence: [{ id: "citation", quotation: "marche", reference: { title: "Wrong model title" } }] }], summary: "Uncertain" }) };
  const result = await runResearchStage(s, tools, []);
  assert.equal(result.meanings[0].evidence[0].reference.title, "Actual book");
  tools.ask = async () => ({ meanings: [{ definition: "Sense", evidence: [{ id: "invented" }] }] });
  await assert.rejects(runResearchStage(s, tools, []), /unknown paragraph/);
});


test("internet research asks only unresolved questions once and validates citations without a second model call", async () => {
  const s = study(); s.step = "4.4.2"; s.steps["4.1"] = { approved: { summary: "Latin origin already established", meanings: [{ definition: "Dark" }], evidence: { raw: "large ".repeat(5000) } } };
  const report = { meanings: [], summary: "No particular borrowing demonstrated", citations: [{ url: "https://example.test/book#page", quotation: "Exact source words" }] };
  let calls = 0;
  const tools = { run: async (kind, payload) => { calls++; assert.equal(kind, "web"); assert(payload.query.includes("Latin origin already established"));
    assert(!payload.query.includes("large ")); assert(payload.query.includes("at most3")); return { summary: JSON.stringify(report), citations: [{ url: "https://example.test/book" }] }; },
    ask: async () => assert.fail("No rewriting model call") };
  assert.equal((await runResearchStage(s, tools, [])).summary, report.summary); assert.equal(calls, 1);
  report.citations[0].url = "https://invented.test/unknown";
  await assert.rejects(runResearchStage(s, tools, []), /unverified source citation/);
});


test("inventory citations are restored exactly and omitted source findings require an explicit reason", async () => {
  const s = study(); s.step = "4.5";
  const quote = { quotation: "Exact preserved words", reference: { title: "Actual source" } };
  s.steps["4.1"] = { approved: { meanings: [{ definition: "Dark", evidence: [quote] }, { definition: "Unrelated foreign proper name" }] } };
  const tools = { ask: async () => ({ meanings: [{ definition: "Dark", sourceIds: ["4.1:1"] }], excludedSources: [{ sourceId: "4.1:2", reason: "Foreign name, not a sense of this word" }] }) };
  const result = await runResearchStage(s, tools, []);
  assert.deepEqual(result.meanings[0].evidence, [quote]); assert.equal(result.excludedSources[0].definition, "Unrelated foreign proper name");
  tools.ask = async () => ({ meanings: [{ definition: "Dark", sourceIds: ["4.1:1"] }], excludedSources: [] });
  await assert.rejects(runResearchStage(s, tools, []), /omitted without explanation/);
});


test("recovery checks only still-missing meanings, preserves full context and ignores unrelated model fields", async () => {
  const s = study(); s.step = "4.6";
  s.population = deduplicatePassages(Array.from({ length: 101 }, (_, i) => ({ id: `p${i}`, text: `marche ${i}`, recovered: true, contextBefore: ["Complete before"], contextAfter: ["Complete after"], copies: [{ privateMetadata: "unneeded catalog" }] })), ["marche"], "fr");
  s.passages = s.population.slice(0, 1); s.meanings = [{ id: "common", definition: "Walk", evidence: "large raw evidence" }, { id: "rare", definition: "Rare" }, { id: "absent", definition: "Absent" }];
  const first = shuffled(s.population, 10).filter((p) => p.id !== "p0")[0].id; const missingSets = [];
  await assignMeanings(s, { ask: async (_q, data) => {
    assert(data.paragraphs.every((p) => p.before[0] === "Complete before" && p.after[0] === "Complete after"));
    assert(data.paragraphs.every((p) => !p.copies)); assert(!JSON.stringify(data).includes("large raw evidence"));
    if (data.missingMeaningIds) { missingSets.push(data.missingMeaningIds); return { matches: data.missingMeaningIds.includes("rare") ? [{ meaningId: "rare", paragraphId: first, occurrenceId: "o0", entryId: "malicious extra", preserveSourceSpelling: true }] : [] }; }
    return meaningReply(data, () => "common");
  }, run: async (_k, p) => ({ rows: p.rows.map((r) => ({ rowId: r.rowId, translatedText: "Preliminary" })) }) });
  assert.deepEqual(missingSets, [["rare", "absent"], ["absent"]]);
  const recovered = s.assignments.find((a) => a.meaningId === "rare");
  assert.equal(recovered.entryId, undefined); assert.equal(recovered.preserveSourceSpelling, undefined); assert.equal(s.recoveryConsidered, 100);
});


test("split checks restore parent scope and reject expressions matching different meanings", async () => {
  const s = study(); s.step = "4.7"; s.meanings = [{ id: "a", definition: "First" }, { id: "b", definition: "Second" }];
  // Distinct source texts preserve separate witnesses for opposite readings.
  s.passages = deduplicatePassages([{ id: "one", text: "la marche ici" }, { id: "two", text: "la marche ailleurs" }], ["marche"], "fr");
  s.assignments = [{ paragraphId: "one", occurrenceId: "o0", meaningId: "a" }, { paragraphId: "two", occurrenceId: "o0", meaningId: "b" }];
  s.steps["4.6"] = { approved: { meanings: structuredClone(s.meanings), assignments: structuredClone(s.assignments) } };
  s.meanings[0].splitOff = true; s.assignments[0].entryId = "old-split";
  const result = await runResearchStage(s, { ask: async (q, data) => {
    assert(q.includes("not a list of phrases")); assert.equal(data.meanings.length, 2);
    assert(data.assignments.every((a) => a.entryId === undefined));
    return { splits: [{ forms: ["la marche"], meaningId: "a", targetTerms: ["first"], rationale: "Intended isolation" }], summary: "Review" };
  } }, []);
  assert.equal(result.splits.length, 0); assert.equal(result.unverifiedSplits.length, 1);
  assert.equal(s.meanings[0].splitOff, false); assert(s.assignments.every((a) => a.entryId === "original"));
});


test("candidate proposals bound examples per meaning while preserving rare uses, full context and exact counts", async () => {
  const s = study(); s.step = "6";
  s.forms = [{ text: "marche" }, { text: "marches" }];
  s.passages = deduplicatePassages(Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, text: `${i % 2 ? "marches" : "marche"} ${i}`, reference: { doc_id: `book-${i % 8}` }, recovered: true, contextBefore: ["Complete before"], contextAfter: ["Complete after"] })), ["marche", "marches"], "fr");
  s.meanings = [{ id: "common", definition: "Walking", evidence: ["p9"] }, { id: "rare", definition: "Rare", evidence: ["p39"] }];
  s.assignments = s.passages.map((p) => ({ paragraphId: p.id, occurrenceId: "o0", meaningId: p.id === "p39" ? "rare" : "common" }));
  await runResearchStage(s, { ask: async (_q, data) => {
    assert.equal(data.meaningSamples[0].totalOccurrences, 39); assert.equal(data.meaningSamples[0].paragraphIds.length, 8);
    assert.equal(data.meaningSamples[1].paragraphIds.length, 1); assert.equal(data.paragraphs.length, 9);
    assert(data.paragraphs.some((p) => p.id === "p9")); assert(data.paragraphs.some((p) => p.id === "p39"));
    assert(data.paragraphs.every((p) => p.before[0] === "Complete before" && p.after[0] === "Complete after"));
    assert.deepEqual(new Set(data.paragraphs.flatMap((p) => p.occurrences.map((o) => o.surface))), new Set(["marche", "marches"]));
    return { candidates: [{ text: "walk", meaningIds: ["common", "rare"] }], generalNote: "", footnote: "" };
  } }, []);
});


test("spelling identification uses unique forms, while verified changes apply to every corresponding candidate", async () => {
  const s = study(); s.step = "7"; s.candidates = [{ id: "a", text: "name", note: "long usage ".repeat(300) }, { id: "b", text: "name", note: "another use" }];
  const result = await runResearchStage(s, { ask: async (q, data) => {
    if (q.startsWith("Which supplied")) { assert.equal(data.candidates.length, 1); assert.equal(data.candidates[0].note, undefined); return { candidateIds: ["b", "b"] }; }
    return { spelling: "Name", classification: "Borrowed", reason: "Verified" };
  }, run: async () => ({ docs: [] }) }, []);
  assert.deepEqual(s.candidates.map((c) => c.text), ["Name", "Name"]); assert.equal(result.decisions.length, 1);
});
