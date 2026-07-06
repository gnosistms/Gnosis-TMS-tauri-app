import test from "node:test";
import assert from "node:assert/strict";

const invokeLog = [];
let invokeHandler = async () => null;

globalThis.document = globalThis.document ?? {
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.window = {
  __TAURI__: {
    core: {
      invoke(command, payload = {}) {
        invokeLog.push({ command, payload });
        return invokeHandler(command, payload);
      },
    },
  },
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
  setTimeout,
  clearTimeout,
};

const { state, resetSessionState } = await import("./state.js");
const { queryClient } = await import("./query-client.js");
const {
  chapterGlossaryIntentKey,
  chapterWorkflowStatusIntentKey,
  getProjectWriteIntent,
  resetProjectWriteCoordinator,
} = await import("./project-write-coordinator.js");
const { resetRepoWriteQueue } = await import("./repo-write-queue.js");
const {
  resetDeferredProjectRepoSyncsForTests,
  updateChapterGlossaryLinks,
  updateChapterWorkflowStatus,
} = await import("./project-chapter-flow.js");

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate) {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) {
      return;
    }
    await delay(5);
  }
  assert.equal(predicate(), true);
}

function seedProjectState(chapterOverrides = {}) {
  resetSessionState();
  resetProjectWriteCoordinator();
  resetRepoWriteQueue();
  queryClient.clear();
  invokeLog.length = 0;
  state.selectedTeamId = "team-1";
  state.teams = [{
    id: "team-1",
    installationId: 1,
    canManageProjects: true,
    canDelete: true,
  }];
  state.projects = [{
    id: "project-1",
    name: "project-repo",
    title: "Project",
    status: "active",
    chapters: [{
      id: "chapter-1",
      name: "Chapter",
      status: "active",
      workflowStatus: "queued",
      linkedGlossary: { glossaryId: "glossary-1", repoName: "glossary-repo-1" },
      ...chapterOverrides,
    }],
  }];
  state.glossaries = [
    { id: "glossary-1", title: "Glossary 1", repoName: "glossary-repo-1" },
    { id: "glossary-2", title: "Glossary 2", repoName: "glossary-repo-2" },
  ];
}

test.afterEach(() => {
  resetDeferredProjectRepoSyncsForTests();
  resetProjectWriteCoordinator();
  resetRepoWriteQueue();
  resetSessionState();
  queryClient.clear();
  invokeHandler = async () => null;
  invokeLog.length = 0;
});

function findChapter(chapterId) {
  return state.projects[0].chapters.find((chapter) => chapter.id === chapterId);
}

// Update commands resolve like a real backend; everything else (tombstone
// lookups etc.) throws like the failure-path tests' environment — the lookup
// swallows those errors instead of escalating to broker queries.
function updateOnlyInvokeHandler(delayMs) {
  return async (command) => {
    if (command.startsWith("update_gtms_chapter_")) {
      return new Promise((resolve) => setTimeout(() => resolve(null), delayMs));
    }
    throw new Error(`unmocked command: ${command}`);
  };
}

test("metadata writes apply optimistically in the same task as the call", async () => {
  seedProjectState();
  invokeHandler = updateOnlyInvokeHandler(20);

  // No await: the optimistic state write must not depend on any async step.
  void updateChapterWorkflowStatus(() => {}, "chapter-1", "review2");
  assert.equal(findChapter("chapter-1").workflowStatus, "review2");
  assert.equal(findChapter("chapter-1").pendingWorkflowStatusMutation, true);

  void updateChapterGlossaryLinks(() => {}, "chapter-1", "glossary-2");
  assert.deepEqual(findChapter("chapter-1").linkedGlossary, {
    glossaryId: "glossary-2",
    repoName: "glossary-repo-2",
  });
  assert.equal(findChapter("chapter-1").pendingGlossaryMutation, true);

  // Drain the in-flight writes before the test ends: the queue loop would
  // otherwise complete against the next test's same-keyed intents.
  await waitFor(() =>
    getProjectWriteIntent(chapterWorkflowStatusIntentKey("project-1", "chapter-1"))?.status === "pendingConfirmation"
    && getProjectWriteIntent(chapterGlossaryIntentKey("project-1", "chapter-1"))?.status === "pendingConfirmation");
});

