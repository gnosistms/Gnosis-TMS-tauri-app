import test from "node:test";
import { studioDependentSteps, clearStudioDependents, startStudioReResearch, exactTargetOccurrences, studioSplitForms, mergeStudioGapForms } from "./glossary-research-studio-workflow.js";
import assert from "node:assert/strict";

import { newStudioStudy, exactOccurrences, deduplicatePassages, researchSample,
  approveStep, stepIsReusable, validateAssignments, routeSplits, finalUsage,
  stableSignature, buildStudioDraft, collisionChanges, uniqueSourceTexts, deduplicateSourceForms,
  selectedForms, sourceCollisions, reviseAssignment, entryBatchSignature, applySplitReview, studioContextRequest, applyStudioContext, studioStepStatusLabel,
  entryTrialsAreCurrent, reviewStudioFinding, applyStudioReviewOverrides, studioReviewOverride, applyStudioEntryEdit, studioSingleWordCandidates } from "./glossary-research-studio-workflow.js";

const scope = { sourceLanguage: { code: "es" }, targetLanguage: { code: "en" } };

test("changed upstream inputs preserve approved work and expose a review state, including prior Skip decisions", async () => {
  const s = newStudioStudy(scope, "changed-status");
  await approveStep(s, "4.6", { assignments: [{ meaningId: "m1" }] });
  for (const step of ["4.7", "5", "6", "7"]) await approveStep(s, step, step === "5" ? { skipped: true } : { summary: `Approved ${step}` });
  const prior = Object.fromEntries(["4.7", "5", "6", "7"].map((step) => [step, structuredClone(s.steps[step].approved)]));
  await approveStep(s, "4.6", { assignments: [{ meaningId: "m2" }] });
  for (const step of ["4.7", "5", "6", "7"]) {
    assert.deepEqual(s.steps[step].approved, prior[step]);
    assert.equal(await stepIsReusable(s, step), false);
    assert.match(studioStepStatusLabel(s.steps[step]), /needs review/);
  }
  assert.equal(studioStepStatusLabel(s.steps["5"]), "previously skipped; needs review");
  assert.equal(studioStepStatusLabel(undefined), "");
  assert.equal(studioStepStatusLabel({ status: "complete" }), "✓");
  assert.equal(studioStepStatusLabel({ status: "skipped" }), "skipped");
  assert.equal(studioStepStatusLabel({ status: "running" }), "in progress");
  assert.equal(studioStepStatusLabel({ status: "awaiting-review", value: { pending: true } }), "needs input");
  assert.equal(studioStepStatusLabel({ status: "awaiting-review", value: {} }), "ready for review");
});
test("wider source context validates identity, keeps counts and source spans, and invalidates affected evidence signatures", () => {
  const study = newStudioStudy(scope, "context");
  study.passages = deduplicatePassages([{ id: "p", text: "Una conclusión fatal", contextBefore: ["Near"], contextAfter: [],
    context_before: ["Near"], context_after: [], reference: { line_id: 16277, doc_id: "book-27", context_url: "/api/sample/context?line_id=16277&context=3" } }], ["fatal"]);
  study.meanings = [{ id: "m", definition: "deadly" }];
  study.assignments = [{ paragraphId: "p", occurrenceId: "o0", meaningId: "m" }];
  study.steps["8"] = { status: "approved" }; study.steps["9"] = { status: "approved" };
  const original = structuredClone(study.passages[0]);
  const beforeSignature = entryBatchSignature(study, study.passages, study.assignments);
  assert.deepEqual(studioContextRequest(original), { path: "/api/sample/context", params: { line_id: 16277, context: 3 } });
  const result = { line_id: 16277, doc_id: "book-27", text: original.text, context_before: ["Explicit earlier death", "Middle", "Near"], context_after: ["After"] };
  for (const change of [{ line_id: 16278 }, { doc_id: "other" }, { text: "Unrelated paragraph" }, { context_after: [null] }]) {
    assert.throws(() => applyStudioContext(study, "p", { ...result, ...change }), /does not match/);
    assert.deepEqual(study.passages[0], original);
  }
  assert.equal(applyStudioContext(study, "p", result), true);
  assert.equal(study.passages.length, 1); assert.equal(study.assignments.length, 1);
  assert.equal(study.passages[0].text, original.text);
  assert.deepEqual(study.passages[0].occurrences, original.occurrences);
  assert.deepEqual(study.passages[0].contextBefore, result.context_before);
  assert.deepEqual(study.passages[0].context_before, result.context_before);
  assert.deepEqual(study.passages[0].contextAfter, study.passages[0].context_after);
  assert.equal(study.assignmentReviewPending, true);
  assert.equal(study.steps["8"].status, "stale"); assert.equal(study.steps["9"].status, "stale");
  assert.notEqual(entryBatchSignature(study, study.passages, study.assignments), beforeSignature);
  assert.equal(applyStudioContext(study, "p", result), false);
  assert.deepEqual(study.expandedContextIds, ["p"]);
  assert.equal(studioContextRequest({ reference: { line_id: 7, context_url: "https://other/context" } }), null);
  assert.equal(studioContextRequest({ reference: { line_id: "16277", context_url: "/api/sample/context?line_id=16277" } }), null);
});
test("source forms ignore capitalization, preserve accents and keep the first spelling and user selection", async () => {
  assert.deepEqual(uniqueSourceTexts([" Mundo ", "mundo", "MUNDOS", "mundos", "íntimo", "i\u0301ntimo", "intimo"], "es"), ["Mundo", "MUNDOS", "íntimo", "intimo"]);
  assert.deepEqual(uniqueSourceTexts(["I", "ı", "İ", "i"], "tr"), ["I", "İ"]);
  const forms = [{ text: "Mundo", selected: false }, { text: "mundo", selected: true }, { text: "Mundos", selected: true }];
  assert.deepEqual(deduplicateSourceForms(forms, "es").map((f) => f.text), ["Mundo", "Mundos"]);
  assert.deepEqual(selectedForms({ scope, forms }), ["Mundos"]);
});
test("research samples use real lexical matches, cover forms, preserve duplicate references and seed", async () => {
  assert.equal(exactOccurrences("serpiente ser el Ser", ["ser", "el Ser"]).length, 2);
  const population = deduplicatePassages([
    { id: "a", text: "camina", reference: "first" }, { id: "b", text: "camina", reference: "copy" },
    { id: "c", text: "caminó" }, ...Array.from({ length: 200 }, (_, i) => ({ id: `x${i}`, text: `camina ${i}` })),
  ], ["camina", "caminó"]);
  assert.equal(population[0].references.length, 2);
  const sample = researchSample(population, ["camina", "caminó"], 3);
  assert.equal(sample.passages.length, 100);
  assert(sample.passages.some((p) => p.text === "caminó"));
  assert.deepEqual(sample, researchSample(population, ["camina", "caminó"], 3));
  assert.notDeepEqual(sample, researchSample(population, ["camina", "caminó"], 8));
});
test("Back/forward reuses approved results; changed upstream approvals invalidate descendants", async () => {
  const s = newStudioStudy(scope, "test");
  await approveStep(s, "1", { term: "ser" }); await approveStep(s, "2a", ["ser"]);
  assert(await stepIsReusable(s, "2a"));
  await approveStep(s, "1", { term: "ser" }); assert(await stepIsReusable(s, "2a"));
  await approveStep(s, "1", { term: "Ser" }); assert(!(await stepIsReusable(s, "2a")));
});
test("assignments require every occurrence exactly once, including multiple meanings in a paragraph", async () => {
  const passages = deduplicatePassages([{ id: "a", text: "ser el Ser" }], ["ser"]);
  const rows = passages[0].occurrences.map((o, i) => ({ paragraphId: "a", occurrenceId: o.id, meaningId: `m${i}` }));
  assert.equal(validateAssignments(passages, rows, ["m0", "m1"]).length, 2);
  assert.throws(() => validateAssignments(passages, rows.slice(1), ["m0", "m1"]));
  assert.throws(() => validateAssignments(passages, [rows[0], rows[0]], ["m0", "m1"]));
});
test("longest-first splitting routes only its occurrence and retains shared paragraph context", async () => {
  const s = newStudioStudy(scope, "test"); s.forms = [{ text: "ser" }];
  s.passages = deduplicatePassages([{ id: "p", text: "ser y el Ser" }], ["ser"]);
  s.meanings = [{ id: "verb" }, { id: "noun" }];
  s.assignments = [{ paragraphId: "p", occurrenceId: "o0", meaningId: "verb" },
    { paragraphId: "p", occurrenceId: "o1", meaningId: "noun" }];
  const result = routeSplits(s, [{ forms: ["el Ser"], meaningId: "noun" }]);
  assert.equal(result.queue.length, 1);
  assert.equal(result.assignments[0].entryId, "original");
  assert.equal(result.queue[0].passages[0].text, "ser y el Ser");
  assert.equal(result.meanings.find((m) => m.id === "noun").splitOff, true);
});
test("usage counts only final matching step-9 results and keeps explicit inflections separate", async () => {
  const s = newStudioStudy(scope, "test"); s.forms = [{ text: "caminar" }]; s.meanings = [{ id: "m" }];
  s.candidates = ["walk", "walked", "walking"].map((text, i) => ({ id: `c${i}`, text, confirmed: true, meaningIds: ["m"] }));
  s.passages = deduplicatePassages([{ id: "p", text: "caminar y caminar" }, { id: "q", text: "caminar" }], ["caminar"]);
  s.assignments = s.passages.flatMap((p) => p.occurrences.map((o) => ({ paragraphId: p.id, occurrenceId: o.id, meaningId: "m" })));
  s.tests = { old: { phase: "9", passed: true, signature: "obsolete", choices: [] },
    "9:0": { phase: "9", passed: true, signature: stableSignature(buildStudioDraft(s)), batchSignature: entryBatchSignature(s, s.passages, s.assignments), choices: [
      { paragraphId: "p", occurrenceId: "o0", candidateId: "c0" },
      { paragraphId: "p", occurrenceId: "o1", candidateId: "c0" },
      { paragraphId: "q", occurrenceId: "o0", candidateId: "c1" },
    ] } };
  assert.deepEqual(finalUsage(s), { c0: { occurrences: 2, paragraphs: 1 }, c1: { occurrences: 1, paragraphs: 1 }, c2: { occurrences: 0, paragraphs: 0 } });
});
test("collision staging supports mixed decisions without mutating old entries", async () => {
  const old = { termId: "old", sourceTerms: ["walk", "walked"], targetTerms: ["caminar"] };
  const updates = collisionChanges({ sourceTerms: ["walk"] }, [old], { walk: "overwrite", walked: "keep" });
  assert.deepEqual(updates[0].sourceTerms, ["walked"]);
  assert.deepEqual(old.sourceTerms, ["walk", "walked"]);
});

