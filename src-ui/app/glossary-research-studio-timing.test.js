import test from "node:test";
import assert from "node:assert/strict";
import { createStudioStepTiming, recordStudioSaveTiming, studioTimingSummary, studioActivityTiming, formatStudioDuration } from "./glossary-research-studio-timing.js";

function fixture() {
  let time = 0; const study = {};
  return { study, tick: (duration) => { time += duration; }, clock: { now: () => time, timestamp: () => new Date(1700000000000 + time).toISOString() } };
}

test("pause and resume exclude human idle time and freeze cancelled requests despite late completion", () => {
  const f = fixture();
  const first = createStudioStepTiming(f.study, "8", f.clock);
  const op = first.startOperation(["m1", "translate"], "Translate meaning", "translate");
  f.tick(4000); first.finish("paused");
  f.tick(600000); first.requestFinished(op, { aiOperationMs: 90000, usage: { output_tokens: 5000 } });
  first.finishOperation(op); first.finish();
  const resumed = createStudioStepTiming(f.study, "8", f.clock);
  f.tick(3000); resumed.finish();
  const step = f.study.timing.steps["8"];
  assert.equal(step.runs[0].status, "paused");
  assert.equal(step.runs[0].operations[0].status, "paused");
  assert.equal(step.runs[0].operations[0].elapsedMs, 4000);
  assert.equal(step.runs[0].operations[0].aiOperationMs, undefined);
  assert.equal(studioTimingSummary(f.study)[0].elapsedMs, 7000);
  assert.equal(studioTimingSummary(JSON.parse(JSON.stringify(f.study)))[0].paused, 1);
});

test("parallel operations keep separate costs while parent activity wall time counts overlapping intervals once", () => {
  const f = fixture(); const timing = createStudioStepTiming(f.study, "4.6", f.clock);
  const a = timing.startOperation(["translations", "batch-1"], "First batch", "translate");
  f.tick(1000);
  const b = timing.startOperation(["translations", "batch-2"], "Second batch", "translate");
  f.tick(2000);
  timing.requestFinished(b, { aiOperationMs: 1800, executionMs: 1900, promptBytes: 42, usage: { output_tokens: 300 } });
  f.tick(500); timing.finishOperation(b);
  f.tick(1500); timing.requestFinished(a, { aiOperationMs: 4200 }); timing.finishOperation(a);
  timing.finish();
  const summary = studioTimingSummary(f.study)[0];
  assert.equal(summary.elapsedMs, 5000);
  assert.equal(summary.aiMs, 6000, "AI work may overlap and must not be called step wall time");
  assert.deepEqual(studioActivityTiming(f.study, "4.6", ["translations"]), { elapsedMs: 5000, attempts: 2 });
  assert.deepEqual(studioActivityTiming(f.study, "4.6", ["translations", "batch-2"]), { elapsedMs: 2500, attempts: 1 });
  assert.equal(f.study.timing.steps["4.6"].runs[0].operations[1].usage.output_tokens, 300);
});

test("cache reuse measures its current wait without recharging original AI duration or token usage", () => {
  const f = fixture(); const timing = createStudioStepTiming(f.study, "4.4.1", f.clock);
  for (const cache of ["study-cache", "native-cache"]) {
    const operation = timing.startOperation([cache], "Cached lookup", "author"); f.tick(12);
    timing.requestFinished(operation, { executionMs: 40000, aiOperationMs: 39000, usage: { input_tokens: 30000 } }, cache);
    timing.finishOperation(operation);
  }
  timing.finish();
  const summary = studioTimingSummary(f.study)[0];
  assert.equal(summary.cacheHits, 2); assert.equal(summary.aiMs, 0); assert.equal(summary.measuredAiCalls, 0);
  assert.equal(summary.elapsedMs, 24);
  for (const operation of f.study.timing.steps["4.4.1"].runs[0].operations) {
    assert.equal(operation.usage, undefined); assert.equal(operation.aiOperationMs, undefined);
  }
});

