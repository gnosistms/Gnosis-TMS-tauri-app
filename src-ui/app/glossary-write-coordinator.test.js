import test from "node:test";
import assert from "node:assert/strict";

const {
  anyGlossaryMutatingWriteIsActive,
  anyGlossaryWriteIsActive,
  applyGlossaryWriteIntentsToSnapshot,
  clearConfirmedGlossaryWriteIntents,
  getGlossaryWriteIntent,
  glossaryLifecycleIntentKey,
  glossaryRepoSyncIntentKey,
  glossaryTitleIntentKey,
  requestGlossaryWriteIntent,
  resetGlossaryWriteCoordinator,
  teamMetadataWriteScope,
} = await import("./glossary-write-coordinator.js");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function glossary(overrides = {}) {
  return {
    id: "glossary-1",
    repoName: "glossary-repo",
    title: "Glossary",
    lifecycleState: "active",
    ...overrides,
  };
}

test.afterEach(() => {
  resetGlossaryWriteCoordinator();
});

test("same glossary title key coalesces to the latest value", async () => {
  const writes = [];
  const releaseFirstWrite = deferred();
  const key = glossaryTitleIntentKey("glossary-1");
  const scope = teamMetadataWriteScope({ installationId: 1 });

  requestGlossaryWriteIntent({
    key,
    scope,
    teamId: "team-1",
    glossaryId: "glossary-1",
    type: "glossaryTitle",
    value: { title: "First" },
  }, {
    run: async (intent) => {
      writes.push(intent.value.title);
      await releaseFirstWrite.promise;
    },
  });
  await delay(0);
  requestGlossaryWriteIntent({
    key,
    scope,
    teamId: "team-1",
    glossaryId: "glossary-1",
    type: "glossaryTitle",
    value: { title: "Second" },
  }, {
    run: async (intent) => {
      writes.push(intent.value.title);
    },
  });

  releaseFirstWrite.resolve();
  await delay(10);

  assert.deepEqual(writes, ["First", "Second"]);
  assert.equal(getGlossaryWriteIntent(key).value.title, "Second");
});

test("same glossary lifecycle key coalesces delete and restore to latest value", async () => {
  const writes = [];
  const releaseFirstWrite = deferred();
  const key = glossaryLifecycleIntentKey("glossary-1");
  const scope = teamMetadataWriteScope({ installationId: 1 });

  requestGlossaryWriteIntent({
    key,
    scope,
    teamId: "team-1",
    glossaryId: "glossary-1",
    type: "glossaryLifecycle",
    value: { lifecycleState: "deleted" },
  }, {
    run: async (intent) => {
      writes.push(intent.value.lifecycleState);
      await releaseFirstWrite.promise;
    },
  });
  await delay(0);
  requestGlossaryWriteIntent({
    key,
    scope,
    teamId: "team-1",
    glossaryId: "glossary-1",
    type: "glossaryLifecycle",
    value: { lifecycleState: "active" },
  }, {
    run: async (intent) => {
      writes.push(intent.value.lifecycleState);
    },
  });

  releaseFirstWrite.resolve();
  await delay(10);

  assert.deepEqual(writes, ["deleted", "active"]);
  assert.equal(getGlossaryWriteIntent(key).value.lifecycleState, "active");
});

test("writes in the same team metadata scope serialize", async () => {
  const events = [];
  const scope = teamMetadataWriteScope({ installationId: 1 });

  requestGlossaryWriteIntent({
    key: glossaryTitleIntentKey("glossary-1"),
    scope,
    teamId: "team-1",
    glossaryId: "glossary-1",
    type: "glossaryTitle",
    value: { title: "A" },
  }, {
    run: async () => {
      events.push("a:start");
      await delay(5);
      events.push("a:end");
    },
  });
  requestGlossaryWriteIntent({
    key: glossaryTitleIntentKey("glossary-2"),
    scope,
    teamId: "team-1",
    glossaryId: "glossary-2",
    type: "glossaryTitle",
    value: { title: "B" },
  }, {
    run: async () => {
      events.push("b:start");
      events.push("b:end");
    },
  });

  await delay(20);

  assert.deepEqual(events, ["a:start", "a:end", "b:start", "b:end"]);
});

test("repo sync intents are active but not mutating writes", async () => {
  const release = deferred();

  requestGlossaryWriteIntent({
    key: glossaryRepoSyncIntentKey("repo-1"),
    scope: "glossary-repo:1:repo-1",
    teamId: "team-1",
    glossaryId: "glossary-1",
    type: "glossaryRepoSync",
    value: { requestedAt: 1 },
  }, {
    clearOnSuccess: true,
    run: async () => {
      await release.promise;
    },
  });

  await delay(0);

  assert.equal(anyGlossaryWriteIsActive(), true);
  assert.equal(anyGlossaryMutatingWriteIsActive(), false);

  release.resolve();
  await delay(5);
});

test("stale refresh snapshots are overlaid with desired intents and confirmed later", () => {
  const key = glossaryTitleIntentKey("glossary-1");
  requestGlossaryWriteIntent({
    key,
    scope: teamMetadataWriteScope({ installationId: 1 }),
    teamId: "team-1",
    glossaryId: "glossary-1",
    type: "glossaryTitle",
    value: { title: "Desired" },
  }, {
    run: async () => {},
  });

  const staleSnapshot = {
    glossaries: [glossary({ title: "Server" })],
  };
  const overlaid = applyGlossaryWriteIntentsToSnapshot(staleSnapshot);

  assert.equal(overlaid.glossaries[0].title, "Desired");
  assert.equal(overlaid.glossaries[0].pendingMutation, "rename");
  clearConfirmedGlossaryWriteIntents(overlaid);
  assert.equal(getGlossaryWriteIntent(key), null);
});

test("stale failed writes do not override newer intents", async () => {
  const key = glossaryTitleIntentKey("glossary-1");
  const scope = teamMetadataWriteScope({ installationId: 1 });
  const releaseFirstWrite = deferred();
  const writes = [];

  requestGlossaryWriteIntent({
    key,
    scope,
    teamId: "team-1",
    glossaryId: "glossary-1",
    type: "glossaryTitle",
    value: { title: "First" },
  }, {
    run: async (intent) => {
      writes.push(intent.value.title);
      await releaseFirstWrite.promise;
      throw new Error("first failed");
    },
  });
  await delay(0);
  requestGlossaryWriteIntent({
    key,
    scope,
    teamId: "team-1",
    glossaryId: "glossary-1",
    type: "glossaryTitle",
    value: { title: "Second" },
  }, {
    run: async (intent) => {
      writes.push(intent.value.title);
    },
  });

  releaseFirstWrite.resolve();
  await delay(10);

  assert.deepEqual(writes, ["First", "Second"]);
  assert.equal(getGlossaryWriteIntent(key).status, "pendingConfirmation");
  assert.equal(getGlossaryWriteIntent(key).error, "");
});
