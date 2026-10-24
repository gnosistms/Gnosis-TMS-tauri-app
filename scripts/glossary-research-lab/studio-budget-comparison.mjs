// Read-only comparison of the saved tenebroso reference and budget experiment.
// Baseline sequences select the final procedural attempts, excluding earlier
// exploratory reruns. The two focused-test segments straddle form approval.
import { readFile, stat } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import { createHash } from "node:crypto";
const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) throw new Error("Usage: node studio-budget-comparison.mjs reference.json comparison.json");
async function open(path) {
  const study = JSON.parse(await readFile(path, "utf8"));
  async function resolve(value) {
    if (!value?._studioArtifact) return value;
    if (!/^[a-f0-9]{64}$/u.test(value._studioArtifact)) throw new Error("Invalid evidence digest");
    const bytes = await readFile(join(dirname(path), basename(path, ".json"), "evidence", `${value._studioArtifact}.json`));
    if (createHash("sha256").update(bytes).digest("hex") !== value._studioArtifact) throw new Error("Evidence integrity mismatch");
    return JSON.parse(bytes);
  }
  return { study, resolve, manifestBytes: (await stat(path)).size };
}
const before = await open(beforePath); const after = await open(afterPath);
if (after.study.referenceStudyId !== before.study.id) throw new Error("These studies are not a controlled comparison pair");
const totals = (runs) => {
  const ops = runs.flatMap((run) => run.operations ?? []);
  const executions = ops.filter((op) => !["study-cache", "native-cache"].includes(op.cacheSource));
  return { elapsedMs: runs.reduce((n, r) => n + (r.elapsedMs ?? 0), 0), calls: executions.filter((o) => ["ai", "translate"].includes(o.kind)).length,
    inputTokens: executions.reduce((n, o) => n + (o.usage?.input_tokens ?? o.usage?.inputTokens ?? 0), 0),
    outputTokens: executions.reduce((n, o) => n + (o.usage?.output_tokens ?? o.usage?.outputTokens ?? 0), 0),
    providerCachedInput: executions.reduce((n, o) => n + (o.usage?.input_tokens_details?.cached_tokens ?? 0), 0),
    saveMs: executions.reduce((n, o) => n + (o.saveMs ?? 0), 0) };
};
const stages = ["4.4.1", "4.6", "8", "9"];
const baselineSequences = { "4.4.1": [3], "4.6": [2], "8": [5, 6], "9": [2] };
const rows = stages.map((step) => ({ step,
  before: totals(before.study.timing.steps[step].runs.filter((r) => baselineSequences[step].includes(r.sequence))),
  after: totals(after.study.timing?.steps[step]?.runs ?? []),
}));
const trials = Object.entries(after.study.tests ?? {}).filter(([key]) => key.startsWith("9:")).map(([, trial]) => trial);
const discovery = await after.resolve(after.study.comparisonResults?.assignment);
const counterfactual = await after.resolve(after.study.comparisonResults?.counterfactual);
console.log(JSON.stringify({ before: before.study.id, after: after.study.id, manifestBytes: after.manifestBytes, rows,
  validation: { paragraphs: new Set(trials.flatMap((t) => t.translations ?? []).map((p) => p.paragraphId)).size,
    occurrences: trials.reduce((n, t) => n + (t.choices?.length ?? 0), 0), passed: trials.reduce((n, t) => n + (t.choices ?? []).filter((c) => c.passed).length, 0),
    confirmedForms: after.study.candidates.filter((c) => c.confirmed).map((c) => c.text) },
  discovery: discovery && { paragraphCount: discovery.paragraphIds.length, occurrences: discovery.assignments.length,
    recoveryConsidered: discovery.recoveryConsidered, unrepresentedMeanings: discovery.meanings.filter((m) => m.unused).map((m) => m.id) },
  counterfactual: counterfactual && { translation: counterfactual.translations[0].translation, verdict: counterfactual.verdict },
}, null, 2));