test("usage combines same-text candidate records and counts shared paragraphs once", async () => {
  const s = newStudioStudy(scope, "grouped-usage"); s.forms = [{ text: "mundo" }]; s.meanings = [{ id: "m" }];
  s.candidates = ["world", "world", "worlds"].map((text, i) => ({ id: `c${i}`, text, confirmed: true, meaningIds: ["m"] }));
  s.passages = deduplicatePassages([{ id: "p", text: "mundo y mundo" }, { id: "q", text: "mundo" }], ["mundo"]);
  s.assignments = s.passages.flatMap((p) => p.occurrences.map((o) => ({ paragraphId: p.id, occurrenceId: o.id, meaningId: "m" })));
  s.tests["9:0"] = { phase: "9", passed: true, signature: stableSignature(buildStudioDraft(s)),
    batchSignature: entryBatchSignature(s, s.passages, s.assignments), choices: [
      { paragraphId: "p", occurrenceId: "o0", candidateId: "c0" },
      { paragraphId: "p", occurrenceId: "o1", candidateId: "c1" },
      { paragraphId: "q", occurrenceId: "o0", candidateId: "c1" },
    ] };
  assert.deepEqual(finalUsage(s, { groupByText: true }), { world: { occurrences: 3, paragraphs: 2 }, worlds: { occurrences: 0, paragraphs: 0 } });
  s.generalNote = "Changed selection rules";
  assert.equal(finalUsage(s, { groupByText: true }).world.occurrences, 0);
});

