import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
let calls = []; const artifacts = new Map(); let fail = false;
globalThis.window = { __TAURI__: { core: { invoke: async (_command, { operation, input }) => {
  calls.push({ operation, input });
  if (fail) throw new Error("Evidence write failed");
  if (operation === "artifact-write") return input.value.map((value) => {
    const text = JSON.stringify(value); const hash = createHash("sha256").update(text).digest("hex");
    artifacts.set(hash, structuredClone(value)); return { _studioArtifact: hash, bytes: text.length };
  });
  assert.equal(operation, "artifact-read");
  if (!artifacts.has(input.value._studioArtifact)) throw new Error("Missing evidence");
  return structuredClone(artifacts.get(input.value._studioArtifact));
} } } };
const { captureStudioEvidence, resolveStudioEvidence, hydrateStudioStep, normalizeStudioToolCache } = await import("./glossary-research-studio-evidence.js");
const { queryClient } = await import("./query-client.js");
const study = () => ({ id: "pieces", revision: 1, scope: { installationId: 7, glossaryId: "g" }, step: "4.5", steps: {}, cache: {} });
test.afterEach(() => { queryClient.clear(); calls = []; artifacts.clear(); fail = false; });

test("cold evidence is written once, checkpoints stay small and reads request only the needed piece", async () => {
  const s = study(); const raw = "Full source quotation á漢字. ".repeat(20000);
  s.steps["4.4.1"] = { value: { summary: "Verified source findings", meanings: [{ definition: "Dark" }], evidence: raw } };
  s.population = [{ id: "p", text: raw }]; s.cache.a = { value: { text: raw }, request: { prompt: raw }, metrics: { executionMs: 12 } };
  s.testHistory = [{ translations: [{ text: raw }] }];
  const original = structuredClone(s);
  const pending = captureStudioEvidence(s); s.generalNote = "Later unsaved edit";
  const first = await pending();
  assert.equal(first.value.generalNote, undefined);
  assert(JSON.stringify(first.value).length < 2500);
  assert.equal(first.value.steps["4.4.1"].value.summary, "Verified source findings");
  assert.equal(first.value.steps["4.4.1"].value.evidence, undefined);
  first.committed();
  const written = calls.length;
  const second = await captureStudioEvidence(s)(); second.committed();
  assert.equal(calls.length, written, "unchanged evidence must not be resent or rewritten");
  await hydrateStudioStep(s, "4.4.1");
  assert.equal(s.steps["4.4.1"].value.evidence, raw);
  assert.equal(calls.filter((c) => c.operation === "artifact-read").length, 1);
  assert(s.population._studioArtifact, "opening a report does not load the corpus population");
  assert.deepEqual(await resolveStudioEvidence(s, s.cache.a.value), original.cache.a.value);
});

test("a failed evidence write never releases or blesses unsaved data; mutable drafts are captured again", async () => {
  const s = study(); s.step = "6"; s.candidates = [{ text: "dark" }];
  s.steps["6"] = { value: { candidates: s.candidates } };
  const original = s.steps["6"].value;
  fail = true; await assert.rejects(captureStudioEvidence(s)(), /Evidence write failed/);
  assert.equal(s.steps["6"].value, original);
  fail = false; const first = await captureStudioEvidence(s)(); first.committed();
  s.candidates[0].text = "gloomy";
  const second = await captureStudioEvidence(s)();
  assert.notEqual(first.value.steps["6"].value._studioArtifact, second.value.steps["6"].value._studioArtifact);
  assert.equal(artifacts.get(second.value.steps["6"].value._studioArtifact).candidates[0].text, "gloomy");
});

test("legacy prompt keys become compact indices without losing the original request or retry target", async () => {
  const signature = '{"kind":"ai","payload":{"prompt":"whole original request"},"version":1}';
  const s = study(); s.cache[`${signature}:retry:2`] = { value: { meanings: [] } }; s.lastToolSignature = signature; s.toolRetries = { [signature]: 2 };
  await normalizeStudioToolCache(s);
  assert.match(s.lastToolSignature, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(s.toolRetries[s.lastToolSignature], 2);
  assert.equal(s.cache[`${s.lastToolSignature}:retry:2`].request.legacySignature, signature);
  fail = true;
  await assert.rejects(resolveStudioEvidence(s, { _studioArtifact: "a".repeat(64) }), /Evidence write failed/);
});

test("sample paragraphs are separate pieces and load only in steps that use their full text", async () => {
  const s = study(); s.step = "7"; s.passages = [{ id: "p", text: "Complete source context" }];
  const prepared = await captureStudioEvidence(s)(); prepared.committed();
  assert.equal(s.passages.length, 1); assert(s.passages._studioArtifact);
  assert.equal(prepared.value.passages.length, 1);
  const before = calls.length;
  await hydrateStudioStep(s, "7"); assert.equal(calls.length, before);
  await hydrateStudioStep(s, "4.1");
  assert.deepEqual(s.passages, [{ id: "p", text: "Complete source context" }]);
  assert.equal(calls.length, before + 1);
});

test("cold report previews contain curated dependencies, never whole split queues or source samples", async () => {
  const s = study(); s.step = "7";
  s.steps["4.7"] = { value: { splits: [{ passages: [{ text: "Large whole source context".repeat(10000) }] }], proposals: [] } };
  s.steps["5"] = { approved: { compounds: [{ phrase: "source expression", paragraphIds: ["p"] }], evidence: "Original raw evidence" } };
  const saved = await captureStudioEvidence(s)(); saved.committed();
  assert.equal(saved.value.steps["4.7"].value.splits, undefined);
  assert(saved.value.steps["4.7"].value._studioArtifact);
  assert.deepEqual(saved.value.steps["5"].approved.compounds, [{ phrase: "source expression", paragraphIds: ["p"] }]);
  await hydrateStudioStep(s, "4.7");
  assert.equal(s.steps["4.7"].value.splits[0].passages[0].text.length, 260000);
});


test("curated citations remain visible downstream after a full report is opened and saved again", async () => {
  const s = study(); s.step = "4.5";
  s.steps["4.4.2"] = { approved: { summary: "No new meanings", meanings: [], citations: [{ url: "https://example.test", quotation: "Exact quote" }], evidence: "Raw receipt" } };
  const first = await captureStudioEvidence(s)(); first.committed(); const writes = calls.length;
  assert.equal(first.value.steps["4.4.2"].approved.citations.length, 1);
  await hydrateStudioStep(s, "4.4.2");
  const second = await captureStudioEvidence(s)(); second.committed();
  assert.equal(second.value.steps["4.4.2"].approved.citations[0].quotation, "Exact quote");
  assert.equal(calls.length, writes + 1, "only one read; unchanged evidence is not rewritten");
});


test("recorded test inputs stay cold until an explicit comparison requests them", async () => {
  const s = study(); s.step = "8"; s.comparisonStarts = { "8": { fields: { candidates: [{ text: "dark" }], tests: {} } } };
  const first = await captureStudioEvidence(s)(); first.committed(); const before = calls.length;
  assert(s.comparisonStarts["8"]._studioArtifact); await hydrateStudioStep(s, "8"); assert.equal(calls.length, before);
  const recorded = await resolveStudioEvidence(s, s.comparisonStarts["8"]); assert.equal(recorded.fields.candidates[0].text, "dark");
});
