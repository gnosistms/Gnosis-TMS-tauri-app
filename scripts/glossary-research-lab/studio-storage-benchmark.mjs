// Offline CPU/serialization replay. Reads the input file; never writes a study.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const path = process.argv[2];
if (!path) throw new Error("Pass a saved legacy study JSON path. No study is changed.");
let writtenPieces = 0;
globalThis.window = { __TAURI__: { core: { invoke: async (_command, { operation, input }) => {
  if (operation !== "artifact-write") throw new Error(`Unexpected operation ${operation}`);
  writtenPieces += input.value.length;
  return input.value.map((value) => { const text = JSON.stringify(value); return {
    _studioArtifact: createHash("sha256").update(text).digest("hex"), bytes: Buffer.byteLength(text),
  }; });
} } } };
const { captureStudioEvidence, normalizeStudioToolCache } = await import("../../src-ui/app/glossary-research-studio-evidence.js");
const { compactStudioStepSignatures } = await import("../../src-ui/app/glossary-research-studio-workflow.js");
const study = JSON.parse(await readFile(path, "utf8"));
if (study._storageVersion === 2) throw new Error("Use a legacy monolithic study for an honest baseline.");
async function measure(work) {
  const started = performance.now(); const cpu = process.cpuUsage();
  const bytes = await work(); const used = process.cpuUsage(cpu);
  return { bytes, elapsedMs: Math.round(performance.now() - started), cpuMs: Math.round((used.user + used.system) / 1000) };
}
const baseline = await measure(async () => Buffer.byteLength(JSON.stringify(structuredClone(study))));
const migration = await measure(async () => {
  await normalizeStudioToolCache(study); await compactStudioStepSignatures(study);
  const prepared = await captureStudioEvidence(study)(); prepared.committed();
  return Buffer.byteLength(JSON.stringify(prepared.value));
});
const steady = [];
for (let i = 0; i < 3; i++) steady.push(await measure(async () => {
  const prepared = await captureStudioEvidence(study)(); prepared.committed();
  return Buffer.byteLength(JSON.stringify(prepared.value));
}));
console.log(JSON.stringify({ environment: "Offline Node replay: excludes native disk, IPC, UI and AI; not a native-app speedup measurement",
  term: study.scope.term, baseline, migration, steady, writtenPieces }, null, 2));