test("split expressions spanning two original occurrences become one child occurrence", async () => {
  const s = newStudioStudy(scope, "test"); s.forms = [{ text: "ser" }];
  s.passages = deduplicatePassages([{ id: "p", text: "ser o no ser" }], ["ser"]);
  s.meanings = [{ id: "m" }];
  s.assignments = s.passages[0].occurrences.map((o) => ({ paragraphId: "p", occurrenceId: o.id, meaningId: "m" }));
  const result = routeSplits(s, [{ forms: ["ser o no ser"], meaningId: "m" }]);
  assert.equal(result.queue[0].assignments.length, 1);
  assert.equal(result.queue[0].passages[0].occurrences[0].surface, "ser o no ser");
  assert.deepEqual(result.queue[0].assignments[0].originOccurrences, ["o0", "o1"]);
  s.meanings.push({ id: "other" }); s.assignments[1].meaningId = "other";
  assert.throws(() => routeSplits(s, [{ forms: ["ser o no ser"], meaningId: "m" }]), /another meaning/);
});

test("approximate multilingual form recall does not weaken exact counting", async () => {
  const { rankResearchFormEvidence } = await import("./glossary-research-studio-workflow.js");
  const items = [{ text: "El Intimo habla." }, { text: "El Íntimo habla." }, { text: "La intimidación." }];
  assert.equal(rankResearchFormEvidence(items, "Íntimo", "es").length, 2);
  assert.equal(deduplicatePassages(items, ["Íntimo"], "es").length, 1);
  assert.equal(rankResearchFormEvidence([{ text: "le marche" }, { text: "le marché" }], "marche", "fr").length, 2);
});

test("declining a split restores its occurrences to the parent and split forms ignore capitalization", async () => {
  const { applySplitReview } = await import("./glossary-research-studio-workflow.js");
  const s = newStudioStudy(scope, "review"); s.forms = [{ text: "ser" }];
  s.passages = deduplicatePassages([{ id: "p", text: "ser y el Ser" }], ["ser"]);
  s.meanings = [{ id: "verb" }, { id: "noun" }];
  s.assignments = [{ paragraphId: "p", occurrenceId: "o0", meaningId: "verb" }, { paragraphId: "p", occurrenceId: "o1", meaningId: "noun" }];
  s.steps["4.6"] = { approved: structuredClone({ meanings: s.meanings, assignments: s.assignments }) };
  const proposals = [{ id: "noun", forms: ["el Ser", "el ser", "EL SER"], meaningId: "noun", targetTerms: ["the Being"], selected: true }];
  Object.assign(s, applySplitReview(s, proposals));
  assert.deepEqual(s.queue[0].forms, ["el Ser"]);
  assert.equal(s.meanings[1].splitOff, true);
  Object.assign(s, applySplitReview(s, [{ ...proposals[0], selected: false }]));
  assert.equal(s.queue.length, 0);
  assert.equal(s.meanings[1].splitOff, false);
  assert(s.assignments.every((a) => a.entryId === "original"));
});

test("candidate preference moves a shared target once across all meanings", async () => {
  const { preferCandidate } = await import("./glossary-research-studio-workflow.js");
  const s = newStudioStudy(scope, "priority");
  s.candidates = [{ id: "world-a", text: "world", meaningIds: ["a"] }, { id: "planet", text: "planet", meaningIds: ["b"] },
    { id: "world-c", text: "world", meaningIds: ["c"] }, { id: "planets", text: "planets", meaningIds: ["b"] }];
  preferCandidate(s, 3, true);
  preferCandidate(s, s.candidates.findIndex((c) => c.id === "planet"), true);
  assert.deepEqual(s.candidates.map((c) => c.text), ["planet", "planets", "world", "world"]);
  preferCandidate(s, 2);
  assert.deepEqual(s.candidates.map((c) => c.text), ["planet", "world", "world", "planets"]);
});


