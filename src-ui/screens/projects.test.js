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

test("projects glossary selector is visibly disabled while project page writes are blocked", () => {
  const html = renderProjectsScreen(projectsState({
    projectsPage: {
      isRefreshing: true,
      writeState: "idle",
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

  assert.match(actionButtonHtml(html, "open-new-project"), /disabled/);
  assert.match(actionButtonHtml(html, "add-project-files:project-1"), /disabled/);
  assert.match(actionButtonHtml(html, "rename-file:chapter-1"), /disabled/);
  assert.match(actionButtonHtml(html, "delete-file:chapter-1"), /disabled/);
  assert.match(actionButtonHtml(html, "delete-deleted-project:deleted-project"), /disabled/);
});

test("project write in progress disables top-level lifecycle actions", () => {
  const html = renderProjectsScreen(projectsState({
    projectsPage: {
      isRefreshing: false,
      writeState: "submitting",
    },
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
});
