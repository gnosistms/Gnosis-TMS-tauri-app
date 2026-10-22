import test from "node:test";
import assert from "node:assert/strict";

const calls = [];
let jobNumber = 0;
let startJob = async () => `job-${++jobNumber}`;
let nativeJob = async () => ({ complete: true, value: { termIds: [] } });
globalThis.window = { __TAURI__: { core: { invoke: async (command, args) => {
  calls.push({ command, args });
  return command === "start_glossary_studio_tool" ? startJob(args) : nativeJob(args);
} } } };
const { createStudioTools } = await import("./glossary-research-studio-tools.js");

test("AI instructions stay in the request while progress uses a short stage label", async () => {
  const messages = [];
  const study = { id: "test", step: "2b", cache: {}, scope: { installationId: 7, glossaryId: "g",
    sourceLanguage: { name: "Spanish" }, targetLanguage: { name: "English" } }, model: { providerId: "openai", modelId: "test" } };
  const tools = createStudioTools(study, { persist: async () => {}, progress: (message) => messages.push(message), isCurrent: () => true });
  const question = "Identify existing entries. Return only supplied IDs. This instruction belongs in the model request.";
  await tools.ask(question, { term: "mundo" }, '{"termIds":[]}');
  assert.deepEqual(messages, ["Checking existing glossary entries"]);
  assert(calls.find((c) => c.command === "start_glossary_studio_tool").args.input.payload.prompt.includes(question));
  await tools.ask("Another question", {}, "{}", "Reviewing a specific source");
  assert.equal(messages.at(-1), "Reviewing a specific source");
});

test("pausing consumes a native job only once and later navigation can cancel safely", async () => {
  let consumed = false; let cancellations = 0;
  let signalStarted; const started = new Promise((resolve) => { signalStarted = resolve; });
  const previousStart = startJob;
  startJob = async () => { signalStarted(); return `job-${++jobNumber}`; };
  nativeJob = async ({ cancel }) => {
    if (consumed) throw new Error("Research was interrupted. Resume the saved study.");
    assert.equal(cancel, true); cancellations += 1; consumed = true;
    return { complete: true };
  };
  const s = { id: "test", step: "8", cache: {}, scope: { installationId: 7, glossaryId: "g" } };
  const tools = createStudioTools(s, { persist: async () => {}, progress: () => {}, isCurrent: () => true });
  const running = assert.rejects(tools.run("ai", { prompt: "test" }), /Research paused/);
  await started;
  await tools.cancel(); await running;
  startJob = previousStart;
  await tools.cancel(); await tools.cancel();
  assert.equal(cancellations, 1);
});

test("a consumed failed result does not leave a stale job blocking later navigation", async () => {
  let polls = 0;
  nativeJob = async () => { polls += 1; throw new Error(polls === 1 ? "AI request failed" : "Research was interrupted"); };
  const s = { id: "test", step: "8", cache: {}, scope: { installationId: 7, glossaryId: "g" } };
  const tools = createStudioTools(s, { persist: async () => {}, progress: () => {}, isCurrent: () => true });
  await assert.rejects(tools.run("ai", { prompt: "test" }), (error) => {
    assert.match(error.message, /AI request failed/); assert.equal(error.studioToolSignature, s.lastToolSignature); return true;
  });
  await tools.cancel(); assert.equal(polls, 1);
});

test("DLE lookups bypass legacy failed study caches and then reuse the new result", async () => {
  const { stableSignature } = await import("./glossary-research-studio-workflow.js");
  const legacy = `${stableSignature({ version: 1, kind: "dle", payload: { path: "fatal" } })}:retry:0`;
  const study = { id: "dictionary-test", step: "4.1", cache: { [legacy]: { value: { status: "unreachable" } } }, scope: { installationId: 7, glossaryId: "g" } };
  const result = { status: "found", cache: { reused: true }, entry: { kind: "articles" } };
  nativeJob = async () => ({ complete: true, value: result });
  const before = calls.filter((c) => c.command === "start_glossary_studio_tool").length;
  const tools = createStudioTools(study, { persist: async () => {}, progress: () => {}, isCurrent: () => true });
  assert.deepEqual(await tools.run("dle", { path: "fatal" }), result);
  assert.equal(calls.findLast((c) => c.command === "start_glossary_studio_tool").args.input.payload.sourceCacheVersion, 1);
  assert.deepEqual(await tools.run("dle", { path: "fatal" }), result);
  assert.equal(calls.filter((c) => c.command === "start_glossary_studio_tool").length, before + 1);
  assert.equal(study.cache[legacy].value.status, "unreachable");
});