test("human occurrence corrections preserve context, recovery and split routing and update the approved baseline", async () => {
  const { applySplitReview } = await import("./glossary-research-studio-workflow.js");
  const s = newStudioStudy({ ...scope, term: "mundo" }, "review"); s.forms = [{ text: "mundo" }];
  s.passages = deduplicatePassages([{ id: "p", text: "mundo y mundo", recovered: true },
    { id: "q", text: "todo el mundo" }, { id: "r", text: "mundo" }], ["mundo"]);
  s.meanings = [{ id: "planet", definition: "Physical globe" }, { id: "realm", definition: "Realm" }, { id: "people", definition: "Everyone" }];
  s.assignments = [{ paragraphId: "p", occurrenceId: "o0", meaningId: "realm" }, { paragraphId: "p", occurrenceId: "o1", meaningId: "realm" },
    { paragraphId: "q", occurrenceId: "o0", meaningId: "people" }, { paragraphId: "r", occurrenceId: "o0", meaningId: "planet" }];
  await approveStep(s, "4.6", { meanings: s.meanings, assignments: s.assignments });
  s.splitProposals = [{ id: "everyone", forms: ["todo el mundo"], meaningId: "people", targetTerms: ["everyone"], selected: true }];
  Object.assign(s, applySplitReview(s, s.splitProposals));
  s.steps["8"] = { status: "complete" }; s.steps["9"] = { status: "complete" }; s.recoveryConsidered = 500;
  const paragraphs = structuredClone(s.passages); const split = structuredClone(s.queue);
  s.status = "complete";
  assert.equal(await reviseAssignment(s, "p", "o0", "planet"), true);
  assert.deepEqual(s.assignments.filter((a) => a.paragraphId === "p").map((a) => a.meaningId), ["planet", "realm"]);
  assert.equal(s.steps["4.6"].approved.assignments[0].meaningId, "planet");
  assert.equal(applySplitReview(s, s.splitProposals).assignments[0].meaningId, "planet");
  assert.deepEqual(s.passages, paragraphs); assert.deepEqual(s.queue, split); assert.equal(s.recoveryConsidered, 500);
  assert.equal(s.assignmentRevision, 1); assert.equal(s.assignmentReviewPending, true); assert.equal(s.steps["8"].status, "stale");
  assert.equal(s.status, "active");
  assert.equal(await reviseAssignment(s, "p", "o0", "planet"), false); assert.equal(s.assignmentRevision, 1);
  await assert.rejects(() => reviseAssignment(s, "q", "o0", "planet"), /own study/u);
});


test("collision staging matches capitalization while retaining exact old variants for atomic edits", async () => {
  const old = { termId: "old", sourceTerms: ["Hooltampanas", "Other"], targetTerms: ["Hooltanpanas"] };
  const changes = collisionChanges({ sourceTerms: ["hooltampanas"] }, [old], { hooltampanas: "overwrite" });
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].sourceTerms, ["Other"]);
  assert.deepEqual(changes[0].expected.sourceTerms, ["Hooltampanas", "Other"]);
  assert.deepEqual(old.sourceTerms, ["Hooltampanas", "Other"]);
});


test("one collision choice covers all matching entries, preserving accents and excluding the saved entry", async () => {
  const s = newStudioStudy(scope, "case-collisions"); s.forms = [{ text: "Íntimo" }, { text: "fatal" }]; s.savedTermId = "self";
  const entries = [{ termId: "a", sourceTerms: ["íntimo", "ÍNTIMO"] }, { termId: "b", sourceTerms: ["Íntimo"] },
    { termId: "accent", sourceTerms: ["intimo"] }, { termId: "self", sourceTerms: ["fatal"] },
    { termId: "longer-phrase", sourceTerms: ["el Íntimo", "destino fatal"] },
    { termId: "deleted", lifecycleState: "deleted", sourceTerms: ["fatal"] }];
  const collisions = sourceCollisions(s, entries);
  assert.deepEqual(collisions.map((c) => c.form), ["Íntimo"]);
  assert.deepEqual(collisions[0].entries.map((e) => e.termId), ["a", "b"]);
});


test("human review can give a report-only meaning its first corpus example", async () => {
  const s = newStudioStudy({ ...scope, term: "sensible" }, "report-only-review"); s.forms = [{ text: "sensible" }];
  s.passages = deduplicatePassages([{ id: "p", text: "receptividad sensible" }], ["sensible"]);
  s.meanings = [{ id: "perceptible", definition: "Perceptible", unused: false },
    { id: "sensory", definition: "Sensory receptivity", unused: true }, { id: "excluded", definition: "Unconfirmed", enabled: false }];
  s.assignments = [{ paragraphId: "p", occurrenceId: "o0", meaningId: "perceptible" }];
  await approveStep(s, "4.6", { meanings: s.meanings, assignments: s.assignments });
  assert.equal(await reviseAssignment(s, "p", "o0", "sensory"), true);
  assert.equal(s.assignments[0].meaningId, "sensory");
  assert.equal(s.meanings.find((m) => m.id === "sensory").unused, false);
  assert.equal(s.meanings.find((m) => m.id === "perceptible").unused, true);
  assert.equal(s.steps["4.6"].approved.meanings.find((m) => m.id === "sensory").unused, false);
  assert.equal(s.assignmentReviewPending, true);
  await assert.rejects(() => reviseAssignment(s, "p", "o0", "excluded"), /enabled meaning/);
  assert.equal(s.passages[0].text, "receptividad sensible");
});


