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
  resetProjectWriteCoordinator();
  resetRepoWriteQueue();
  resetSessionState();
  queryClient.clear();
  invokeHandler = async () => null;
  invokeLog.length = 0;
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
