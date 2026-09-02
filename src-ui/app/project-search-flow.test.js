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

const invokedCommands = [];
let searchResponses = [];
let refreshError = null;
const readySearchResponse = () => ({
  results: [{
    projectId: "project-1",
    projectTitle: "Project",
    chapterId: "chapter-1",
    chapterTitle: "Chapter",
    rowId: "row-1",
    rowOrderKey: "a0",
    score: 10,
    excerpts: [],
  }],
  total: 1,
  strongTotal: 1,
  weakerTotal: 0,
  totalCapped: false,
  indexStatus: "ready",
  queryTooShort: false,
  minimumQueryLength: 2,
});
globalThis.window = {
  __TAURI__: {
    core: {
      async invoke(command) {
        invokedCommands.push(command);
        if (command === "search_projects") {
          return searchResponses.length > 0 ? searchResponses.shift() : readySearchResponse();
        }
        if (command === "refresh_project_search_index") {
          if (refreshError) {
            throw refreshError;
          }
          return { indexStatus: "ready" };
        }
        return null;
      },
    },
  },
  __TAURI_INTERNALS__: null,
  setTimeout,
  clearTimeout,
  requestAnimationFrame(callback) {
    callback();
    return 1;
  },
};

const {
  openProjectSearchChapter,
  toggleProjectSearchChapter,
  toggleProjectSearchProject,
  toggleProjectSearchWeakerMatches,
  updateProjectSearchQuery,
} = await import("./project-search-flow.js");
const { createProjectsSearchState, state } = await import("./state.js");

test("project search expansion toggles preserve the other tree level", () => {
  const previousSearch = state.projectsSearch;
  try {
    state.projectsSearch = createProjectsSearchState();
    let renderCount = 0;
    const render = () => {
      renderCount += 1;
    };

    toggleProjectSearchProject(render, "project-1");
    toggleProjectSearchChapter(render, "chapter-1");

    assert.deepEqual([...state.projectsSearch.expandedProjectIds], ["project-1"]);
    assert.deepEqual([...state.projectsSearch.expandedChapterIds], ["chapter-1"]);
    assert.equal(renderCount, 2);

    toggleProjectSearchProject(render, "project-1");
    assert.deepEqual([...state.projectsSearch.expandedProjectIds], []);
    assert.deepEqual([...state.projectsSearch.expandedChapterIds], ["chapter-1"]);
  } finally {
    state.projectsSearch = previousSearch;
  }
});

test("changing the project search query resets tree expansion", () => {
  const previousSearch = state.projectsSearch;
  try {
    state.projectsSearch = {
      ...createProjectsSearchState(),
      query: "old query",
      expandedProjectIds: new Set(["project-1"]),
      expandedChapterIds: new Set(["chapter-1"]),
      includeWeakerMatches: true,
    };

    updateProjectSearchQuery(() => {}, "x");

    assert.equal(state.projectsSearch.query, "x");
    assert.equal(state.projectsSearch.status, "too-short");
    assert.deepEqual([...state.projectsSearch.expandedProjectIds], []);
    assert.deepEqual([...state.projectsSearch.expandedChapterIds], []);
    assert.equal(state.projectsSearch.includeWeakerMatches, false);
  } finally {
    state.projectsSearch = previousSearch;
  }
});

test("project search stores aggregated row responses from Tauri", async () => {
  const previousSearch = state.projectsSearch;
  const previousTeams = state.teams;
  const previousSelectedTeamId = state.selectedTeamId;
  try {
    invokedCommands.length = 0;
    searchResponses = [];
    refreshError = null;
    state.teams = [{ id: "team-1", installationId: 125730441 }];
    state.selectedTeamId = "team-1";
    state.projectsSearch = createProjectsSearchState();

    updateProjectSearchQuery(() => {}, "Drukpa");
    await new Promise((resolve) => setTimeout(resolve, 250));

    assert.deepEqual(invokedCommands, ["search_projects"]);
    assert.equal(state.projectsSearch.status, "ready");
    assert.equal(state.projectsSearch.total, 1);
    assert.equal(state.projectsSearch.strongTotal, 1);
    assert.equal(state.projectsSearch.weakerTotal, 0);
    assert.equal(state.projectsSearch.results.length, 1);
    assert.equal(state.projectsSearch.results[0].rowId, "row-1");
  } finally {
    state.projectsSearch = previousSearch;
    state.teams = previousTeams;
    state.selectedTeamId = previousSelectedTeamId;
  }
});