test("split routing admits only exact witnessed forms and preserves researched children when unwitnessed aliases are removed", async () => {
  const s = newStudioStudy({ ...scope, term: "sensible" }, "split-witness"); s.forms = [{ text: "sensible" }];
  s.passages = deduplicatePassages([{ id: "p", text: "placa muy sensible" }], ["sensible"]);
  s.meanings = [{ id: "m", definition: "Sensitive to light" }];
  s.assignments = [{ paragraphId: "p", occurrenceId: "o0", meaningId: "m" }];
  await approveStep(s, "4.6", { meanings: s.meanings, assignments: s.assignments });
  const proposals = [{ id: "plate", forms: ["placa sensible", "placa muy sensible"], meaningId: "m" },
    { id: "nerves", forms: ["nervios sensibles"], meaningId: "m" }];
  const first = routeSplits(s, proposals);
  assert.equal(first.queue.length, 1);
  assert.deepEqual(first.queue[0].forms, ["placa muy sensible"]);
  assert.equal(first.queue[0].assignments.length, 1);
  s.queue = [{ ...first.queue[0], forms: ["placa sensible", "placa muy sensible"], studyId: "saved-child", status: "saved" }];
  const result = applySplitReview(s, proposals);
  assert.equal(result.queue[0].studyId, "saved-child");
  assert.equal(result.queue[0].status, "saved");
  assert.deepEqual(result.queue[0].forms, ["placa muy sensible"]);
  assert.deepEqual(s.passages[0].text, "placa muy sensible");
});


test("large source evidence is retained once per report rather than copied into each checkpoint signature", async () => {
  const s = newStudioStudy(scope, "large-checkpoints");
  const evidence = { text: "Whole source quotation á漢字 ".repeat(20000), reference: { book: "Original", line: 42 } };
  await approveStep(s, "4.4.1", { evidence });
  const report = structuredClone(s.steps["4.4.1"].approved);
  for (const step of ["4.4.2", "4.4.4", "4.5", "4.6", "4.7", "5", "6", "7", "8", "9"]) await approveStep(s, step, { complete: true });
  assert.equal(await stepIsReusable(s, "9"), true);
  assert(s.steps["9"].signature.length <= 71, "comparison signatures must have bounded size");
  assert(JSON.stringify(s.steps).length < JSON.stringify(report).length + 15000, "later checkpoints must not duplicate the source evidence");
  assert.deepEqual(s.steps["4.4.1"].approved, report);
  await approveStep(s, "4.4.1", { evidence: { ...evidence, text: evidence.text + " corrected" } });
  assert.equal(await stepIsReusable(s, "9"), false);
});


test("legacy checkpoint compaction preserves Unicode evidence, historical inputs, statuses and reuse", async () => {
  const { compactStudioStepSignatures, stepInput } = await import("./glossary-research-studio-workflow.js");
  const { createHash } = await import("node:crypto");
  const s = newStudioStudy(scope, "legacy-checkpoints");
  s.steps["4.4.1"] = { approved: { evidence: "Original whole quotation á漢字🙂".repeat(10000) }, status: "complete" };
  const historical = stableSignature(stepInput(s, "5"));
  s.steps["5"] = { approved: { compounds: [] }, value: { compounds: [] }, status: "complete", signature: historical, generatedSignature: historical };
  const original = structuredClone(s);
  assert.equal(await stepIsReusable(s, "5"), true);
  await compactStudioStepSignatures(s);
  const expected = `sha256:${createHash("sha256").update(historical).digest("hex")}`;
  assert.equal(s.steps["5"].legacySignatures.signature, expected);
  assert.equal(s.steps["5"].legacySignatures.generatedSignature, expected);
  const migratedSignature = s.steps["5"].signature;
  assert.equal(await stepIsReusable(s, "5"), true);
  assert.equal(await approveStep(s, "5", { compounds: [] }), false);
  assert.deepEqual(s.steps["4.4.1"].approved, original.steps["4.4.1"].approved);
  assert.equal(s.steps["4.4.1"].status, original.steps["4.4.1"].status);
  assert.deepEqual(s.steps["5"].approved, original.steps["5"].approved);
  const compact = structuredClone(s); await compactStudioStepSignatures(s); assert.deepEqual(s, compact);
  await approveStep(s, "4.4.1", { evidence: s.steps["4.4.1"].approved.evidence + " changed" });
  assert.equal(await stepIsReusable(s, "5"), false);
  await compactStudioStepSignatures(s);
  assert.equal(s.steps["5"].signature, migratedSignature, "compaction must never bless today's changed inputs");
  assert.equal(await stepIsReusable(s, "5"), false);
  assert.equal(s.steps["5"].status, "stale");
});

