import test from "node:test";
import assert from "node:assert/strict";

globalThis.document = {
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
  },
};

globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async () => null,
    },
  },
  __TAURI_INTERNALS__: null,
  open() {},
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame(callback) {
    callback?.();
    return 1;
  },
  setTimeout() {
    return 1;
  },
  clearTimeout() {},
};

const {
  createEditorChapterState,
  createStatusBadgesState,
  resetSessionState,
  state,
} = await import("./state.js");
const { EDITOR_MODE_PREVIEW } = await import("./editor-preview.js");
const { openEditorExportOptions } = await import("./editor-export-flow.js");
const {
  currentTeamCopyState,
  eligibleTeamCopyTargets,
  handleTeamChapterCopyProgressEvent,
  selectTeamCopyTargetProject,
  selectTeamCopyTargetTeam,
  selectedTeamCopyProject,
  submitTeamChapterCopy,
} = await import("./editor-export-team-copy-flow.js");

const otherTeamProject = {
  id: "project-9",
  repoId: 909,
  name: "other-repo",
  title: "Other Project",
  status: "active",
  fullName: "other-org/other-repo",
  defaultBranchName: "main",
  defaultBranchHeadOid: "abc123",
};

function installTeamCopyFixture() {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.teams = [
    { id: "team-1", installationId: 42, name: "Home Team", membershipRole: "owner" },
    { id: "team-2", installationId: 77, name: "Other Team", membershipRole: "translator" },
    { id: "team-3", installationId: 88, name: "Read Only Team", membershipRole: "viewer" },
  ];
  state.projects = [{
    id: "project-1",
    title: "Project",
    name: "project-repo",
    fullName: "org/project-repo",
    chapters: [{
      id: "chapter-1",
      name: "Chapter One",
      status: "active",
      languages: [
        { code: "es", name: "Spanish", role: "source" },
        { code: "vi", name: "Vietnamese", role: "target" },
      ],
    }],
  }];
  state.deletedProjects = [];
  state.statusBadges = createStatusBadgesState();
  state.editorChapter = {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    projectId: "project-1",
    fileTitle: "Chapter One",
    mode: EDITOR_MODE_PREVIEW,
    selectedSourceLanguageCode: "es",
    selectedTargetLanguageCode: "vi",
    rows: [],
  };
  openEditorExportOptions(() => {});
  state.editorChapter = {
    ...state.editorChapter,
    exportModal: {
      ...state.editorChapter.exportModal,
      selectedOptionId: "link:team",
    },
  };
}

test.afterEach(() => {
  resetSessionState();
});

test("eligibleTeamCopyTargets keeps writable teams and drops the open chapter's team", () => {
  installTeamCopyFixture();

  assert.deepEqual(
    eligibleTeamCopyTargets().map((team) => team.id),
    ["team-2"],
  );
});

test("selectTeamCopyTargetTeam loads the team's projects and skips deleted records", async () => {
  installTeamCopyFixture();
  const invokeCalls = [];
  let resolveProjects;
  const projectsPromise = new Promise((resolve) => {
    resolveProjects = resolve;
  });

  selectTeamCopyTargetTeam(() => {}, "team-2", {
    invoke: async (command, payload) => {
      invokeCalls.push({ command, payload });
      return projectsPromise;
    },
    requireBrokerSession: () => "session-token",
  });

  assert.equal(currentTeamCopyState().targetTeamId, "team-2");
  assert.equal(currentTeamCopyState().projectsStatus, "loading");

  resolveProjects([
    otherTeamProject,
    { ...otherTeamProject, id: "project-10", title: "Deleted", status: "deleted" },
  ]);
  await projectsPromise;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(invokeCalls.length, 1);
  assert.equal(invokeCalls[0].command, "list_gnosis_projects_for_installation");
  assert.deepEqual(invokeCalls[0].payload, {
    installationId: 77,
    sessionToken: "session-token",
  });
  assert.equal(currentTeamCopyState().projectsStatus, "done");
  assert.deepEqual(
    currentTeamCopyState().projects.map((project) => project.id),
    ["project-9"],
  );
});

test("a stale project load is discarded after the target team changes", async () => {
  installTeamCopyFixture();
  let resolveProjects;
  const projectsPromise = new Promise((resolve) => {
    resolveProjects = resolve;
  });

  selectTeamCopyTargetTeam(() => {}, "team-2", {
    invoke: async () => projectsPromise,
    requireBrokerSession: () => "session-token",
  });
  // The user clears the team before the load resolves.
  selectTeamCopyTargetTeam(() => {}, "", {
    invoke: async () => [],
    requireBrokerSession: () => "session-token",
  });

  resolveProjects([otherTeamProject]);
  await projectsPromise;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(currentTeamCopyState().targetTeamId, "");
  assert.deepEqual(currentTeamCopyState().projects, []);
  assert.equal(currentTeamCopyState().projectsStatus, "idle");
});

