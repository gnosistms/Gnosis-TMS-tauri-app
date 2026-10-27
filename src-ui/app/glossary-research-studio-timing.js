// Timings are diagnostics, excluded from research prompts and cache signatures.
// Durations use a monotonic clock. Timestamps are for audit, never subtraction.
const clock = { now: () => performance.now(), timestamp: () => new Date().toISOString() };
const ms = (value) => Math.max(0, Math.round(value));
const validMs = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
function timingData(study) { return study.timing ??= { version: 1, steps: {} }; }
function stepData(study, step) { return timingData(study).steps[step] ??= { runs: [], saves: { count: 0, totalMs: 0, failed: 0 } }; }

export function createStudioStepTiming(study, step, source = clock) {
  const data = stepData(study, step);
  const start = source.now();
  const run = { sequence: data.runs.length + 1, startedAt: source.timestamp(), status: "running", elapsedMs: 0, operations: [],
    comparisonId: study.comparisonAttempt?.step === step ? study.comparisonAttempt.id : null,
    model: Object.fromEntries(["providerId", "modelId", "reasoningEffort"].filter((key) => typeof study.model?.[key] === "string").map((key) => [key, study.model[key]])),
    workload: { paragraphs: study.passages?.length ?? 0, occurrences: study.assignments?.length ?? 0, candidates: study.candidates?.length ?? 0 },
  };
  data.runs.push(run);
  const active = new Map(); let finished = false;
  function snapshot() {
    if (finished) return;
    const current = source.now(); run.elapsedMs = ms(current - start);
    for (const [operation, started] of active) Object.assign(operation, {
      elapsedMs: ms(current - started), endOffsetMs: ms(current - start),
    });
  }
  function finishOperation(operation, status = "complete", saveMs = null) {
    const started = active.get(operation);
    if (started === undefined) return;
    active.delete(operation);
    if (validMs(saveMs)) operation.saveMs = saveMs;
    const end = source.now();
    if (!validMs(operation.requestMs)) operation.requestMs = ms(end - started);
    Object.assign(operation, { status, elapsedMs: ms(end - started), endOffsetMs: ms(end - start), finishedAt: source.timestamp() });
  }
  return {
    snapshot,
    startOperation(path, label, kind) {
      if (finished) return null;
      const started = source.now();
      const operation = { path: [...path], label, kind, status: "running", startedAt: source.timestamp(), startOffsetMs: ms(started - start) };
      run.operations.push(operation); active.set(operation, started); return operation;
    },
    requestFinished(operation, metrics = {}, cacheSource = "executed") {
      const started = active.get(operation);
      if (started === undefined) return;
      snapshot();
      Object.assign(operation, { requestMs: ms(source.now() - started), cacheSource });
      // Cache receipts may retain the ORIGINAL provider metrics. Never count
      // those historical AI durations/tokens as a new provider execution.
      if (cacheSource === "executed") {
        for (const key of ["aiOperationMs", "executionMs", "promptBytes"]) if (validMs(metrics[key])) operation[key] = metrics[key];
        if (metrics.usage) operation.usage = structuredClone(metrics.usage);
      }
    },
    finishOperation,
    finish(status = "complete") {
      if (finished) return;
      for (const operation of active.keys()) finishOperation(operation, status === "failed" ? "failed" : "paused");
      Object.assign(run, { status, elapsedMs: ms(source.now() - start), finishedAt: source.timestamp() }); finished = true;
    },
  };
}

// The duration of this write is included by the NEXT normal checkpoint, avoiding
// another expensive full-study write just to record a write's own duration.
export function recordStudioSaveTiming(study, step, elapsedMs, failed = false) {
  const saves = stepData(study, step).saves;
  saves.count += 1; saves.totalMs += ms(elapsedMs); saves.lastMs = ms(elapsedMs);
  if (failed) saves.failed += 1;
}

export function studioTimingSummary(study) {
  return Object.entries(study.timing?.steps ?? {}).map(([step, value]) => {
    const runs = value.runs ?? [];
    const operations = runs.flatMap((run) => run.operations ?? []);
    const fresh = operations.filter((operation) => operation.cacheSource === "executed");
    const measuredAi = fresh.filter((operation) => validMs(operation.aiOperationMs));
    return { step, runs: runs.length, elapsedMs: runs.reduce((n, run) => n + (run.elapsedMs ?? 0), 0),
      operations: operations.length, cacheHits: operations.filter((operation) => ["study-cache", "native-cache"].includes(operation.cacheSource)).length,
      measuredAiCalls: measuredAi.length, aiMs: measuredAi.reduce((n, operation) => n + operation.aiOperationMs, 0),
      saveMs: value.saves?.totalMs ?? null, saves: value.saves?.count ?? 0,
      incomplete: runs.filter((run) => run.status === "running").length,
      paused: runs.filter((run) => run.status === "paused").length,
      failed: runs.filter((run) => run.status === "failed").length,
    };
  }).sort((a, b) => b.elapsedMs - a.elapsedMs || a.step.localeCompare(b.step, undefined, { numeric: true }));
}

export function studioActivityTiming(study, step, path) {
  let elapsedMs = 0; let attempts = 0;
  const comparison = study.comparisonAttempt?.step === step ? study.comparisonAttempt.id : null;
  for (const run of study.timing?.steps?.[step]?.runs ?? []) {
    if (comparison && run.comparisonId !== comparison) continue;
    const operations = (run.operations ?? []).filter((operation) => path.every((id, i) => operation.path?.[i] === id));
    const intervals = operations.filter((operation) => validMs(operation.endOffsetMs))
      .map((operation) => [operation.startOffsetMs, operation.endOffsetMs]).sort((a, b) => a[0] - b[0]);
    attempts += intervals.length;
    let start = null; let end = null;
    for (const interval of intervals) {
      if (start === null) [start, end] = interval;
      else if (interval[0] <= end) end = Math.max(end, interval[1]);
      else { elapsedMs += end - start; [start, end] = interval; }
    }
    if (start !== null) elapsedMs += end - start;
  }
  return attempts ? { elapsedMs, attempts } : null;
}

export function formatStudioDuration(value) {
  if (!validMs(value)) return "Not measured";
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60000) return `${(value / 1000).toFixed(1)} s`;
  const seconds = Math.round(value / 1000);
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}