test("a rapid burst across chapters lands every write and clears flags", async () => {
  seedProjectState();
  state.projects[0].chapters.push(
    {
      id: "chapter-2",
      name: "Chapter 2",
      status: "active",
      workflowStatus: "queued",
      linkedGlossary: null,
    },
    {
      id: "chapter-3",
      name: "Chapter 3",
      status: "active",
      workflowStatus: "queued",
      linkedGlossary: null,
    },
  );
  invokeHandler = updateOnlyInvokeHandler(10);

  // Click through as fast as possible: alternating fields across chapters.
  void updateChapterWorkflowStatus(() => {}, "chapter-1", "review2");
  void updateChapterGlossaryLinks(() => {}, "chapter-2", "glossary-2");
  void updateChapterWorkflowStatus(() => {}, "chapter-3", "translating");
  void updateChapterGlossaryLinks(() => {}, "chapter-1", "glossary-2");

  // All four applied optimistically before any write completed.
  assert.equal(findChapter("chapter-1").workflowStatus, "review2");
  assert.deepEqual(findChapter("chapter-2").linkedGlossary, {
    glossaryId: "glossary-2",
    repoName: "glossary-repo-2",
  });
  assert.equal(findChapter("chapter-3").workflowStatus, "translating");
  assert.deepEqual(findChapter("chapter-1").linkedGlossary, {
    glossaryId: "glossary-2",
    repoName: "glossary-repo-2",
  });

  await waitFor(() =>
    invokeLog.filter((entry) => entry.command.startsWith("update_gtms_chapter_")).length === 4);
  await waitFor(() =>
    getProjectWriteIntent(chapterGlossaryIntentKey("project-1", "chapter-1"))?.status === "pendingConfirmation");

  // Nothing reverted, every pending flag cleared.
  assert.equal(findChapter("chapter-1").workflowStatus, "review2");
  assert.equal(findChapter("chapter-1").pendingWorkflowStatusMutation, false);
  assert.deepEqual(findChapter("chapter-2").linkedGlossary, {
    glossaryId: "glossary-2",
    repoName: "glossary-repo-2",
  });
  assert.equal(findChapter("chapter-2").pendingGlossaryMutation, false);
  assert.equal(findChapter("chapter-3").workflowStatus, "translating");
  assert.equal(findChapter("chapter-3").pendingWorkflowStatusMutation, false);
});

test("selecting the already-set value is a no-op", async () => {
  seedProjectState();

  await updateChapterWorkflowStatus(() => {}, "chapter-1", "queued");
  await updateChapterGlossaryLinks(() => {}, "chapter-1", "glossary-1");

  assert.equal(invokeLog.length, 0);
  assert.equal(findChapter("chapter-1").pendingWorkflowStatusMutation, undefined);
  assert.equal(findChapter("chapter-1").pendingGlossaryMutation, undefined);
});

test("failed chapter workflow status writes roll back the visible status", async () => {
  seedProjectState();
  invokeHandler = async () => {
    throw new Error("status write failed");
  };

  await updateChapterWorkflowStatus(() => {}, "chapter-1", "review2");
  assert.equal(state.projects[0].chapters[0].workflowStatus, "review2");

  await waitFor(() =>
    getProjectWriteIntent(chapterWorkflowStatusIntentKey("project-1", "chapter-1"))?.status === "failed"
  );

  assert.equal(state.projects[0].chapters[0].workflowStatus, "queued");
  assert.equal(state.projects[0].chapters[0].pendingWorkflowStatusMutation, false);
  assert.equal(state.projects[0].chapters[0].workflowStatusMutationError, "status write failed");
  assert.ok(
    invokeLog.some((entry) => entry.command === "update_gtms_chapter_workflow_status"),
    "the workflow status write should have been invoked",
  );
});

test("failed chapter glossary metadata writes roll back the visible glossary", async () => {
  seedProjectState();
  invokeHandler = async () => {
    throw new Error("glossary write failed");
  };

  await updateChapterGlossaryLinks(() => {}, "chapter-1", "glossary-2");
  assert.deepEqual(state.projects[0].chapters[0].linkedGlossary, {
    glossaryId: "glossary-2",
    repoName: "glossary-repo-2",
  });

  await waitFor(() =>
    getProjectWriteIntent(chapterGlossaryIntentKey("project-1", "chapter-1"))?.status === "failed"
  );

  assert.deepEqual(state.projects[0].chapters[0].linkedGlossary, {
    glossaryId: "glossary-1",
    repoName: "glossary-repo-1",
  });
  assert.equal(state.projects[0].chapters[0].pendingGlossaryMutation, false);
  assert.equal(state.projects[0].chapters[0].glossaryMutationError, "glossary write failed");
  assert.ok(
    invokeLog.some((entry) => entry.command === "update_gtms_chapter_glossary_links"),
    "the glossary link write should have been invoked",
  );
});