test("outbound evidence removes exact paragraph aliases while preserving unique references and contexts", async () => {
  nativeJob = async () => ({ complete: true, value: {} });
  const reference = { book: "Libro", line: 12 };
  const paragraph = { id: "p1", text: "Texto completo. Segunda oración.", reference,
    representative: { line: 12, book: "Libro" }, references: [reference], copies: [reference],
    contextBefore: "Antes.", context_before: "Antes.", contextAfter: "Después.", context_after: "Después.",
    occurrences: [{ id: "p1:o0", start: 0, end: 5 }] };
  const different = { ...paragraph, id: "p2", representative: { book: "Otro libro", line: 8 },
    references: [reference, { book: "Otra edición" }], context_before: "Otro contexto." };
  const evidence = { paragraphs: [paragraph, different], metadata: { reference, representative: reference } };
  const original = structuredClone(evidence);
  const study = { id: "compact-test", step: "6", cache: {}, scope: { installationId: 7, glossaryId: "g",
    sourceLanguage: { name: "Spanish" }, targetLanguage: { name: "Vietnamese" } }, model: {} };
  const tools = createStudioTools(study, { persist: async () => {}, progress: () => {}, isCurrent: () => true });
  await tools.ask("Research", evidence, "{}");
  const prompt = calls.findLast((c) => c.command === "start_glossary_studio_tool").args.input.payload.prompt;
  const sent = JSON.parse(prompt.split("Evidence:\n")[1]);
  assert.deepEqual(sent.paragraphs[0], { id: paragraph.id, text: paragraph.text, reference,
    contextBefore: paragraph.contextBefore, contextAfter: paragraph.contextAfter, occurrences: paragraph.occurrences });
  assert.deepEqual(sent.paragraphs[1].references, different.references);
  assert.deepEqual(sent.paragraphs[1].copies, different.copies);
  assert.deepEqual(sent.paragraphs[1].representative, different.representative);
  assert.equal(sent.paragraphs[1].context_before, different.context_before);
  assert.deepEqual(sent.metadata, evidence.metadata);
  assert.deepEqual(evidence, original);
});

test("tool diagnostics survive the result cache without extra requests or extra persistence", async () => {
  const nativeMetrics = { executionMs: 1200, aiOperationMs: 1100, toolCacheHit: false,
    usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 60 }, output_tokens: 20 } };
  nativeJob = async () => ({ complete: true, value: { ok: true }, metrics: nativeMetrics });
  const study = { id: "metrics-test", step: "9", cache: {}, scope: { installationId: 7, glossaryId: "g" } };
  const saves = [];
  const tools = createStudioTools(study, { persist: async () => { saves.push(structuredClone(study)); },
    progress: () => {}, isCurrent: () => true });
  const before = calls.length;
  assert.deepEqual(await tools.run("ai", { prompt: "Test" }), { ok: true });
  const record = Object.values(study.cache)[0];
  assert.deepEqual(record.metrics.usage, nativeMetrics.usage);
  assert.equal(record.metrics.executionMs, 1200);
  assert(record.metrics.roundTripMs >= 0);
  assert(record.metrics.persistMs >= 0);
  assert.equal(saves.length, 1);
  await tools.checkpoint("Saved normally");
  assert.deepEqual(Object.values(saves[1].cache)[0].metrics, record.metrics);
  assert.deepEqual(await tools.run("ai", { prompt: "Test" }), { ok: true });
  assert.equal(calls.length, before + 2);
  assert.equal(saves.length, 2);
});

test("legacy native receipts without diagnostics still resume normally", async () => {
  nativeJob = async () => ({ complete: true, value: { ok: "legacy" } });
  const study = { id: "legacy-test", step: "9", cache: {}, scope: { installationId: 7, glossaryId: "g" } };
  const tools = createStudioTools(study, { persist: async () => {}, progress: () => {}, isCurrent: () => true });
  assert.deepEqual(await tools.run("ai", { prompt: "Test" }), { ok: "legacy" });
  assert.equal(Object.values(study.cache)[0].metrics.usage, undefined);
});