test("failed work and normal save waits remain measured, and historical missing data is unknown", () => {
  const f = fixture(); assert.deepEqual(studioTimingSummary(f.study), []);
  const timing = createStudioStepTiming(f.study, "9", f.clock);
  timing.startOperation(["batch-1"], "Translation", "translate"); f.tick(2500); timing.finish("failed");
  recordStudioSaveTiming(f.study, "9", 320); recordStudioSaveTiming(f.study, "9", 150, true);
  const summary = studioTimingSummary(f.study)[0];
  assert.equal(summary.failed, 1); assert.equal(summary.saveMs, 470); assert.equal(summary.saves, 2);
  assert.equal(f.study.timing.steps["9"].runs[0].operations[0].requestMs, 2500);
  assert.equal(f.study.timing.steps["9"].saves.failed, 1);
  assert.equal(formatStudioDuration(undefined), "Not measured");
  assert.equal(formatStudioDuration(1432), "1.4 s");
  assert.equal(formatStudioDuration(166000), "2 min 46 s");
});

test("a durable in-flight snapshot records elapsed work without inventing an end time", () => {
  const f = fixture(); const timing = createStudioStepTiming(f.study, "4.4.1", f.clock);
  const operation = timing.startOperation(["sources"], "Compare sources", "ai");
  f.tick(18000); timing.requestFinished(operation, { aiOperationMs: 17500 });
  const saved = JSON.parse(JSON.stringify(f.study));
  assert.equal(studioTimingSummary(saved)[0].elapsedMs, 18000);
  assert.equal(studioTimingSummary(saved)[0].incomplete, 1);
  assert.equal(saved.timing.steps["4.4.1"].runs[0].finishedAt, undefined);
  f.tick(2000); timing.finishOperation(operation, "complete", 2000); timing.finish();
  assert.equal(studioTimingSummary(f.study)[0].elapsedMs, 20000);
  assert.equal(studioTimingSummary(f.study)[0].incomplete, 0);
  assert.equal(operation.saveMs, 2000);
});

test("historical run metadata retains the selected model and workload without copying settings or evidence", () => {
  const f = fixture();
  f.study.model = { providerId: "provider", modelId: "model", reasoningEffort: "medium", apiKey: "do-not-copy", prompt: "do-not-copy" };
  f.study.passages = [{ text: "Do not copy source text into diagnostics" }];
  const timing = createStudioStepTiming(f.study, "6", f.clock); timing.finish();
  const run = f.study.timing.steps["6"].runs[0];
  assert.deepEqual(run.model, { providerId: "provider", modelId: "model", reasoningEffort: "medium" });
  assert.deepEqual(run.workload, { paragraphs: 1, occurrences: 0, candidates: 0 });
  assert(!JSON.stringify(run).includes("do-not-copy"));
  assert(!JSON.stringify(run).includes("Do not copy source text"));
});

test("fresh comparison progress excludes earlier-run work while timing totals preserve every run", () => {
  const f = fixture();
  const baseline = createStudioStepTiming(f.study, "4.2", f.clock);
  const old = baseline.startOperation(["examples"], "Read sources", "corpus"); f.tick(10000);
  baseline.finishOperation(old); baseline.finish();
  f.study.comparisonAttempt = { step: "4.2", id: "new-procedure" };
  const current = createStudioStepTiming(f.study, "4.2", f.clock);
  assert.equal(studioActivityTiming(f.study, "4.2", ["examples"]), null);
  const fresh = current.startOperation(["analysis"], "Analyze saved sources", "ai"); f.tick(2000);
  current.finishOperation(fresh); current.finish();
  assert.deepEqual(studioActivityTiming(f.study, "4.2", ["analysis"]), { elapsedMs: 2000, attempts: 1 });
  assert.equal(studioTimingSummary(f.study)[0].elapsedMs, 12000);
  assert.equal(f.study.timing.steps["4.2"].runs.length, 2);
});
