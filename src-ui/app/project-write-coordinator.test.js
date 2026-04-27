import test from "node:test";
import assert from "node:assert/strict";

const {
  applyProjectWriteIntentsToSnapshot,
  anyProjectMutatingWriteIsActive,
  anyProjectWriteIsActive,
  chapterGlossaryIntentKey,
  chapterLifecycleIntentKey,
  chapterTitleIntentKey,
  clearConfirmedProjectWriteIntents,
  getProjectWriteIntent,
  projectRepoSyncIntentKey,
  projectRepoWriteScope,
  projectLifecycleIntentKey,
  projectTitleIntentKey,
  requestProjectWriteIntent,
  resetProjectWriteCoordinator,
  teamMetadataWriteScope,
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

test("stale refresh snapshots are overlaid with desired intents and confirmed after write success", async () => {
  const key = chapterGlossaryIntentKey("project-1", "chapter-1");
  const releaseWrite = deferred();
  requestProjectWriteIntent({
    key,
    scope: projectRepoWriteScope({ installationId: 1 }, "project-1"),
    teamId: "team-1",
    projectId: "project-1",
    chapterId: "chapter-1",
    type: "chapterGlossary",
    value: { glossary: { glossaryId: "b", repoName: "glossary-b" } },
  }, {
    run: async () => {
      await releaseWrite.promise;
    },
  });
  await delay(0);

  const staleSnapshot = {
    items: [project({ chapters: [chapter({ linkedGlossary: { glossaryId: "a", repoName: "glossary-a" } })] })],
    deletedItems: [],
  };
  const overlaid = applyProjectWriteIntentsToSnapshot(staleSnapshot);

  assert.equal(overlaid.items[0].chapters[0].linkedGlossary.glossaryId, "b");
  clearConfirmedProjectWriteIntents(overlaid);
  assert.equal(getProjectWriteIntent(key).status, "running");

  releaseWrite.resolve();
  await delay(5);

  clearConfirmedProjectWriteIntents(overlaid);
  assert.equal(getProjectWriteIntent(key), null);
});

test("matching refresh snapshots do not clear running project rename intents", async () => {
  const key = projectTitleIntentKey("project-1");
  const releaseWrite = deferred();
  requestProjectWriteIntent({
    key,
    scope: teamMetadataWriteScope({ installationId: 1 }),
    teamId: "team-1",
    projectId: "project-1",
    type: "projectTitle",
    value: { title: "Renamed Project" },
  }, {
    run: async () => {
      await releaseWrite.promise;
    },
  });
  await delay(0);

  clearConfirmedProjectWriteIntents({
    items: [project({ title: "Renamed Project" })],
    deletedItems: [],
  });

  assert.equal(getProjectWriteIntent(key).status, "running");
  const overlaid = applyProjectWriteIntentsToSnapshot({
    items: [project({ title: "Old Project" })],
    deletedItems: [],
  });
  assert.equal(overlaid.items[0].title, "Renamed Project");
  assert.equal(overlaid.items[0].pendingMutation, "rename");

  releaseWrite.resolve();
  await delay(5);
  clearConfirmedProjectWriteIntents(overlaid);
  assert.equal(getProjectWriteIntent(key), null);
});

test("matching refresh snapshots do not clear running project soft-delete intents", async () => {
  const key = projectLifecycleIntentKey("project-1");
  const releaseWrite = deferred();
  requestProjectWriteIntent({
    key,
    scope: teamMetadataWriteScope({ installationId: 1 }),
    teamId: "team-1",
    projectId: "project-1",
    type: "projectLifecycle",
    value: { lifecycleState: "deleted" },
  }, {
    run: async () => {
      await releaseWrite.promise;
    },
  });
  await delay(0);

  clearConfirmedProjectWriteIntents({
    items: [],
    deletedItems: [project({ lifecycleState: "deleted" })],
  });

  assert.equal(getProjectWriteIntent(key).status, "running");
  const overlaid = applyProjectWriteIntentsToSnapshot({
    items: [project({ lifecycleState: "active" })],
    deletedItems: [],
  });
  assert.equal(overlaid.deletedItems[0].id, "project-1");
  assert.equal(overlaid.deletedItems[0].pendingMutation, "softDelete");

  releaseWrite.resolve();
  await delay(5);
  clearConfirmedProjectWriteIntents(overlaid);
  assert.equal(getProjectWriteIntent(key), null);
});

test("matching refresh snapshots do not clear running project restore intents", async () => {
  const key = projectLifecycleIntentKey("project-1");
  const releaseWrite = deferred();
  requestProjectWriteIntent({
    key,
    scope: teamMetadataWriteScope({ installationId: 1 }),
    teamId: "team-1",
    projectId: "project-1",
    type: "projectLifecycle",
    value: { lifecycleState: "active" },
  }, {
    run: async () => {
      await releaseWrite.promise;
    },
  });
  await delay(0);

  clearConfirmedProjectWriteIntents({
    items: [project({ lifecycleState: "active" })],
    deletedItems: [],
  });

  assert.equal(getProjectWriteIntent(key).status, "running");
  const staleDeletedSnapshot = {
    items: [],
    deletedItems: [project({ lifecycleState: "deleted" })],
  };
  const overlaid = applyProjectWriteIntentsToSnapshot(staleDeletedSnapshot);
  assert.equal(overlaid.items[0].id, "project-1");
  assert.equal(overlaid.items[0].pendingMutation, "restore");

  releaseWrite.resolve();
  await delay(5);
  clearConfirmedProjectWriteIntents(overlaid);
  assert.equal(getProjectWriteIntent(key), null);
});

test("matching refresh snapshots do not clear running chapter rename intents", async () => {
  const key = chapterTitleIntentKey("project-1", "chapter-1");
  const releaseWrite = deferred();
  requestProjectWriteIntent({
    key,
    scope: projectRepoWriteScope({ installationId: 1 }, "project-1"),
    teamId: "team-1",
    projectId: "project-1",
    chapterId: "chapter-1",
    type: "chapterTitle",
    value: { title: "Renamed Chapter" },
  }, {
    run: async () => {
      await releaseWrite.promise;
    },
  });
  await delay(0);

  clearConfirmedProjectWriteIntents({
    items: [project({ chapters: [chapter({ name: "Renamed Chapter" })] })],
    deletedItems: [],
  });

  assert.equal(getProjectWriteIntent(key).status, "running");
  const overlaid = applyProjectWriteIntentsToSnapshot({
    items: [project({ chapters: [chapter({ name: "Old Chapter" })] })],
    deletedItems: [],
  });
  assert.equal(overlaid.items[0].chapters[0].name, "Renamed Chapter");
  assert.equal(overlaid.items[0].chapters[0].pendingMutation, "rename");

  releaseWrite.resolve();
  await delay(5);
  clearConfirmedProjectWriteIntents(overlaid);
  assert.equal(getProjectWriteIntent(key), null);
});

test("matching refresh snapshots do not clear running chapter soft-delete intents", async () => {
  const key = chapterLifecycleIntentKey("project-1", "chapter-1");
  const releaseWrite = deferred();
  requestProjectWriteIntent({
    key,
    scope: projectRepoWriteScope({ installationId: 1 }, "project-1"),
    teamId: "team-1",
    projectId: "project-1",
    chapterId: "chapter-1",
    type: "chapterLifecycle",
    value: { status: "deleted" },
  }, {
    run: async () => {
      await releaseWrite.promise;
    },
  });
  await delay(0);

  clearConfirmedProjectWriteIntents({
    items: [project({ chapters: [chapter({ status: "deleted" })] })],
    deletedItems: [],
  });

  assert.equal(getProjectWriteIntent(key).status, "running");
  const overlaid = applyProjectWriteIntentsToSnapshot({
    items: [project({ chapters: [chapter({ status: "active" })] })],
    deletedItems: [],
  });
  assert.equal(overlaid.items[0].chapters[0].status, "deleted");
  assert.equal(overlaid.items[0].chapters[0].pendingMutation, "softDelete");

  releaseWrite.resolve();
  await delay(5);
  clearConfirmedProjectWriteIntents(overlaid);
  assert.equal(getProjectWriteIntent(key), null);
});

test("matching refresh snapshots do not clear running chapter restore intents", async () => {
  const key = chapterLifecycleIntentKey("project-1", "chapter-1");
  const releaseWrite = deferred();
  requestProjectWriteIntent({
    key,
    scope: projectRepoWriteScope({ installationId: 1 }, "project-1"),
    teamId: "team-1",
    projectId: "project-1",
    chapterId: "chapter-1",
    type: "chapterLifecycle",
    value: { status: "active" },
  }, {
    run: async () => {
      await releaseWrite.promise;
    },
  });
  await delay(0);

  clearConfirmedProjectWriteIntents({
    items: [project({ chapters: [chapter({ status: "active" })] })],
    deletedItems: [],
  });

  assert.equal(getProjectWriteIntent(key).status, "running");
  const overlaid = applyProjectWriteIntentsToSnapshot({
    items: [project({ chapters: [chapter({ status: "deleted" })] })],
    deletedItems: [],
  });
  assert.equal(overlaid.items[0].chapters[0].status, "active");
  assert.equal(overlaid.items[0].chapters[0].pendingMutation, "restore");

  releaseWrite.resolve();
  await delay(5);
  clearConfirmedProjectWriteIntents(overlaid);
  assert.equal(getProjectWriteIntent(key), null);
});

test("matching refresh snapshots do not clear running chapter glossary unlink intents", async () => {
  const key = chapterGlossaryIntentKey("project-1", "chapter-1");
  const releaseWrite = deferred();
  requestProjectWriteIntent({
    key,
    scope: projectRepoWriteScope({ installationId: 1 }, "project-1"),
    teamId: "team-1",
    projectId: "project-1",
    chapterId: "chapter-1",
    type: "chapterGlossary",
    value: { glossary: null },
  }, {
    run: async () => {
      await releaseWrite.promise;
    },
  });
  await delay(0);

  clearConfirmedProjectWriteIntents({
    items: [project({ chapters: [chapter({ linkedGlossary: null })] })],
    deletedItems: [],
  });

  assert.equal(getProjectWriteIntent(key).status, "running");
  const overlaid = applyProjectWriteIntentsToSnapshot({
    items: [project({
      chapters: [chapter({ linkedGlossary: { glossaryId: "a", repoName: "glossary-a" } })],
    })],
    deletedItems: [],
  });
  assert.equal(overlaid.items[0].chapters[0].linkedGlossary, null);
  assert.equal(overlaid.items[0].chapters[0].pendingGlossaryMutation, true);

  releaseWrite.resolve();
  await delay(5);
  clearConfirmedProjectWriteIntents(overlaid);
  assert.equal(getProjectWriteIntent(key), null);
});
