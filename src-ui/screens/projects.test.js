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