test("Pause cancels every concurrent native job once", async () => {
  const cancelled = []; let count = 0; let signalStarted;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const previousStart = startJob;
  startJob = async (args) => { const id = await previousStart(args); if (++count === 2) signalStarted(); return id; };
  nativeJob = async ({ jobId, cancel }) => {
    assert.equal(cancel, true); cancelled.push(jobId); return { complete: true };
  };
  const study = { id: "parallel-pause", step: "4.6", cache: {}, scope: { installationId: 7, glossaryId: "g" } };
  const tools = createStudioTools(study, { persist: async () => {}, progress: () => {}, isCurrent: () => true });
  try {
    const pending = [1, 2].map((batch) => assert.rejects(tools.run("translate", { batch }), /Research paused/));
    await started; await tools.cancel(); await Promise.all(pending); await tools.cancel();
    assert.equal(cancelled.length, 2); assert.equal(new Set(cancelled).size, 2); assert.deepEqual(study.cache, {});
  } finally { startJob = previousStart; }
});

test("a job whose start finishes after Pause is also cancelled", async () => {
  let finishStart; let observedStart; const cancelled = [];
  const started = new Promise((resolve) => { observedStart = resolve; });
  startJob = () => new Promise((resolve) => { finishStart = resolve; observedStart(); });
  nativeJob = async ({ jobId, cancel }) => { assert.equal(cancel, true); cancelled.push(jobId); return { complete: true }; };
  const study = { id: "late-start", step: "4.6", cache: {}, scope: { installationId: 7, glossaryId: "g" } };
  const tools = createStudioTools(study, { persist: async () => {}, progress: () => {}, isCurrent: () => true });
  try {
    const pending = assert.rejects(tools.run("translate", { batch: 1 }), /Research paused/);
    await started;
    await tools.cancel();
    finishStart("late-job");
    await pending;
    assert.deepEqual(cancelled, ["late-job"]);
    assert.deepEqual(study.cache, {});
  } finally { startJob = async () => `job-${++jobNumber}`; }
});

test("preliminary batches persist each tool result once and progress does not add full-study saves", async () => {
  const { prepareReadingTranslations } = await import("./glossary-research-studio-stages.js");
  const { newStudioStudy, deduplicatePassages } = await import("./glossary-research-studio-workflow.js");
  const study = newStudioStudy({ installationId: 7, glossaryId: "g", term: "walk",
    sourceLanguage: { code: "en", name: "English" }, targetLanguage: { code: "vi", name: "Vietnamese" } }, "progress-saves");
  study.step = "4.6"; study.model = {};
  study.passages = deduplicatePassages(Array.from({ length: 31 }, (_, i) => ({ id: `p${i}`, text: `walk ${i}` })), ["walk"], "en");
  study.meanings = [{ id: "m" }];
  study.assignments = study.passages.flatMap((p) => p.occurrences.map((o) => ({ paragraphId: p.id, occurrenceId: o.id, meaningId: "m" })));
  const jobs = new Map(); const messages = []; let saves = 0;
  startJob = async ({ input }) => { const id = `job-${++jobNumber}`; jobs.set(id, input.payload); return id; };
  nativeJob = async ({ jobId }) => ({ complete: true, value: { rows: jobs.get(jobId).rows.map((r) => ({ rowId: r.rowId, translatedText: r.sourceText })) } });
  const tools = createStudioTools(study, { persist: async () => { saves += 1; }, progress: (m) => messages.push(m), isCurrent: () => true });
  try {
    await prepareReadingTranslations(study, tools, study.passages.map((p) => p.id));
    assert.equal(jobs.size, 3);
    assert.equal(saves, 3);
    assert.equal(Object.keys(study.displayTranslations).length, 31);
    assert(messages.at(-1).includes("31 of 31 paragraphs"));
    await prepareReadingTranslations(study, tools, study.passages.map((p) => p.id));
    assert.equal(jobs.size, 3); assert.equal(saves, 3);
  } finally { startJob = async () => `job-${++jobNumber}`; }
});

test("planned activity records cached and failed work without additional calls or saves", async () => {
  nativeJob = async () => ({ complete: true, value: { summary: "Verified source result.", meanings: [{ definition: "Harmful" }] } });
  const study = { id: "activity", step: "4.4.1", cache: {}, scope: { installationId: 7, glossaryId: "g" } };
  let saves = 0; let renders = 0;
  const tools = createStudioTools(study, { persist: async () => { saves++; }, progress: () => {}, isCurrent: () => true, activityChanged: () => { renders++; } });
  tools.planActivity([{ id: "authors", label: "Verify authors" }, { id: "consolidate", label: "Consolidate findings" }]);
  assert.equal(study.activitySteps[study.step].items[1].status, "waiting");
  const before = calls.length;
  await tools.forActivity("authors").run("ai", { prompt: "fixture" }, "Verify author");
  await tools.forActivity("authors").run("ai", { prompt: "fixture" }, "Verify author");
  const node = study.activitySteps[study.step].items[0].children[0];
  assert.equal(node.status, "complete"); assert.equal(node.reused, true);
  assert.match(node.result, /Verified source result/);
  assert.equal(saves, 1);
  assert.equal(calls.slice(before).filter((call) => call.command === "start_glossary_studio_tool").length, 1);
  nativeJob = async () => { throw new Error("Fixture source unavailable"); };
  await assert.rejects(tools.forActivity("consolidate").run("ai", { prompt: "other fixture" }, "Consolidation"), /Fixture source unavailable/);
  assert.equal(study.activitySteps[study.step].items[1].children[0].status, "failed");
  assert.equal(study.activitySteps[study.step].items[1].children[0].error, "Fixture source unavailable");
  assert(renders > 0);
});