test("approving hydrated evidence compares the saved digest and rejects preview-only edits", async () => {
  const s = newStudioStudy(scope, "cold-approval");
  const full = { assignments: [{ paragraphId: "p", occurrenceId: "o0", meaningId: "m1" }] };
  await approveStep(s, "4.6", full);
  s.steps["8"] = { status: "complete" };
  s.steps["4.6"].approved = { _studioArtifact: "a".repeat(64), assignments: structuredClone(full.assignments) };
  const cold = structuredClone(s.steps["4.6"].approved);
  await assert.rejects(approveStep(s, "4.6", cold), /Reopen this step/);
  assert.equal(await approveStep(s, "4.6", full), false);
  assert.equal(s.steps["8"].status, "complete");
  const changed = structuredClone(full); changed.assignments[0].meaningId = "m2";
  assert.equal(await approveStep(s, "4.6", changed), true);
  assert.equal(s.steps["8"].status, "stale");
});

test("revising candidate research removes dependent tests, retention and save drafts, preserving source research", async () => {
  const s = newStudioStudy(scope, "redo-candidates");
  s.forms = [{ text: "walk" }]; s.meanings = [{ id: "m1", definition: "Move on foot" }];
  s.assignments = [{ paragraphId: "p1", occurrenceId: "o0", meaningId: "m1" }];
  s.candidates = [{ id: "c1", text: "đi bộ", confirmed: true, retained: false, meaningIds: ["m1"] }];
  for (const id of ["4.5", "4.6", "6", "7", "8", "9", "10a", "10b", "11"]) await approveStep(s, id, { complete: true });
  const before = structuredClone({ forms: s.forms, meanings: s.meanings, assignments: s.assignments, source: s.steps["4.6"] });
  s.tests = { "8:m1": { passed: true }, "9:0": { passed: true } }; s.rounds = { "8:m1": 5, "9:0": 3 };
  s.reports = { "m1:5": { continued: true } }; s.retentionReviewed = true;
  s.usage = { c1: { occurrences: 3 } }; s.draft = { targetTerms: ["đi bộ"] };
  s.collisions = { walk: "overwrite" }; s.status = "complete"; s.savedTermId = "existing-term";
  s.pendingDecision = { kind: "selection" }; s.entryValidation = { phase: "complete" };
  assert(studioDependentSteps(s, "6").includes("11"));
  clearStudioDependents(s, "6");
  assert.deepEqual({ forms: s.forms, meanings: s.meanings, assignments: s.assignments, source: s.steps["4.6"] }, before);
  for (const id of ["7", "8", "9", "10a", "10b", "11"]) {
    assert.deepEqual(s.steps[id], { status: "undone" });
    assert.equal(studioStepStatusLabel(s.steps[id]), "undone");
    assert.equal(await stepIsReusable(s, id), false);
  }
  assert.deepEqual(s.tests, {}); assert.deepEqual(s.rounds, {}); assert.deepEqual(s.reports, {});
  assert.equal(s.pendingDecision, null); assert.equal(s.draft, null); assert.equal(s.usage, undefined);
  assert.equal(s.retentionReviewed, false); assert.deepEqual(s.collisions, {});
  assert.equal(s.entryValidation, null); assert.equal(s.candidates[0].text, "đi bộ");
  assert.equal(s.candidates[0].confirmed, false); assert.equal(s.candidates[0].retained, true);
  assert.equal(s.savedTermId, "existing-term"); assert.equal(s.status, "active");
  assert.deepEqual(studioDependentSteps(s, "6"), []);
});

test("revising source forms clears discovery outputs including skipped checkpoints and cold reports", () => {
  const s = newStudioStudy(scope, "redo-source");
  s.steps["1"] = { status: "complete", approved: { term: "walk" } };
  s.steps["2a"] = { status: "complete", value: { forms: [] } };
  s.steps["4.1"] = { status: "skipped", approved: { skipped: true } };
  s.steps["4.4.1"] = { status: "complete", value: { _studioArtifact: "a".repeat(64) } };
  s.population = { _studioArtifact: "b".repeat(64) }; s.passages = { _studioArtifact: "c".repeat(64) };
  s.meanings = [{ id: "old-meaning" }]; s.assignments = [{ meaningId: "old-meaning" }];
  s.candidates = [{ text: "old-translation" }]; s.queue = [{ studyId: "separate-child" }];
  s.forms = [{ text: "walk", selected: true }]; s.skipRecommendations = { "4.1": { recommendation: "Skip" } };
  s.branch = "separate";
  const scopeBefore = structuredClone(s.scope);
  clearStudioDependents(s, "2a");
  assert.deepEqual(s.scope, scopeBefore); assert.deepEqual(s.forms, [{ text: "walk", selected: true }]);
  assert.equal(s.branch, "research", "2b defaults to researching with the related entries");
  for (const key of ["population", "passages", "meanings", "assignments", "candidates", "queue"]) assert.deepEqual(s[key], []);
  assert.deepEqual(s.skipRecommendations, {}); assert.deepEqual(s.steps["4.1"], { status: "undone" });
  assert.equal(s.steps["1"].status, "complete");
});

