import test from "node:test";
import assert from "node:assert/strict";

const {
  getGlossaryTermWriteIntent,
  glossaryTermSaveIntentKey,
  glossaryTermWriteScope,
  requestGlossaryTermWriteIntent,
  resetGlossaryTermWriteCoordinator,
  markGlossaryTermWriteLocallySaved,
  waitForGlossaryTermWritesToSettle,
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

test("local readers wait for persistence but full-settlement readers still wait for push", async () => {
  const team = { installationId: 1 };
  const save = deferred();
  const push = deferred();
  requestGlossaryTermWriteIntent({
    key: "save", scope: glossaryTermWriteScope(team, "repo"),
  }, {
    clearOnSuccess: true,
    run: async (intent) => {
      await save.promise;
      markGlossaryTermWriteLocallySaved(intent);
      await push.promise;
    },
  });
  let locallyReady = false;
  let fullyReady = false;
  const local = waitForGlossaryTermWritesToSettle(team, "repo", { localOnly: true })
    .then(() => { locallyReady = true; });
  const full = waitForGlossaryTermWritesToSettle(team, "repo")
    .then(() => { fullyReady = true; });
  await delay(0);
  assert.equal(locallyReady, false);
  save.resolve();
  await local;
  assert.equal(fullyReady, false);
  push.resolve();
  await full;
});

test("a locally saved version does not release readers of a newer queued draft", async () => {
  const team = { installationId: 1 };
  const firstPush = deferred();
  const secondSave = deferred();
  const intent = { key: "save", scope: glossaryTermWriteScope(team, "repo") };
  requestGlossaryTermWriteIntent(intent, {
    run: async (running) => {
      markGlossaryTermWriteLocallySaved(running);
      await firstPush.promise;
    },
  });
  requestGlossaryTermWriteIntent(intent, {
    clearOnSuccess: true,
    run: async (running) => {
      await secondSave.promise;
      markGlossaryTermWriteLocallySaved(running);
    },
  });
  let ready = false;
  const local = waitForGlossaryTermWritesToSettle(team, "repo", { localOnly: true })
    .then(() => { ready = true; });
  // Another repository remains independent.
  await waitForGlossaryTermWritesToSettle(team, "other", { localOnly: true });
  firstPush.resolve();
  await delay(0);
  assert.equal(ready, false);
  secondSave.resolve();
  await local;
  await waitForGlossaryTermWritesToSettle(team, "repo");
});

test("a failed preflight releases local readers without a persistence milestone", async () => {
  const team = { installationId: 1 };
  const preflight = deferred();
  requestGlossaryTermWriteIntent({ key: "save", scope: glossaryTermWriteScope(team, "repo") }, {
    run: async () => { await preflight.promise; throw new Error("Remote conflict"); },
  });
  const local = waitForGlossaryTermWritesToSettle(team, "repo", { localOnly: true });
  preflight.resolve();
  await local;
  assert.equal(getGlossaryTermWriteIntent("save").status, "failed");
});
