import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
  projectRepoSyncIntentKey,
  projectRepoWriteScope,
  requestProjectWriteIntent,
  resetProjectWriteCoordinator,
} = await import("../app/project-write-coordinator.js");
const { resetRepoWriteQueue } = await import("../app/repo-write-queue.js");
const { state: appState, resetSessionState } = await import("../app/state.js");

function cssRuleBlock(css, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escapedSelector}\\s*\\{[^}]*\\}`))?.[0] ?? "";
}

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
  resetRepoWriteQueue();
  resetSessionState();
});

test("offline banner renders inside the page header", () => {
  const html = renderProjectsScreen(projectsState({
    offline: {
      isEnabled: true,
    },
  }));
  const headerStart = html.indexOf('<header class="page-header');
  const bannerStart = html.indexOf('<div class="offline-banner"');
  const headerEnd = html.indexOf("</header>", headerStart);

  assert.ok(headerStart >= 0);
  assert.ok(bannerStart > headerStart);
  assert.ok(bannerStart < headerEnd);
});

test("project background refresh spins without disabling the refresh button", () => {
  const html = renderProjectsScreen(projectsState({
    projectsPage: {
      isRefreshing: true,
      writeState: "idle",
    },
    projectsPageSync: {
      status: "idle",
    },
  }));

  assert.match(actionButtonHtml(html, "refresh-page"), /\bis-spinning\b/);
  assert.doesNotMatch(actionButtonHtml(html, "refresh-page"), /aria-disabled="true"/);
});

test("project background refresh keeps refresh icon animation phase stable across renders", () => {
  const html = renderProjectsScreen(projectsState({
    projectsPage: {
      isRefreshing: true,
      refreshStartedAt: -1000,
      writeState: "idle",
    },
    projectsPageSync: {
      status: "idle",
    },
  }));

  assert.match(html, /--title-icon-spin-delay: -\d+ms/);
});

test("project discovery loading disables project creation even if refresh flag is stale", () => {
  const html = renderProjectsScreen(projectsState({
    projects: [],
    projectDiscovery: {
      status: "loading",
      error: "",
      glossaryWarning: "",
      recoveryMessage: "",
    },
    projectsPage: {
      isRefreshing: false,
      writeState: "idle",
    },
  }));

  assert.match(html, /Loading projects\.\.\./);
  assert.match(actionButtonHtml(html, "open-new-project"), /disabled/);
});

test("projects page shows cached rows during a background refresh", () => {
  const html = renderProjectsScreen(projectsState({
    projectsPage: {
      isRefreshing: true,
      writeState: "idle",
    },
    projectDiscovery: {
      status: "ready",
      error: "",
      glossaryWarning: "",
      recoveryMessage: "",
    },
  }));

  assert.doesNotMatch(html, /Loading projects\.\.\./);
  assert.match(html, /Project/);
  assert.match(actionButtonHtml(html, "refresh-page"), /\bis-spinning\b/);
});

test("projects page does not show empty state while project refresh is active", () => {
  const html = renderProjectsScreen(projectsState({
    projects: [],
    projectsPage: {
      isRefreshing: true,
      writeState: "idle",
    },
    projectDiscovery: {
      status: "ready",
      error: "",
      glossaryWarning: "",
      recoveryMessage: "",
    },
  }));

  assert.match(html, /Loading projects\.\.\./);
  assert.doesNotMatch(html, /This team doesn't have any projects yet\./);
});

test("projects page does not show empty state while project page sync is active", () => {
  const html = renderProjectsScreen(projectsState({
    projects: [],
    projectsPage: {
      isRefreshing: false,
      writeState: "idle",
    },
    projectsPageSync: {
      status: "syncing",
    },
    projectDiscovery: {
      status: "ready",
      error: "",
      glossaryWarning: "",
      recoveryMessage: "",
    },
  }));

  assert.match(html, /Loading projects\.\.\./);
  assert.doesNotMatch(html, /This team doesn't have any projects yet\./);
});

test("project background refresh does not disable add files for project managers", () => {
  const html = renderProjectsScreen(projectsState({
    projectsPage: {
      isRefreshing: true,
      writeState: "idle",
    },
  }));

  assert.doesNotMatch(actionButtonHtml(html, "add-project-files:project-1"), /disabled/);
});

test("project refresh hides missing local repo repair warnings while setup is in progress", () => {
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
      resolutionState: "repair",
      repairIssueType: "missingLocalRepo",
      repairIssueMessage: "Team metadata references this project, but its local repo is missing.",
      chapters: [],
    }],
  }));

  assert.doesNotMatch(html, /local repo is missing/i);
  assert.equal(actionButtonHtml(html, "rebuild-project-repo:project-1"), "");
});

test("project missing local repo repair warning returns after refresh", () => {
  const html = renderProjectsScreen(projectsState({
    projects: [{
      id: "project-1",
      title: "Project",
      name: "project-repo",
      status: "active",
      resolutionState: "repair",
      repairIssueType: "missingLocalRepo",
      repairIssueMessage: "Team metadata references this project, but its local repo is missing.",
      chapters: [],
    }],
  }));

  assert.match(html, /local repo is missing/i);
  assert.match(actionButtonHtml(html, "rebuild-project-repo:project-1"), /data-action/);
});

test("projects status surface renders background sync and notice lines together", () => {
  appState.statusBadges = {
    left: {
      visible: true,
      text: "Project renamed.",
    },
    right: {
      visible: true,
      text: "Refreshing project list...",
      scope: "projects",
    },
  };

  const html = renderProjectsScreen(projectsState());

  assert.match(html, /team-ui-debug--stack/);
  assert.match(html, /Refreshing project list\.\.\./);
  assert.match(html, /Project renamed\./);
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

test("projects glossary selector does not render a hover tooltip", () => {
  const html = renderProjectsScreen(projectsState());

  assert.match(html, /data-chapter-glossary-select/);
  assert.match(html, /aria-label="Select a glossary"/);
  assert.doesNotMatch(html, /data-tooltip="Select a glossary"/);
});

test("projects page renders chapter status badge before glossary selector", () => {
  const html = renderProjectsScreen(projectsState({
    projects: [{
      id: "project-1",
      title: "Project",
      name: "project-repo",
      status: "active",
      chapters: [{
        id: "chapter-1",
        name: "Chapter",
        status: "active",
        workflowStatus: "review2",
        linkedGlossary: null,
        sourceWordCount: 10,
      }],
    }],
  }));
  const statusIndex = html.indexOf("data-chapter-status-select");
  const glossaryIndex = html.indexOf("data-chapter-glossary-select");

  assert.ok(statusIndex >= 0);
  assert.ok(glossaryIndex > statusIndex);
  assert.match(html, /chapter-status-badge--review2/);
  assert.match(html, /data-tooltip="Click to update the status of this file in your translation workflow\."/);
  assert.match(html, /select-pill__value">review 2</);
  assert.match(html, /<option value="review2" selected>review 2<\/option>/);
  const css = readFileSync(new URL("../styles/content.css", import.meta.url), "utf8");
  assert.match(cssRuleBlock(css, ".chapter-status-badge"), /min-width: 0;/);
  assert.match(cssRuleBlock(css, ".chapter-status-badge"), /justify-content: center;/);
  assert.match(cssRuleBlock(css, ".select-pill--toolbar.select-pill--control.chapter-status-badge"), /padding-right: 14px;/);
  assert.match(cssRuleBlock(css, ".chapter-status-badge .select-pill__chevron"), /display: none;/);
});

test("disabled chapter status badges do not show click tooltip", () => {
  const html = renderProjectsScreen(projectsState({
    projectsPage: {
      isRefreshing: false,
      writeState: "submitting",
    },
  }));
  const statusLabel = html.match(/<label class="[^"]*chapter-status-badge[^"]*"[^>]*>/)?.[0] ?? "";

  assert.match(statusLabel, /aria-disabled="true"/);
  assert.doesNotMatch(statusLabel, /data-tooltip=/);
});

test("projects page opens active chapters from the left title area, not the full row", () => {
  const html = renderProjectsScreen(projectsState());
  const exportButton = actionButtonHtml(html, "export-file:chapter-1");
  const exportIndex = html.indexOf('data-action="export-file:chapter-1"');

  assert.ok(exportIndex >= 0);
  assert.match(exportButton, /class="icon-action/);
  assert.match(exportButton, /aria-label="Export"/);
  assert.match(exportButton, /data-tooltip="Export"/);
  assert.doesNotMatch(exportButton, /disabled/);
  assert.match(html, /class="chapter-table__row chapter-table__row--file"/);
  assert.doesNotMatch(html, /class="chapter-table__row chapter-table__row--file" data-action="open-translate:chapter-1"/);
  assert.match(html, /class="chapter-table__title-wrap chapter-table__title-wrap--interactive" data-action="open-translate:chapter-1" data-tooltip="Open"/);
  assert.match(html, /class="chapter-table__name-button" data-action="open-translate:chapter-1"/);
  assert.doesNotMatch(html, /class="text-action" data-action="open-translate:chapter-1"/);
});

test("projects page marks chapter files with imported editor conflicts", () => {
  const html = renderProjectsScreen(projectsState({
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
        selectedSourceLanguageCode: "es",
        wordCounts: { es: 10 },
        hasImportedEditorConflicts: true,
      }],
    }],
  }));
  const sourceWordIndex = html.indexOf("10 source words");
  const conflictBadgeIndex = html.indexOf("Has conflicts");

  assert.ok(sourceWordIndex >= 0);
  assert.ok(conflictBadgeIndex > sourceWordIndex);
  assert.match(html, /class="chapter-table__conflict-badge">Has conflicts<\/span>/);
});

test("projects page shows chapter icon actions after status and glossary in requested order", () => {
  const html = renderProjectsScreen(projectsState());
  const statusIndex = html.indexOf("data-chapter-status-select");
  const glossaryIndex = html.indexOf("data-chapter-glossary-select");
  const addTranslationIndex = html.indexOf('data-action="add-translation-to-file:chapter-1"');
  const exportIndex = html.indexOf('data-action="export-file:chapter-1"');
  const renameIndex = html.indexOf('data-action="rename-file:chapter-1"');
  const deleteIndex = html.indexOf('data-action="delete-file:chapter-1"');

  assert.ok(statusIndex >= 0);
  assert.ok(glossaryIndex >= 0);
  assert.ok(glossaryIndex > statusIndex);
  assert.ok(addTranslationIndex > glossaryIndex);
  assert.ok(exportIndex > addTranslationIndex);
  assert.ok(renameIndex > exportIndex);
  assert.ok(deleteIndex > renameIndex);

  assert.match(actionButtonHtml(html, "add-translation-to-file:chapter-1"), /class="icon-action/);
  assert.match(actionButtonHtml(html, "add-translation-to-file:chapter-1"), /aria-label="Add translations"/);
  assert.match(actionButtonHtml(html, "add-translation-to-file:chapter-1"), /data-tooltip="Add translations"/);
  assert.match(html, /data-action="export-file:chapter-1"[^>]*>[\s\S]*?icon-action__icon icon-action__icon--rotate-left/);
  assert.match(actionButtonHtml(html, "rename-file:chapter-1"), /aria-label="Rename"/);
  assert.match(actionButtonHtml(html, "rename-file:chapter-1"), /data-tooltip="Rename"/);
  assert.match(actionButtonHtml(html, "delete-file:chapter-1"), /aria-label="Delete"/);
  assert.match(actionButtonHtml(html, "delete-file:chapter-1"), /data-tooltip="Delete"/);
  assert.doesNotMatch(html, /data-action="add-translation-to-file:chapter-1"[^>]*>Add translation<\/button>/);
  assert.doesNotMatch(html, /data-action="export-file:chapter-1"[^>]*>Export<\/button>/);
  assert.doesNotMatch(html, /data-action="rename-file:chapter-1"[^>]*>Rename<\/button>/);
  assert.doesNotMatch(html, /data-action="delete-file:chapter-1"[^>]*>Delete<\/button>/);
});

test("project chapter filenames truncate responsively on one line", () => {
  const css = readFileSync(new URL("../styles/content.css", import.meta.url), "utf8");
  const titleWrapBlock = cssRuleBlock(css, ".chapter-table__title-wrap");

  assert.match(titleWrapBlock, /min-width: 0;/);
  assert.doesNotMatch(titleWrapBlock, /overflow: hidden;/);
  assert.match(css, /\.chapter-table__name,\s*\.chapter-table__name-button\s*\{[\s\S]*min-width: 0;[\s\S]*overflow: hidden;[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap;/);
  assert.match(css, /\.chapter-table__meta\s*\{[\s\S]*flex: 0 0 auto;[\s\S]*white-space: nowrap;/);
  assert.match(css, /\.chapter-table__conflict-badge\s*\{[\s\S]*flex: 0 0 auto;[\s\S]*white-space: nowrap;/);
});

test("project open tooltip and cursor are scoped to the title area", () => {
  const css = readFileSync(new URL("../styles/content.css", import.meta.url), "utf8");

  assert.match(css, /\.chapter-table__title-wrap--interactive\s*\{[\s\S]*cursor: pointer;/);
  assert.match(css, /\.chapter-table__title-wrap--interactive:hover \.chapter-table__name-button/);
  assert.match(css, /\.chapter-table__row--file:hover \.chapter-table__name-button/);
  assert.doesNotMatch(css, /\.chapter-table__row--file:hover \.chapter-table__meta/);
  assert.doesNotMatch(css, /\.chapter-table__row--interactive\[data-tooltip\]:has/);
});

test("projects export stays enabled while project repo is syncing", () => {
  const html = renderProjectsScreen(projectsState({
    projectRepoSyncByProjectId: {
      "project-1": { status: "syncing" },
    },
  }));

  assert.doesNotMatch(actionButtonHtml(html, "export-file:chapter-1"), /disabled/);
});

test("projects add files stays enabled while an existing local repo is syncing", () => {
  const html = renderProjectsScreen(projectsState({
    projectRepoSyncByProjectId: {
      "project-1": { status: "syncing" },
    },
  }));

  assert.doesNotMatch(actionButtonHtml(html, "add-project-files:project-1"), /disabled/);
});

test("viewer role keeps project files downloadable but hides mutating file actions", () => {
  const html = renderProjectsScreen(projectsState({
    teams: [{
      id: "team-1",
      name: "Team",
      membershipRole: "viewer",
      canManageProjects: true,
      canDelete: true,
    }],
  }));

  assert.doesNotMatch(actionButtonHtml(html, "export-file:chapter-1"), /disabled/);
  assert.equal(actionButtonHtml(html, "add-translation-to-file:chapter-1"), "");
  assert.equal(actionButtonHtml(html, "rename-file:chapter-1"), "");
  assert.equal(actionButtonHtml(html, "delete-file:chapter-1"), "");
  assert.doesNotMatch(html, /data-action="add-project-files:project-1"/);
  assert.doesNotMatch(html, /data-action="open-new-project"/);
});

test("projects export is disabled until the local repo is available", () => {
  const html = renderProjectsScreen(projectsState({
    projectRepoSyncByProjectId: {
      "project-1": { status: "notCloned" },
    },
  }));

  assert.match(actionButtonHtml(html, "export-file:chapter-1"), /disabled/);
});

test("project setup from remote hides missing local repo repair warning", () => {
  const html = renderProjectsScreen(projectsState({
    projectRepoSyncByProjectId: {
      "project-1": { status: "notCloned" },
    },
    projects: [{
      id: "project-1",
      title: "Project",
      name: "project-repo",
      status: "active",
      resolutionState: "repair",
      repairIssueType: "missingLocalRepo",
      repairIssueMessage: "Team metadata references this project, but its local repo is missing.",
      chapters: [],
    }],
  }));

  assert.match(html, /Downloading data from remote repo\.\.\./);
  assert.doesNotMatch(html, /local repo is missing/i);
  assert.equal(actionButtonHtml(html, "rebuild-project-repo:project-1"), "");
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

test("deleted project glossary selectors stay disabled without losing the assigned glossary label", () => {
  const html = renderProjectsScreen(projectsState({
    projects: [],
    deletedProjects: [{
      id: "deleted-project",
      title: "Deleted Project",
      name: "deleted-project-repo",
      lifecycleState: "deleted",
      chapters: [{
        id: "chapter-1",
        name: "Chapter",
        status: "active",
        linkedGlossary: { glossaryId: "glossary-1", repoName: "glossary-repo" },
        sourceWordCount: 10,
      }],
    }],
    expandedProjects: new Set(["deleted-project"]),
    showDeletedProjects: true,
  }));

  assert.match(html, /select-pill__value">Glossary</);
  assert.match(html, /<option value="glossary-1" selected>Glossary<\/option>/);
  assert.match(html, /data-chapter-glossary-select[^>]*disabled/);
  assert.doesNotMatch(html, /select-pill__value">no glossary</);
});

test("disabled project glossary selectors show assigned repo label when the glossary is not selectable", () => {
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
      chapters: [{
        id: "chapter-1",
        name: "Chapter",
        status: "active",
        linkedGlossary: { glossaryId: "missing-glossary", repoName: "archived-glossary-repo" },
        sourceWordCount: 10,
      }],
    }],
  }));

  assert.match(html, /select-pill__value">archived-glossary-repo</);
  assert.match(html, /<option value="missing-glossary" selected>archived-glossary-repo<\/option>/);
  assert.match(html, /data-chapter-glossary-select[^>]*disabled/);
  assert.doesNotMatch(html, /select-pill__value">no glossary</);
});

test("project refresh keeps lifecycle and local hard-delete actions enabled and heavy actions disabled", () => {
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
  assert.doesNotMatch(actionButtonHtml(html, "add-project-files:project-1"), /disabled/);
  // Local hard-delete is local-only and stays available during a background refresh.
  assert.doesNotMatch(actionButtonHtml(html, "clear-deleted-files:project-1"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "delete-deleted-file:deleted-chapter-1"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "delete-deleted-project:deleted-project"), /disabled/);
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
  assert.match(actionButtonHtml(html, "clear-deleted-files:project-1"), /disabled/);
});

test("local hard-delete controls wait for matching lifecycle mutations only", () => {
  const html = renderProjectsScreen(projectsState({
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
          pendingMutation: "softDelete",
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
      pendingMutation: "softDelete",
      chapters: [],
    }],
    showDeletedProjects: true,
  }));

  assert.match(actionButtonHtml(html, "clear-deleted-files:project-1"), /disabled/);
  assert.match(actionButtonHtml(html, "delete-deleted-file:deleted-chapter-1"), /disabled/);
  assert.match(actionButtonHtml(html, "delete-deleted-project:deleted-project"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "add-project-files:project-1"), /disabled/);
});

test("deleted project local delete remains available offline", () => {
  const html = renderProjectsScreen(projectsState({
    deletedProjects: [{
      id: "deleted-project",
      title: "Deleted Project",
      name: "deleted-project",
      lifecycleState: "deleted",
      chapters: [],
    }],
    showDeletedProjects: true,
    offline: {
      isEnabled: true,
    },
  }));

  assert.match(actionButtonHtml(html, "restore-project:deleted-project"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "delete-deleted-project:deleted-project"), /disabled/);
});

test("expanded deleted files section shows clear all action below hide deleted files", () => {
  const html = renderProjectsScreen(projectsState({
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
  }));

  const hideIndex = html.indexOf("Hide deleted files");
  const clearIndex = html.indexOf('data-action="clear-deleted-files:project-1"');
  const tableIndex = html.indexOf("chapter-table__row--deleted");

  assert.ok(hideIndex >= 0);
  assert.ok(clearIndex > hideIndex);
  assert.ok(tableIndex > clearIndex);
});

test("collapsed deleted files section does not show clear all action", () => {
  const html = renderProjectsScreen(projectsState({
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
    expandedDeletedFiles: new Set(),
  }));

  assert.equal(actionButtonHtml(html, "clear-deleted-files:project-1"), "");
});

test("clear deleted files modal requires project name confirmation", () => {
  const unmatchedHtml = renderProjectsScreen(projectsState({
    projectClearDeletedFiles: {
      isOpen: true,
      projectId: "project-1",
      projectName: "Project",
      confirmationText: "",
      status: "idle",
      error: "",
    },
  }));
  const matchedHtml = renderProjectsScreen(projectsState({
    projectClearDeletedFiles: {
      isOpen: true,
      projectId: "project-1",
      projectName: "Project",
      confirmationText: "Project",
      status: "idle",
      error: "",
    },
  }));

  assert.match(unmatchedHtml, /CLEAR DELETED FILES/);
  assert.match(unmatchedHtml, /Permanently remove all deleted files/);
  assert.match(unmatchedHtml, /type the project name:/);
  assert.match(actionButtonHtml(unmatchedHtml, "confirm-clear-deleted-files"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(matchedHtml, "confirm-clear-deleted-files"), /disabled/);
});

test("coordinator writes keep file actions and local hard-delete controls enabled while project creation waits", () => {
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

  const html = renderProjectsScreen(projectsState({
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

  assert.doesNotMatch(actionButtonHtml(html, "rename-project:project-1"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "delete-project:project-1"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "rename-file:chapter-1"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "delete-file:chapter-1"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "restore-file:deleted-chapter-1"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "restore-project:deleted-project"), /disabled/);
  assert.doesNotMatch(html, /data-chapter-glossary-select[^>]*disabled/);

  assert.match(actionButtonHtml(html, "open-new-project"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "add-project-files:project-1"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "clear-deleted-files:project-1"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "delete-deleted-file:deleted-chapter-1"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "delete-deleted-project:deleted-project"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "refresh-page"), /\bis-spinning\b/);
  assert.doesNotMatch(actionButtonHtml(html, "refresh-page"), /aria-disabled="true"/);
});

test("repo sync intents do not globally disable new project, add files, or keep page refresh spinning", () => {
  requestProjectWriteIntent({
    key: projectRepoSyncIntentKey("project-1"),
    scope: projectRepoWriteScope({ installationId: 1 }, "project-1"),
    teamId: "team-1",
    projectId: "project-1",
    type: "projectRepoSync",
    value: { requestedAt: 1 },
  }, {
    run: async () => new Promise((resolve) => setTimeout(resolve, 10)),
  });

  const html = renderProjectsScreen(projectsState({
    projectsPageSync: {
      status: "upToDate",
    },
  }));

  assert.doesNotMatch(actionButtonHtml(html, "open-new-project"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "add-project-files:project-1"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "refresh-page"), /\bis-spinning\b/);
  assert.doesNotMatch(actionButtonHtml(html, "refresh-page"), /aria-disabled="true"/);
});