test("re-researching an existing entry whose forms 2a already listed continues past 2b without rerunning 2a", () => {
  const s = newStudioStudy({ ...scope, term: "mundo", forms: ["mundo"] }, "re-research");
  // 2a discovered "mundos" and the researcher left it unchecked.
  s.forms = [{ text: "mundo", selected: true }, { text: "mundos", selected: false }];
  const existing = { termId: "t", sourceTerms: ["Mundo", "mundos"], targetTerms: ["world"], targetVariantNotes: ["Usual"] };
  s.step = "2b"; s.relatedEntries = [existing];
  const reviewed = { status: "complete", approved: { forms: s.forms } };
  s.steps["2a"] = reviewed;
  s.steps["2b"] = { status: "awaiting-review", value: { entries: [existing] } };
  assert.equal(startStudioReResearch(s), false);
  assert.equal(s.steps["2a"], reviewed);
  assert.deepEqual(s.scope.forms, ["mundo"], "the scope stays unchanged so 2a is not marked stale");
  assert.deepEqual(s.forms, [{ text: "mundo", selected: true }, { text: "mundos", selected: false }]);
  assert.equal(s.branch, "research");
  assert.deepEqual(s.carriedTargets, [{ text: "world", note: "Usual", originTermId: "t" }]);
});

test("re-researching an existing entry with a form 2a has not listed reruns 2a once and then continues past 2b", () => {
  const s = newStudioStudy({ ...scope, term: "mundo", forms: ["mundo"] }, "re-research");
  s.forms = [{ text: "mundo", selected: true }];
  const existing = { termId: "t", sourceTerms: ["mundo", "mundial"], targetTerms: ["world"], targetVariantNotes: ["Usual"] };
  s.step = "2b"; s.relatedEntries = [existing];
  s.steps["2a"] = { status: "complete", approved: { forms: s.forms } };
  s.steps["2b"] = { status: "awaiting-review", value: { entries: [existing] } };
  assert.equal(startStudioReResearch(s), true);
  assert.deepEqual(studioDependentSteps(s, "2a"), [], "rerunning 2a must not offer a redo that resets this choice");
  assert.equal(s.steps["2a"], undefined);
  assert.deepEqual(s.scope.forms, ["mundo", "mundial"]);
  assert.equal(s.branch, "research");
  assert.deepEqual(s.carriedTargets, [{ text: "world", note: "Usual", originTermId: "t" }]);
  // 2a and 2b run again and find the same entry.
  s.forms = [{ text: "mundo", selected: true }, { text: "mundial", selected: true }];
  s.step = "2b"; s.relatedEntries = [existing];
  assert.equal(startStudioReResearch(s), false);
  assert.deepEqual(s.scope.forms, ["mundo", "mundial"]);
});

function reviewedStudy() {
  const s = newStudioStudy(scope, "reviewed"); s.forms = [{ text: "caminar" }]; s.meanings = [{ id: "m" }];
  s.candidates = [{ id: "c0", text: "walk", confirmed: true, meaningIds: ["m"] }];
  s.passages = deduplicatePassages([{ id: "p", text: "caminar lejos" }, { id: "q", text: "caminar cerca" }], ["caminar"]);
  s.assignments = s.passages.flatMap((p) => p.occurrences.map((o) => ({ paragraphId: p.id, occurrenceId: o.id, meaningId: "m" })));
  s.tests["9:0"] = { phase: "9", passed: false, signature: stableSignature(buildStudioDraft(s)),
    batchSignature: entryBatchSignature(s, s.passages, s.assignments),
    translations: [{ paragraphId: "p", translation: "stroll far" }, { paragraphId: "q", translation: "walk near" }],
    choices: [{ paragraphId: "p", occurrenceId: "o0", candidateId: null, passed: false, problem: "No confirmed candidate" },
      { paragraphId: "q", occurrenceId: "o0", candidateId: "c0", passed: true, problem: "" }] };
  return s;
}

test("an accepted translation overrules the reviewer for that exact text until undone", () => {
  const s = reviewedStudy();
  assert.equal(entryTrialsAreCurrent(s), false);
  assert.equal(reviewStudioFinding(s, "accept", "p", "o0"), "9:0");
  const choice = s.tests["9:0"].choices[0];
  assert.deepEqual([choice.passed, choice.reviewerPassed, choice.override, choice.problem], [true, false, "accepted", "No confirmed candidate"]);
  assert.equal(entryTrialsAreCurrent(s), true);
  assert.deepEqual(finalUsage(s), { c0: { occurrences: 1, paragraphs: 1 } }, "an accepted rendering without a listed candidate is not usage evidence");
  const retranslated = applyStudioReviewOverrides(s, { translations: [{ paragraphId: "p", translation: "walk far" }],
    choices: [{ paragraphId: "p", occurrenceId: "o0", passed: false, problem: "Wrong meaning" }] });
  assert.equal(retranslated.passed, false, "a different translation of the paragraph is reviewed again");
  reviewStudioFinding(s, "undo", "p", "o0");
  assert.deepEqual(s.acceptedTranslations, {});
  assert.equal(s.tests["9:0"].passed, false);
  assert.deepEqual(s.tests["9:0"].choices[0], { paragraphId: "p", occurrenceId: "o0", candidateId: null, passed: false, problem: "No confirmed candidate" });
});