test("selectTeamCopyTargetProject only accepts loaded projects", () => {
  installTeamCopyFixture();
  state.editorChapter = {
    ...state.editorChapter,
    exportModal: {
      ...state.editorChapter.exportModal,
      teamCopy: {
        ...state.editorChapter.exportModal.teamCopy,
        targetTeamId: "team-2",
        projectsStatus: "done",
        projects: [otherTeamProject],
      },
    },
  };

  selectTeamCopyTargetProject(() => {}, "project-9");
  assert.equal(currentTeamCopyState().targetProjectId, "project-9");
  assert.equal(selectedTeamCopyProject(currentTeamCopyState()).id, "project-9");

  selectTeamCopyTargetProject(() => {}, "project-bogus");
  assert.equal(currentTeamCopyState().targetProjectId, "");
});

test("submitTeamChapterCopy requires a destination before invoking", async () => {
  installTeamCopyFixture();
  const invokeCalls = [];

  await submitTeamChapterCopy(() => {}, {
    invoke: async (command) => {
      invokeCalls.push(command);
    },
    requireBrokerSession: () => "session-token",
    waitForRepoQueue: async () => {},
  });

  assert.equal(invokeCalls.length, 0);
  assert.match(state.editorChapter.exportModal.error, /destination team and project/);
});

test("submitTeamChapterCopy invokes the copy command with source and target", async () => {
  installTeamCopyFixture();
  state.editorChapter = {
    ...state.editorChapter,
    exportModal: {
      ...state.editorChapter.exportModal,
      teamCopy: {
        ...state.editorChapter.exportModal.teamCopy,
        targetTeamId: "team-2",
        projectsStatus: "done",
        projects: [otherTeamProject],
        targetProjectId: "project-9",
      },
    },
  };
  const invokeCalls = [];
  const queueScopes = [];

  await submitTeamChapterCopy(() => {}, {
    invoke: async (command, payload) => {
      invokeCalls.push({ command, payload });
      return null;
    },
    requireBrokerSession: () => "session-token",
    waitForRepoQueue: async (scope) => {
      queueScopes.push(scope);
    },
  });

  assert.equal(queueScopes.length, 1);
  assert.equal(invokeCalls.length, 1);
  assert.equal(invokeCalls[0].command, "copy_gtms_chapter_to_team");
  assert.equal(invokeCalls[0].payload.sessionToken, "session-token");
  const input = invokeCalls[0].payload.input;
  assert.equal(typeof input.jobId, "string");
  assert.notEqual(input.jobId, "");
  assert.deepEqual(input.source, {
    installationId: 42,
    projectId: "project-1",
    repoName: "project-repo",
    chapterId: "chapter-1",
    projectTitle: "Project",
  });
  assert.deepEqual(input.target, {
    installationId: 77,
    projectId: "project-9",
    repoName: "other-repo",
    fullName: "other-org/other-repo",
    repoId: 909,
    defaultBranchName: "main",
    defaultBranchHeadOid: "abc123",
    status: "active",
    projectTitle: "Other Project",
  });
  assert.equal(state.editorChapter.exportModal.status, "exporting");
  assert.equal(currentTeamCopyState().jobId, input.jobId);
});

test("copy progress events drive stage, success, and error states by job id", () => {
  installTeamCopyFixture();
  state.editorChapter = {
    ...state.editorChapter,
    exportModal: {
      ...state.editorChapter.exportModal,
      status: "exporting",
      teamCopy: {
        ...state.editorChapter.exportModal.teamCopy,
        jobId: "job-1",
      },
    },
  };

  handleTeamChapterCopyProgressEvent({ jobId: "job-other", status: "progress", message: "Nope" }, () => {});
  assert.equal(currentTeamCopyState().copyStage, "");

  handleTeamChapterCopyProgressEvent({ jobId: "job-1", status: "progress", message: "Copying the chapter..." }, () => {});
  assert.equal(currentTeamCopyState().copyStage, "Copying the chapter...");

  handleTeamChapterCopyProgressEvent({
    jobId: "job-1",
    status: "success",
    message: "Copied \"Chapter One\".",
    targetProjectTitle: "Other Project",
  }, () => {});
  assert.equal(state.editorChapter.exportModal.isOpen, false);
  assert.equal(state.editorChapter.exportModal.status, "idle");
  assert.equal(currentTeamCopyState().jobId, "");

  state.editorChapter = {
    ...state.editorChapter,
    exportModal: {
      ...state.editorChapter.exportModal,
      isOpen: true,
      status: "exporting",
      teamCopy: {
        ...state.editorChapter.exportModal.teamCopy,
        jobId: "job-2",
      },
    },
  };
  handleTeamChapterCopyProgressEvent({ jobId: "job-2", status: "error", message: "The copy failed." }, () => {});
  assert.equal(state.editorChapter.exportModal.isOpen, true);
  assert.equal(state.editorChapter.exportModal.status, "idle");
  assert.match(state.editorChapter.exportModal.error, /copy failed/);
});