test("tool timing is checkpointed with the result and a cache reuse excludes original provider work", async () => {
  const { createStudioStepTiming } = await import("./glossary-research-studio-timing.js");
  const study = { id: "timed-tools", step: "4.4.1", cache: {}, scope: { installationId: 7, glossaryId: "g" } };
  let time = 0; const source = { now: () => time, timestamp: () => String(time) };
  const timing = createStudioStepTiming(study, study.step, source); const snapshots = [];
  nativeJob = async () => { time += 1200; return { complete: true, value: { summary: "Source result" }, metrics: { toolCacheHit: false, aiOperationMs: 1100, usage: { output_tokens: 20 } } }; };
  const tools = createStudioTools(study, { timing, isCurrent: () => true, progress: () => {}, persist: async () => { snapshots.push(structuredClone(study)); time += 300; } });
  await tools.run("ai", { prompt: "fixture" }, "Compare sources");
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].timing.steps[study.step].runs[0].operations[0].aiOperationMs, 1100);
  assert.equal(snapshots[0].timing.steps[study.step].runs[0].elapsedMs, 1200);
  await tools.run("ai", { prompt: "fixture" }, "Compare sources");
  timing.finish();
  const operations = study.timing.steps[study.step].runs[0].operations;
  assert.equal(operations[0].elapsedMs, 1500);
  assert.equal(operations[0].usage.output_tokens, 20);
  assert.equal(operations[1].cacheSource, "study-cache");
  assert.equal(operations[1].aiOperationMs, undefined);
  assert.equal(snapshots.length, 1, "timing must not add full-study writes");
});

test("comparison attempts rerun AI with a native cache nonce and reuse corpus receipts", async () => {
  nativeJob = async () => ({ complete: true, value: {} });
  const s = { id: "compare", step: "2a", cache: {}, model: {}, scope: { installationId: 7, glossaryId: "g", sourceLanguage: {}, targetLanguage: {} } };
  const tools = createStudioTools(s, { persist: async () => {}, progress: () => {}, isCurrent: () => true });
  const before = calls.length;
  await tools.ask("Q", {}, "{}");
  await tools.run("corpus", { path: "/api/sample" });
  s.comparisonAttempt = { step: "2a", id: "second" };
  await tools.ask("Q", {}, "{}");
  await tools.run("corpus", { path: "/api/sample" });
  const starts = calls.slice(before).filter((c) => c.command === "start_glossary_studio_tool");
  assert.deepEqual(starts.map((c) => c.args.input.kind), ["ai", "corpus", "ai"]);
  assert.equal(starts[2].args.input.payload._researchComparison, "second");
  assert.notEqual(starts[0].args.input.signature, starts[2].args.input.signature);
  assert.equal(starts[1].args.input.payload._researchComparison, undefined);
});


test("web usage is taken from the preserved provider receipt and cache reuse is not billed twice", async () => {
  const usage = { input_tokens: 123, output_tokens: 45 };
  nativeJob = async () => ({ complete: true, value: { summary: "source", evidence: { usage } }, metrics: { toolCacheHit: false } });
  const s = { id: "web-usage", step: "4.4.2", cache: {}, model: {}, scope: { installationId: 7, glossaryId: "g" } };
  const measurements = [];
  const tools = createStudioTools(s, { persist: async () => {}, progress() {}, isCurrent: () => true,
    timing: { startOperation: () => ({}), requestFinished: (_m, metrics, source) => measurements.push({ metrics, source }), finishOperation() {} } });
  await tools.run("web", { query: "test" }); await tools.run("web", { query: "test" });
  assert.deepEqual(measurements[0].metrics.usage, usage); assert.equal(measurements[0].source, "executed");
  assert.equal(measurements[1].source, "study-cache"); assert.equal(measurements[1].metrics.usage, undefined);
});
