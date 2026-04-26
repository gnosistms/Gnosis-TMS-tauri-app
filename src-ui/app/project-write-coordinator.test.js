import test from "node:test";
import assert from "node:assert/strict";

const {
  applyProjectWriteIntentsToSnapshot,
  anyProjectMutatingWriteIsActive,
  anyProjectWriteIsActive,
  chapterGlossaryIntentKey,
  clearConfirmedProjectWriteIntents,
  getProjectWriteIntent,
  projectRepoSyncIntentKey,
  projectRepoWriteScope,
  projectTitleIntentKey,
  requestProjectWriteIntent,
  resetProjectWriteCoordinator,
} = await import("./project-write-coordinator.js");

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

function project(overrides = {}) {
  return {
    id: "project-1",
    name: "project-repo",
    title: "Project",
    chapters: [],
    ...overrides,
  };
}

function chapter(overrides = {}) {
  return {
    id: "chapter-1",
    name: "Chapter",
    status: "active",
    linkedGlossary: null,
    ...overrides,
  };
}

test.afterEach(() => {
  resetProjectWriteCoordinator();
});

test("same write intent key coalesces to the latest value", async () => {
  const writes = [];
  const releaseFirstWrite = deferred();
  const key = projectTitleIntentKey("project-1");
  const scope = "team-metadata:1";

  requestProjectWriteIntent({
    key,
    scope,
    teamId: "team-1",
    projectId: "project-1",
    type: "projectTitle",
    value: { title: "First" },
  }, {
    run: async (intent) => {
      writes.push(intent.value.title);
      await releaseFirstWrite.promise;
    },
  });
  await delay(0);
  requestProjectWriteIntent({
    key,
    scope,
    teamId: "team-1",
    projectId: "project-1",
    type: "projectTitle",
    value: { title: "Second" },
  }, {
    run: async (intent) => {
      writes.push(intent.value.title);
    },
  });

  releaseFirstWrite.resolve();
  await delay(10);

  assert.deepEqual(writes, ["First", "Second"]);
  assert.equal(getProjectWriteIntent(key).value.title, "Second");
});

test("writes in the same scope serialize", async () => {
  const events = [];
  const scope = projectRepoWriteScope({ installationId: 1 }, "project-1");

  requestProjectWriteIntent({
    key: chapterGlossaryIntentKey("project-1", "chapter-1"),
    scope,
    teamId: "team-1",
    projectId: "project-1",
    chapterId: "chapter-1",
    type: "chapterGlossary",
    value: { glossary: { glossaryId: "a", repoName: "a" } },
  }, {
    run: async () => {
      events.push("a:start");
      await delay(5);
      events.push("a:end");
    },
  });
  requestProjectWriteIntent({
    key: chapterGlossaryIntentKey("project-1", "chapter-2"),
    scope,
    teamId: "team-1",
    projectId: "project-1",
    chapterId: "chapter-2",
    type: "chapterGlossary",
    value: { glossary: { glossaryId: "b", repoName: "b" } },
  }, {
    run: async () => {
      events.push("b:start");
      events.push("b:end");
    },
  });

  await delay(20);

  assert.deepEqual(events, ["a:start", "a:end", "b:start", "b:end"]);
});

test("one-shot sync intents clear after success", async () => {
  const key = projectRepoSyncIntentKey("project-1");

  requestProjectWriteIntent({
    key,
    scope: projectRepoWriteScope({ installationId: 1 }, "project-1"),
    teamId: "team-1",
    projectId: "project-1",
    type: "projectRepoSync",
    value: { requestedAt: 1 },
  }, {
    clearOnSuccess: true,
    run: async () => {},
  });

  await delay(5);

  assert.equal(getProjectWriteIntent(key), null);
});

test("repo sync intents are active but not mutating writes", async () => {
  const release = deferred();

  requestProjectWriteIntent({
    key: projectRepoSyncIntentKey("project-1"),
    scope: projectRepoWriteScope({ installationId: 1 }, "project-1"),
    teamId: "team-1",
    projectId: "project-1",
    type: "projectRepoSync",
    value: { requestedAt: 1 },
  }, {
    clearOnSuccess: true,
    run: async () => {
      await release.promise;
    },
  });

  await delay(0);

  assert.equal(anyProjectWriteIsActive(), true);
  assert.equal(anyProjectMutatingWriteIsActive(), false);

  release.resolve();
  await delay(5);
});

test("writes in different scopes can run concurrently", async () => {
  const events = [];
  const release = deferred();

  requestProjectWriteIntent({
    key: chapterGlossaryIntentKey("project-1", "chapter-1"),
    scope: projectRepoWriteScope({ installationId: 1 }, "project-1"),
    teamId: "team-1",
    projectId: "project-1",
    chapterId: "chapter-1",
    type: "chapterGlossary",
    value: { glossary: { glossaryId: "a", repoName: "a" } },
  }, {
    run: async () => {
      events.push("a:start");
      await release.promise;
      events.push("a:end");
    },
  });
  requestProjectWriteIntent({
    key: chapterGlossaryIntentKey("project-2", "chapter-2"),
    scope: projectRepoWriteScope({ installationId: 1 }, "project-2"),
    teamId: "team-1",
    projectId: "project-2",
    chapterId: "chapter-2",
    type: "chapterGlossary",
    value: { glossary: { glossaryId: "b", repoName: "b" } },
  }, {
    run: async () => {
      events.push("b:start");
      events.push("b:end");
    },
  });

  await delay(5);
  release.resolve();
  await delay(5);

  assert.deepEqual(events, ["a:start", "b:start", "b:end", "a:end"]);
});

test("stale refresh snapshots are overlaid with desired intents and confirmed later", () => {
  const key = chapterGlossaryIntentKey("project-1", "chapter-1");
  requestProjectWriteIntent({
    key,
    scope: projectRepoWriteScope({ installationId: 1 }, "project-1"),
    teamId: "team-1",
    projectId: "project-1",
    chapterId: "chapter-1",
    type: "chapterGlossary",
    value: { glossary: { glossaryId: "b", repoName: "glossary-b" } },
  }, {
    run: async () => {},
  });

  const staleSnapshot = {
    items: [project({ chapters: [chapter({ linkedGlossary: { glossaryId: "a", repoName: "glossary-a" } })] })],
    deletedItems: [],
  };
  const overlaid = applyProjectWriteIntentsToSnapshot(staleSnapshot);

  assert.equal(overlaid.items[0].chapters[0].linkedGlossary.glossaryId, "b");
  clearConfirmedProjectWriteIntents(overlaid);
  assert.equal(getProjectWriteIntent(key), null);
});