test("weaker-match toggling preserves tree expansion and does not rerun search", () => {
  const previousSearch = state.projectsSearch;
  try {
    invokedCommands.length = 0;
    state.projectsSearch = {
      ...createProjectsSearchState(),
      expandedProjectIds: new Set(["project-1"]),
      expandedChapterIds: new Set(["chapter-1"]),
    };
    let renderCount = 0;

    toggleProjectSearchWeakerMatches(() => { renderCount += 1; });

    assert.equal(state.projectsSearch.includeWeakerMatches, true);
    assert.deepEqual([...state.projectsSearch.expandedProjectIds], ["project-1"]);
    assert.deepEqual([...state.projectsSearch.expandedChapterIds], ["chapter-1"]);
    assert.deepEqual(invokedCommands, []);
    assert.equal(renderCount, 1);
  } finally {
    state.projectsSearch = previousSearch;
  }
});

test("project search prepares an unavailable index and retries the current query", async () => {
  const previousSearch = state.projectsSearch;
  const previousTeams = state.teams;
  const previousSelectedTeamId = state.selectedTeamId;
  try {
    invokedCommands.length = 0;
    refreshError = null;
    searchResponses = [
      {
        results: [], total: 0, totalCapped: false, indexStatus: "indexing",
        queryTooShort: false, minimumQueryLength: 2,
      },
      readySearchResponse(),
    ];
    state.teams = [{ id: "team-1", installationId: 125730441 }];
    state.selectedTeamId = "team-1";
    state.projectsSearch = createProjectsSearchState();

    updateProjectSearchQuery(() => {}, "Drukpa");
    await new Promise((resolve) => setTimeout(resolve, 250));

    assert.deepEqual(invokedCommands, [
      "search_projects",
      "refresh_project_search_index",
      "search_projects",
    ]);
    assert.equal(state.projectsSearch.status, "ready");
    assert.equal(state.projectsSearch.results[0].rowId, "row-1");
  } finally {
    searchResponses = [];
    refreshError = null;
    state.projectsSearch = previousSearch;
    state.teams = previousTeams;
    state.selectedTeamId = previousSelectedTeamId;
  }
});

test("a failed stale-index refresh preserves usable search results", async () => {
  const previousSearch = state.projectsSearch;
  const previousTeams = state.teams;
  const previousSelectedTeamId = state.selectedTeamId;
  try {
    invokedCommands.length = 0;
    refreshError = new Error("offline");
    searchResponses = [{ ...readySearchResponse(), indexStatus: "stale" }];
    state.teams = [{ id: "team-1", installationId: 125730441 }];
    state.selectedTeamId = "team-1";
    state.projectsSearch = createProjectsSearchState();

    updateProjectSearchQuery(() => {}, "Drukpa");
    await new Promise((resolve) => setTimeout(resolve, 250));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(invokedCommands, ["search_projects", "refresh_project_search_index"]);
    assert.equal(state.projectsSearch.status, "ready");
    assert.equal(state.projectsSearch.indexStatus, "stale");
    assert.equal(state.projectsSearch.results.length, 1);
  } finally {
    searchResponses = [];
    refreshError = null;
    state.projectsSearch = previousSearch;
    state.teams = previousTeams;
    state.selectedTeamId = previousSelectedTeamId;
  }
});

test("chapter search transfer only runs after navigation succeeds", async () => {
  const previousSearch = state.projectsSearch;
  try {
    state.projectsSearch = {
      ...createProjectsSearchState(),
      query: "Raw Query",
      results: [{ chapterId: "chapter-1" }],
    };
    const appliedQueries = [];

    const failed = await openProjectSearchChapter(() => {}, "chapter-1", {
      openTranslateChapter: async () => false,
      applyProjectSearchToEditor: (_render, query) => appliedQueries.push(query),
    });
    const opened = await openProjectSearchChapter(() => {}, "chapter-1", {
      openTranslateChapter: async () => true,
      applyProjectSearchToEditor: (_render, query) => appliedQueries.push(query),
    });

    assert.equal(failed, false);
    assert.equal(opened, true);
    assert.deepEqual(appliedQueries, ["Raw Query"]);
  } finally {
    state.projectsSearch = previousSearch;
  }
});
