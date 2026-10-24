import test from "node:test";
import assert from "node:assert/strict";

let native;
globalThis.document = { querySelector: () => null };
globalThis.window = { __TAURI__: { core: { invoke: (command, args) => native(command,
  args.operation === "manifest" ? { ...args, operation: "load" } : args) } },
  requestAnimationFrame: (callback) => setTimeout(callback, 0) };
const { saveStudioStudy, deleteStudioStudy } = await import("./glossary-research-studio-query.js");
const { queryClient } = await import("./query-client.js");
const scope = { installationId: 42, glossaryId: "glossary" };
const study = (id = "study", note = "initial") => ({ scope, id, revision: 0, generalNote: note });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test.afterEach(() => queryClient.clear());

test("rapid edits coalesce behind a running save and every caller waits for the final durable snapshot", async () => {
  const started = deferred(); const release = deferred(); const finalStarted = deferred(); const finalRelease = deferred();
  const calls = [];
  native = async (_command, { operation, input }) => {
    assert.equal(operation, "save"); calls.push(structuredClone(input));
    if (calls.length === 1) { started.resolve(); await release.promise; }
    else { finalStarted.resolve(); await finalRelease.promise; }
    return { ...input.value, revision: calls.length };
  };
  const first = saveStudioStudy(study()); await started.promise;
  const edited = study("study", "second");
  let settled = false;
  const second = saveStudioStudy(edited).then((result) => { settled = true; return result; });
  edited.generalNote = "final"; const third = saveStudioStudy(edited);
  edited.generalNote = "unsaved later mutation";
  release.resolve(); await first; await finalStarted.promise;
  const settledBeforeDurable = settled;
  finalRelease.resolve();
  const results = await Promise.all([second, third]);
  assert.equal(settledBeforeDurable, false);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].value.generalNote, "final");
  assert.equal(calls[1].expectedRevision, 1);
  assert.deepEqual(results.map((s) => [s.generalNote, s.revision]), [["final", 2], ["final", 2]]);
  assert.equal(calls.length, 2);
});

test("coalescing never crosses another study or deletion and failed saves do not poison later writes", async () => {
  const started = deferred(); const release = deferred(); const calls = [];
  native = async (_command, { operation, input }) => {
    calls.push([operation, input.value?.id ?? input.studyId, input.value?.generalNote]);
    if (calls.length === 1) { started.resolve(); await release.promise; }
    if (operation === "save" && input.value.generalNote === "fail") throw new Error("test storage failure");
    return { ...input.value, revision: calls.length };
  };
  const first = saveStudioStudy(study()); await started.promise;
  const second = saveStudioStudy(study("study", "before other study"));
  const other = saveStudioStudy(study("other"));
  const third = saveStudioStudy(study("study", "after other study"));
  const remove = deleteStudioStudy(scope, "study");
  const fourth = saveStudioStudy(study("study", "after deletion"));
  const failed = assert.rejects(saveStudioStudy(study("failing", "fail")), /test storage failure/);
  const recovery = saveStudioStudy(study("recovery", "recovered"));
  release.resolve(); await Promise.all([first, second, other, third, remove, fourth, failed, recovery]);
  assert.deepEqual(calls.slice(0, 6), [
    ["save", "study", "initial"], ["save", "study", "before other study"],
    ["save", "other", "initial"], ["save", "study", "after other study"],
    ["delete", "study", undefined], ["save", "study", "after deletion"],
  ]);
  assert.equal(calls.at(-1)[2], "recovered");
});


test("a compact native save receipt preserves the submitted immutable study in the query cache", async () => {
  const started = deferred(); const release = deferred();
  native = async (_command, { input }) => {
    started.resolve(); await release.promise;
    return { id: input.value.id, revision: 1, updatedAt: input.value.updatedAt };
  };
  const original = study("receipt");
  original.passages = [{ id: "p", text: "Full evidence" }];
  const pending = saveStudioStudy(original); await started.promise;
  original.generalNote = "later unsaved edit";
  original.passages[0].text = "later unsaved evidence";
  release.resolve();
  const saved = await pending;
  assert.equal(saved.generalNote, "initial");
  assert.deepEqual(saved.passages, [{ id: "p", text: "Full evidence" }]);
  assert.equal(saved.revision, 1);
  assert.equal(typeof saved.updatedAt, "string");
  assert.deepEqual(queryClient.getQueryData(["glossaryResearchStudio", 42, "glossary", "receipt"]), saved);
});


test("load and save compact legacy comparison metadata without changing evidence or submitted snapshots", async () => {
  const { loadStudioStudy } = await import("./glossary-research-studio-query.js");
  const evidence = "Full cited source á漢字 ".repeat(10000);
  const original = { ...study("legacy"), steps: { "4.4.1": { approved: { evidence }, status: "complete" },
    "5": { signature: JSON.stringify({ evidence }), generatedSignature: JSON.stringify({ evidence }), status: "stale" } } };
  native = async (_command, { operation, input }) => {
    if (operation === "load") return structuredClone(original);
    assert.equal(input.value.steps["5"].signature.length, 71);
    assert.equal(input.value.steps["5"].generatedSignature.length, 71);
    assert.equal(input.value.steps["4.4.1"].approved.evidence, evidence);
    assert.equal(input.value.steps["5"].status, "stale");
    return { id: input.value.id, revision: 1, updatedAt: input.value.updatedAt };
  };
  const loaded = await loadStudioStudy(scope, original.id);
  assert.equal(loaded.steps["5"].signature.length, 71);
  assert.equal(loaded.steps["4.4.1"].approved.evidence, evidence);
  const saved = await saveStudioStudy(original);
  assert.equal(saved.steps["5"].signature, loaded.steps["5"].signature);
  assert(original.steps["5"].signature.length > 100000, "caller snapshot must remain untouched");
});

test("export advances the owning revision so a later save still succeeds after cache eviction", async () => {
  const { exportStudioStudy } = await import("./glossary-research-studio-query.js");
  let durable; let revision = 0;
  native = async (_command, { operation, input }) => {
    if (operation === "load") return structuredClone(durable);
    assert.equal(operation, "save"); assert.equal(input.expectedRevision, revision);
    revision++; durable = { ...input.value, revision };
    return { id: durable.id, revision, updatedAt: durable.updatedAt };
  };
  const owned = study("export-owner");
  await exportStudioStudy(owned);
  assert.equal(owned.revision, 1);
  queryClient.clear();
  owned.generalNote = "Edited after export";
  const saved = await saveStudioStudy(owned);
  assert.equal(saved.revision, 2);
  assert.equal(saved.generalNote, "Edited after export");
});

test("a selected export path is written by native storage without loading the complete study into the UI", async () => {
  const { exportStudioStudy } = await import("./glossary-research-studio-query.js");
  const calls = [];
  native = async (command, { operation, input }) => {
    assert.equal(command, "glossary_studio_storage"); calls.push({ operation, input });
    if (operation === "save") return { id: input.value.id, revision: 1, updatedAt: input.value.updatedAt };
    assert.equal(operation, "export"); assert.equal(input.outputPath, "/chosen folder/research.json"); return null;
  };
  const owned = study("export-selected");
  await exportStudioStudy(owned, "/chosen folder/research.json");
  assert.deepEqual(calls.map((c) => c.operation), ["save", "export"]);
  assert.equal(calls[1].input.studyId, owned.id);
  assert.equal(owned.revision, 1);
});
