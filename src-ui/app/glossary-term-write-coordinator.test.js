import test from "node:test";
import assert from "node:assert/strict";

const {
  getGlossaryTermWriteIntent,
  glossaryTermSaveIntentKey,
  glossaryTermWriteScope,
  requestGlossaryTermWriteIntent,
  resetGlossaryTermWriteCoordinator,
} = await import("./glossary-term-write-coordinator.js");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deferred() {
  let resolve;
  const promise = new Promise((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

test.afterEach(() => {
  resetGlossaryTermWriteCoordinator();
});

test("term writes in the same glossary repo serialize", async () => {
  const events = [];
  const scope = glossaryTermWriteScope({ installationId: 1 }, "repo-1");

  requestGlossaryTermWriteIntent({
    key: glossaryTermSaveIntentKey("glossary-1", "term-1"),
    scope,
    glossaryId: "glossary-1",
    type: "glossaryTermSave",
    value: { draftSnapshot: { sourceTerms: ["A"] } },
  }, {
    run: async () => {
      events.push("a:start");
      await delay(5);
      events.push("a:end");
    },
  });
  requestGlossaryTermWriteIntent({
    key: glossaryTermSaveIntentKey("glossary-1", "term-2"),
    scope,
    glossaryId: "glossary-1",
    type: "glossaryTermSave",
    value: { draftSnapshot: { sourceTerms: ["B"] } },
  }, {
    run: async () => {
      events.push("b:start");
      events.push("b:end");
    },
  });

  await delay(20);

  assert.deepEqual(events, ["a:start", "a:end", "b:start", "b:end"]);
});

test("same term save key coalesces to the latest draft", async () => {
  const writes = [];
  const releaseFirstWrite = deferred();
  const key = glossaryTermSaveIntentKey("glossary-1", "term-1");
  const scope = glossaryTermWriteScope({ installationId: 1 }, "repo-1");

  requestGlossaryTermWriteIntent({
    key,
    scope,
    glossaryId: "glossary-1",
    type: "glossaryTermSave",
    value: { draftSnapshot: { sourceTerms: ["First"] } },
  }, {
    run: async (intent) => {
      writes.push(intent.value.draftSnapshot.sourceTerms[0]);
      await releaseFirstWrite.promise;
    },
  });
  await delay(0);
  requestGlossaryTermWriteIntent({
    key,
    scope,
    glossaryId: "glossary-1",
    type: "glossaryTermSave",
    value: { draftSnapshot: { sourceTerms: ["Second"] } },
  }, {
    run: async (intent) => {
      writes.push(intent.value.draftSnapshot.sourceTerms[0]);
    },
  });

  releaseFirstWrite.resolve();
  await delay(10);

  assert.deepEqual(writes, ["First", "Second"]);
  assert.deepEqual(getGlossaryTermWriteIntent(key).value.draftSnapshot.sourceTerms, ["Second"]);
});
