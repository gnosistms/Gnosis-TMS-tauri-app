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
  __TAURI__: null,
  __TAURI_INTERNALS__: null,
  open() {},
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame(callback) {
    return setTimeout(callback, 0);
  },
};

const { renderProjectsScreen } = await import("./projects.js");
const {
  chapterGlossaryIntentKey,
  projectRepoWriteScope,
  requestProjectWriteIntent,
  resetProjectWriteCoordinator,
} = await import("../app/project-write-coordinator.js");

function projectsState(overrides = {}) {
  return {
    selectedTeamId: "team-1",
    teams: [{
      id: "team-1",
      name: "Team",
      canManageProjects: true,
      canDelete: true,
    }],
    projects: [{
      id: "project-1",
      title: "Project",
      name: "project-repo",
      status: "active",
      chapters: [{
        id: "chapter-1",
        name: "Chapter",
        status: "active",
        linkedGlossary: null,
        sourceWordCount: 10,
      }],
    }],
    deletedProjects: [],
    glossaries: [{
      id: "glossary-1",
      title: "Glossary",
      repoName: "glossary-repo",
      lifecycleState: "active",
    }],
    expandedProjects: new Set(["project-1"]),
    expandedDeletedFiles: new Set(),
    projectsPage: {
      isRefreshing: false,
      writeState: "idle",
    },
    projectsPageSync: {
      status: "idle",
    },
    projectDiscovery: {
      status: "ready",
      error: "",
      glossaryWarning: "",
      recoveryMessage: "",
    },
    projectRepoSyncByProjectId: {},
    projectRepoConflictRecovery: {},
    projectImport: {},
    projectsSearch: {
      query: "",
      results: [],
      loading: false,
    },
    offline: {
      isEnabled: false,
    },
    statusBadges: {},
    ...overrides,
  };
}

function actionButtonHtml(html, action) {
  const escapedAction = action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.match(new RegExp(`<button[^>]*data-action="${escapedAction}"[^>]*>`))?.[0] ?? "";
}

test.afterEach(() => {
  resetProjectWriteCoordinator();
});

