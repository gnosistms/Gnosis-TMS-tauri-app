import { selectedProjectsTeam } from "./project-chapter-flow.js";
import { indexProjectSearchResults } from "./project-search-state.js";
import { invoke, waitForNextPaint } from "./runtime.js";
import { queueTranslateRowAnchor, restoreTranslateRowAnchor } from "./scroll-state.js";
import { createProjectsSearchState, state } from "./state.js";
import { openTranslateChapter, setActiveEditorField } from "./translate-flow.js";

const PROJECT_SEARCH_DEBOUNCE_MS = 200;
const PROJECT_SEARCH_PAGE_SIZE = 50;

let pendingProjectSearchTimeout = null;
let activeProjectSearchVersion = 0;

function clearPendingProjectSearchTimeout() {
  if (pendingProjectSearchTimeout) {
    clearTimeout(pendingProjectSearchTimeout);
    pendingProjectSearchTimeout = null;
  }
}

function setProjectSearchIdle(query = "") {
  state.projectsSearch = {
    ...createProjectsSearchState(),
    query,
  };
}

async function runProjectSearch(render, query, offset, searchVersion, appendResults = false) {
  const selectedTeam = selectedProjectsTeam();
  if (!selectedTeam?.installationId) {
    state.projectsSearch = {
      ...state.projectsSearch,
      status: "error",
      loadingMore: false,
      error: "Projects search requires a GitHub App-connected team.",
    };
    render();
    return;
  }

  state.projectsSearch = {
    ...state.projectsSearch,
    status: appendResults ? state.projectsSearch.status : "searching",
    loadingMore: appendResults,
    error: "",
  };
  render();

  try {
    const response = await invoke("search_projects", {
      input: {
        installationId: selectedTeam.installationId,
        query,
        limit: PROJECT_SEARCH_PAGE_SIZE,
        offset,
      },
    });

    if (searchVersion !== activeProjectSearchVersion || state.projectsSearch.query.trim() !== query) {
      return;
    }

    const nextResults = appendResults
      ? [...state.projectsSearch.results, ...(response?.results ?? [])]
      : [...(response?.results ?? [])];

    state.projectsSearch = {
      ...state.projectsSearch,
      status: "ready",
      error: "",
      loadingMore: false,
      results: nextResults,
      resultsById: indexProjectSearchResults(nextResults),
      total: Number.isFinite(response?.total) ? response.total : nextResults.length,
      hasMore: response?.hasMore === true,
      nextOffset: nextResults.length,
      indexStatus: typeof response?.indexStatus === "string" ? response.indexStatus : "ready",
    };
    render();
  } catch (error) {
    if (searchVersion !== activeProjectSearchVersion) {
      return;
    }

    state.projectsSearch = {
      ...state.projectsSearch,
      status: "error",
      loadingMore: false,
      error: error?.message ?? String(error),
    };
    render();
  }
}

export function updateProjectSearchQuery(render, query) {
  clearPendingProjectSearchTimeout();
  activeProjectSearchVersion += 1;

  state.projectsSearch = {
    ...state.projectsSearch,
    query,
    error: "",
  };

  const normalizedQuery = String(query ?? "").trim();
  if (!normalizedQuery) {
    setProjectSearchIdle("");
    render();
    return;
  }

  state.projectsSearch = {
    ...createProjectsSearchState(),
    query,
    status: "searching",
    requestId: activeProjectSearchVersion,
  };
  render();

  const searchVersion = activeProjectSearchVersion;
  pendingProjectSearchTimeout = window.setTimeout(() => {
    pendingProjectSearchTimeout = null;
    void runProjectSearch(render, normalizedQuery, 0, searchVersion, false);
  }, PROJECT_SEARCH_DEBOUNCE_MS);
}

export function clearProjectSearch(render) {
  clearPendingProjectSearchTimeout();
  activeProjectSearchVersion += 1;
  setProjectSearchIdle("");
  render();
}

export function resetProjectSearchState() {
  clearPendingProjectSearchTimeout();
  activeProjectSearchVersion += 1;
  setProjectSearchIdle("");
}

export function loadMoreProjectSearchResults(render) {
  const query = String(state.projectsSearch.query ?? "").trim();
  if (!query || state.projectsSearch.hasMore !== true || state.projectsSearch.loadingMore === true) {
    return;
  }

  const searchVersion = activeProjectSearchVersion;
  void runProjectSearch(render, query, state.projectsSearch.nextOffset ?? state.projectsSearch.results.length, searchVersion, true);
}

export async function openProjectSearchResult(render, resultId) {
  const result = state.projectsSearch.resultsById?.[String(resultId)] ?? null;
  if (!result?.chapterId || !result?.rowId || !result?.languageCode) {
    return;
  }

  const anchor = {
    type: "field",
    rowId: result.rowId,
    languageCode: result.languageCode,
    offsetTop: 0,
  };

  queueTranslateRowAnchor(anchor);
  await openTranslateChapter(render, result.chapterId);
  await setActiveEditorField(render, result.rowId, result.languageCode);
  render();
  await waitForNextPaint();
  restoreTranslateRowAnchor(anchor);
}