test("an ignored paragraph no longer decides the test or counts as usage, without being called correct", () => {
  const s = reviewedStudy();
  reviewStudioFinding(s, "ignore", "p", "o0");
  assert.deepEqual(s.ignoredTestParagraphIds, ["p"]);
  assert.deepEqual([s.tests["9:0"].passed, s.tests["9:0"].choices[0].override, s.tests["9:0"].choices[0].reviewerPassed], [true, "ignored", false]);
  assert.equal(studioReviewOverride(s, "p", "o0", "any later translation"), "ignored");
  assert.deepEqual(finalUsage(s), { c0: { occurrences: 1, paragraphs: 1 } });
  reviewStudioFinding(s, "undo", "p", "o0");
  assert.deepEqual([s.ignoredTestParagraphIds, s.tests["9:0"].passed], [[], false]);
  s.generalNote = "Edited after the test";
  assert.throws(() => reviewStudioFinding(s, "accept", "p", "o0"), /no longer part of the current test/);
});

function entryStudy() {
  const s = newStudioStudy(scope, "entry-edit"); s.forms = [{ text: "antítesis" }];
  s.meanings = [{ id: "m1" }, { id: "m2" }];
  s.candidates = [
    { id: "a", text: "antithesis", note: "Logic.", confirmed: true, retained: true, meaningIds: ["m1"] },
    { id: "b", text: "opposite", note: "Plain.", confirmed: true, retained: true, meaningIds: ["m2"] },
    { id: "c", text: "contrast", note: "", confirmed: true, retained: true, meaningIds: ["m2"] },
  ];
  s.generalNote = "General.";
  return s;
}

test("term editor changes reorder, rename, add and remove the study's translations", () => {
  const s = entryStudy();
  applyStudioEntryEdit(s, { targetTerms: ["contrasting", "antithesis", "polar opposite"],
    targetVariantNotes: ["", "Logic and philosophy.", "Opposed poles."], notesToTranslators: "Edited.", footnote: "Foot." }, "m1");
  const draft = buildStudioDraft(s);
  assert.deepEqual(draft.targetTerms, ["contrasting", "antithesis", "polar opposite"]);
  assert.deepEqual(draft.targetVariantNotes, ["", "Logic and philosophy.", "Opposed poles."]);
  assert.deepEqual([draft.notesToTranslators, draft.footnote], ["Edited.", "Foot."]);
  assert.equal(s.candidates.find((c) => c.id === "b").confirmed, false, "a removed translation stays in the study unconfirmed");
  assert.deepEqual(s.candidates.find((c) => c.id === "c").meaningIds, ["m2"], "an in-place text change keeps its meaning");
  assert.deepEqual(s.candidates.find((c) => c.text === "contrasting").meaningIds, ["m1"], "a new translation joins the finding's meaning");
});

test("term editor changes keep every meaning translated and leave the study unchanged when refused", () => {
  const s = entryStudy();
  const before = structuredClone(s.candidates);
  assert.throws(() => applyStudioEntryEdit(s, { targetTerms: ["antithesis"], targetVariantNotes: ["Logic."] }, "m1"), /Meaning 2 would have no translation/);
  assert.throws(() => applyStudioEntryEdit(s, { targetTerms: ["antithesis", ""], targetVariantNotes: [] }, "m1"), /empty translation/);
  assert.deepEqual([s.candidates, s.generalNote], [before, "General."]);
});

test("step 8 has nothing to choose only with one meaning and one candidate word", () => {
  const s = newStudioStudy(scope, "single-word");
  s.meanings = [{ id: "m" }, { id: "off", enabled: false }];
  s.candidates = [{ id: "a", text: "walk", meaningIds: ["m"] }, { id: "x", text: "go", meaningIds: ["off"] }];
  assert.deepEqual(studioSingleWordCandidates(s).map((c) => c.id), ["a"]);
  s.candidates = [{ id: "a", text: "walk", groupId: "g", meaningIds: ["m"] }, { id: "b", text: "walked", groupId: "g", meaningIds: ["m"] },
    { id: "c", text: "stroll", selected: false, meaningIds: ["m"] }];
  assert.deepEqual(studioSingleWordCandidates(s).map((c) => c.id), ["a", "b"], "inflections of one word, ignoring an unselected word");
  s.candidates.push({ id: "d", text: "stride", meaningIds: ["m"] });
  assert.equal(studioSingleWordCandidates(s), null, "two words leave a choice");
  s.candidates = [{ id: "a", text: "walk", meaningIds: ["m", "n"] }]; s.meanings.push({ id: "n" });
  assert.equal(studioSingleWordCandidates(s), null, "two meanings are tested separately");
});

test("split forms open one more gap between words and merge into one gapped form", () => {
  assert.deepEqual(studioSplitForms("a b c"), ["a … b c", "a b … c"]);
  assert.deepEqual(studioSplitForms("a … b c"), ["a … b … c"]);
  assert.deepEqual(studioSplitForms("word"), []);
  assert.equal(mergeStudioGapForms("a b c", "a … b c"), "a … b c");
  assert.equal(mergeStudioGapForms("a … b c", "a b … c"), "a … b … c");
  assert.equal(mergeStudioGapForms("a b c", "x … y"), "a b c");
  const text = "Có sự giằng co dữ dội giữa các mặt đối lập.";
  assert.deepEqual(exactTargetOccurrences(text, ["sự giằng co … giữa các mặt đối lập"], "vi").map((o) => o.surface), ["sự giằng co dữ dội giữa các mặt đối lập"]);
  assert.deepEqual(exactTargetOccurrences(text, ["sự giằng co giữa các mặt đối lập"], "vi"), []);
});