test("projects glossary selector stays enabled during project refresh", () => {
  const html = renderProjectsScreen(projectsState({
    projectsPage: {
      isRefreshing: true,
      writeState: "idle",
    },
    projectsPageSync: {
      status: "syncing",
    },
  }));

  assert.match(html, /data-chapter-glossary-select/);
  assert.doesNotMatch(html, /select-pill--chapter-glossary[^"]*\bis-disabled\b/);
  assert.doesNotMatch(html, /data-chapter-glossary-select[^>]*disabled/);
});

test("projects glossary selector keeps local selection and options during project refresh", () => {
  const html = renderProjectsScreen(projectsState({
    projectsPage: {
      isRefreshing: true,
      writeState: "idle",
    },
    projectsPageSync: {
      status: "syncing",
    },
    projects: [{
      id: "project-1",
      title: "Project",
      name: "project-repo",
      status: "active",
      chapters: [{
        id: "chapter-1",
        name: "Chapter",
        status: "active",
        linkedGlossary: { glossaryId: "glossary-1", repoName: "glossary-repo" },
        sourceWordCount: 10,
      }],
    }],
  }));

  assert.match(html, /select-pill__value">Glossary</);
  assert.match(html, /<option value="glossary-1" selected>Glossary<\/option>/);
  assert.doesNotMatch(html, /select-pill__value">no glossary</);
});

test("projects glossary selector is visibly disabled while project page write submissions are blocked", () => {
  const html = renderProjectsScreen(projectsState({
    projectsPage: {
      isRefreshing: false,
      writeState: "submitting",
    },
  }));

  assert.match(html, /select-pill--chapter-glossary[^"]*\bis-disabled\b/);
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /data-chapter-glossary-select[^>]*disabled/);
});

test("project refresh keeps top-level lifecycle actions enabled and heavy actions disabled", () => {
  const html = renderProjectsScreen(projectsState({
    projectsPage: {
      isRefreshing: true,
      writeState: "idle",
    },
    projects: [{
      id: "project-1",
      title: "Project",
      name: "project-repo",
      status: "active",
      chapters: [
        {
          id: "chapter-1",
          name: "Chapter",
          status: "active",
          linkedGlossary: null,
          sourceWordCount: 10,
        },
        {
          id: "deleted-chapter-1",
          name: "Deleted Chapter",
          status: "deleted",
          linkedGlossary: null,
          sourceWordCount: 10,
        },
      ],
    }],
    expandedDeletedFiles: new Set(["project-1"]),
    deletedProjects: [{
      id: "deleted-project",
      title: "Deleted Project",
      name: "deleted-project",
      lifecycleState: "deleted",
      chapters: [],
    }],
    showDeletedProjects: true,
  }));

  assert.doesNotMatch(actionButtonHtml(html, "toggle-project:project-1"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "rename-project:project-1"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "delete-project:project-1"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "restore-project:deleted-project"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "rename-file:chapter-1"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "delete-file:chapter-1"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "restore-file:deleted-chapter-1"), /disabled/);

  assert.match(actionButtonHtml(html, "open-new-project"), /disabled/);
  assert.match(actionButtonHtml(html, "add-project-files:project-1"), /disabled/);
  assert.match(actionButtonHtml(html, "delete-deleted-file:deleted-chapter-1"), /disabled/);
  assert.match(actionButtonHtml(html, "delete-deleted-project:deleted-project"), /disabled/);
});

test("project write in progress disables top-level lifecycle actions", () => {
  const html = renderProjectsScreen(projectsState({
    projectsPage: {
      isRefreshing: false,
      writeState: "submitting",
    },
    projects: [{
      id: "project-1",
      title: "Project",
      name: "project-repo",
      status: "active",
      chapters: [
        {
          id: "chapter-1",
          name: "Chapter",
          status: "active",
          linkedGlossary: null,
          sourceWordCount: 10,
        },
        {
          id: "deleted-chapter-1",
          name: "Deleted Chapter",
          status: "deleted",
          linkedGlossary: null,
          sourceWordCount: 10,
        },
      ],
    }],
    expandedDeletedFiles: new Set(["project-1"]),
    deletedProjects: [{
      id: "deleted-project",
      title: "Deleted Project",
      name: "deleted-project",
      lifecycleState: "deleted",
      chapters: [],
    }],
    showDeletedProjects: true,
  }));

  assert.match(actionButtonHtml(html, "rename-project:project-1"), /disabled/);
  assert.match(actionButtonHtml(html, "delete-project:project-1"), /disabled/);
  assert.match(actionButtonHtml(html, "restore-project:deleted-project"), /disabled/);
  assert.match(actionButtonHtml(html, "rename-file:chapter-1"), /disabled/);
  assert.match(actionButtonHtml(html, "delete-file:chapter-1"), /disabled/);
  assert.match(actionButtonHtml(html, "restore-file:deleted-chapter-1"), /disabled/);
});

test("coordinator writes keep lifecycle and glossary controls enabled while heavy actions stay disabled", () => {
  requestProjectWriteIntent({
    key: chapterGlossaryIntentKey("project-1", "chapter-1"),
    scope: projectRepoWriteScope({ installationId: 1 }, "project-1"),
    teamId: "team-1",
    projectId: "project-1",
    chapterId: "chapter-1",
    type: "chapterGlossary",
    value: { glossary: { glossaryId: "glossary-1", repoName: "glossary-repo" } },
  }, {
    run: async () => new Promise((resolve) => setTimeout(resolve, 10)),
  });

  const html = renderProjectsScreen(projectsState());

  assert.doesNotMatch(actionButtonHtml(html, "rename-project:project-1"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "delete-project:project-1"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "rename-file:chapter-1"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "delete-file:chapter-1"), /disabled/);
  assert.doesNotMatch(html, /data-chapter-glossary-select[^>]*disabled/);

  assert.match(actionButtonHtml(html, "open-new-project"), /disabled/);
  assert.match(actionButtonHtml(html, "add-project-files:project-1"), /disabled/);
});
