import test from "node:test";
import assert from "node:assert/strict";

const {
  anyQaListMutatingWriteIsActive,
  anyQaListWriteIsActive,
  applyQaListWriteIntentsToSnapshot,
  clearConfirmedQaListWriteIntents,
  getQaListWriteIntent,
  qaListLifecycleIntentKey,
  qaListRepoSyncIntentKey,
  qaListTeamMetadataWriteScope,
  qaListTitleIntentKey,
  requestQaListWriteIntent,
  resetQaListWriteCoordinator,
} = await import("./qa-list-write-coordinator.js");

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

function qaList(overrides = {}) {
  return {
    id: "qa-list-1",
    repoName: "qa-list-repo",
    title: "QA list",
    lifecycleState: "active",
    ...overrides,
  };
}

test.afterEach(() => {
  resetQaListWriteCoordinator();
});

test("QA list title and lifecycle write intents overlay stale snapshots", async () => {
  const titleKey = qaListTitleIntentKey("qa-list-1");
  const lifecycleKey = qaListLifecycleIntentKey("qa-list-1");
  const scope = qaListTeamMetadataWriteScope({ installationId: 1 });
  const releaseTitleWrite = deferred();

  requestQaListWriteIntent({
    key: titleKey,
    scope,
    teamId: "team-1",
    qaListId: "qa-list-1",
    type: "qaListTitle",
    value: { title: "Desired title" },
  }, {
    run: async () => {
      await releaseTitleWrite.promise;
    },
  });
  requestQaListWriteIntent({
    key: lifecycleKey,
    scope,
    teamId: "team-1",
    qaListId: "qa-list-1",
    type: "qaListLifecycle",
    value: { lifecycleState: "deleted" },
  }, {
    run: async () => {},
  });
  await delay(0);

  const overlaid = applyQaListWriteIntentsToSnapshot({
    qaLists: [qaList({ title: "Server title", lifecycleState: "active" })],
  });

  assert.equal(overlaid.qaLists[0].title, "Desired title");
  assert.equal(overlaid.qaLists[0].lifecycleState, "deleted");
  assert.equal(overlaid.qaLists[0].pendingMutation, "softDelete");

  releaseTitleWrite.resolve();
  await delay(5);

  clearConfirmedQaListWriteIntents(overlaid);
  assert.equal(getQaListWriteIntent(titleKey), null);
  assert.equal(getQaListWriteIntent(lifecycleKey), null);
});

test("QA list repo sync intents are active but not mutating writes", async () => {
  const release = deferred();

  requestQaListWriteIntent({
    key: qaListRepoSyncIntentKey("repo-1"),
    scope: "qa-list-repo:1:repo-1",
    teamId: "team-1",
    qaListId: "qa-list-1",
    type: "qaListRepoSync",
    value: { requestedAt: 1 },
  }, {
    clearOnSuccess: true,
    run: async () => {
      await release.promise;
    },
  });

  await delay(0);

  assert.equal(anyQaListWriteIsActive(), true);
  assert.equal(anyQaListMutatingWriteIsActive(), false);

  release.resolve();
  await delay(5);
});
