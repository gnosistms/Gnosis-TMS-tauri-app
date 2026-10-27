// Read-only diagnostics for a saved Studio study, including piecewise snapshots.
import { readFile, stat } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import { createHash } from "node:crypto";
const path = process.argv[2];
if (!path) throw new Error("Usage: node studio-efficiency-report.mjs /absolute/path/study.json");
const manifest = JSON.parse(await readFile(path, "utf8"));
const pieceRoot = join(dirname(path), basename(path, ".json"), "evidence");
async function resolve(value) {
  if (!value?._studioArtifact) return value;
  const hash = value._studioArtifact;
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error("Invalid piece digest");
  const bytes = await readFile(join(pieceRoot, `${hash}.json`));
  if (createHash("sha256").update(bytes).digest("hex") !== hash) throw new Error("Evidence integrity check failed");
  return JSON.parse(bytes);
}
const steps = [];
for (const [step, timing] of Object.entries(manifest.timing?.steps ?? {})) {
  const record = manifest.steps[step];
  const report = await resolve(record?.approved ?? record?.value);
  steps.push({ step, saves: timing.saves, runs: timing.runs.map((run) => ({
    sequence: run.sequence, status: run.status, elapsedMs: run.elapsedMs,
    operations: run.operations.map((op) => ({ label: op.label, kind: op.kind, cache: op.cacheSource,
      requestMs: op.requestMs, aiMs: op.aiOperationMs, saveMs: op.saveMs, promptBytes: op.promptBytes,
      inputTokens: op.usage?.input_tokens ?? op.usage?.inputTokens,
      outputTokens: op.usage?.output_tokens ?? op.usage?.outputTokens })),
  })), result: report?.meanings?.map((m) => ({ id: m.id, definition: m.definition, grammar: m.grammar }))
    ?? report?.forms?.map((f) => ({ text: f.text, selected: f.selected, paragraphs: f.paragraphCount }))
    ?? (report ? { summary: report.summary, total: report.total, paragraphs: report.paragraphs } : null) });
}
console.log(JSON.stringify({ id: manifest.id, term: manifest.scope.term, step: manifest.step,
  manifestBytes: (await stat(path)).size, storageVersion: manifest._storageVersion ?? 1, steps }, null, 2));
