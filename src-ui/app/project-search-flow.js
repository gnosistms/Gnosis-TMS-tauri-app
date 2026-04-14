import { selectedProjectsTeam } from "./project-chapter-flow.js";
import { indexProjectSearchResults } from "./project-search-state.js";
import { invoke, waitForNextPaint } from "./runtime.js";
import { createProjectsSearchState, state } from "./state.js";
import {
  openTranslateChapter,
  setActiveEditorField,
  updateEditorSearchFilterQuery as updateTranslateEditorSearchFilterQuery,
} from "./translate-flow.js";

const PROJECT_SEARCH_DEBOUNCE_MS = 200;
const PROJECT_SEARCH_PAGE_SIZE = 50;
const MIN_PROJECT_SEARCH_QUERY_LENGTH = 2;

let pendingProjectSearchTimeout = null;
let activeProjectSearchVersion = 0;
const pendingProjectSearchIndexRefreshes = new Map();

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
    const pendingIndexRefresh = pendingProjectSearchIndexRefreshes.get(selectedTeam.installationId);
    if (pendingIndexRefresh) {
      try {
        await pendingIndexRefresh;
      } catch {
        // Fall back to whatever index is currently available.
      }
      if (
        searchVersion !== activeProjectSearchVersion
        || state.projectsSearch.query.trim() !== query
        || selectedProjectsTeam()?.installationId !== selectedTeam.installationId
      ) {
        return;
      }
    }

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
      status: response?.queryTooShort === true ? "too-short" : "ready",
      error: "",
      loadingMore: false,
      results: nextResults,
      resultsById: indexProjectSearchResults(nextResults),
      total: Number.isFinite(response?.total) ? response.total : nextResults.length,
      totalCapped: response?.totalCapped === true,
      hasMore: response?.hasMore === true,
      nextOffset: nextResults.length,
      indexStatus: typeof response?.indexStatus === "string" ? response.indexStatus : "ready",
      queryTooShort: response?.queryTooShort === true,
      minimumQueryLength:
        Number.isFinite(response?.minimumQueryLength) && response.minimumQueryLength > 0
          ? response.minimumQueryLength
          : MIN_PROJECT_SEARCH_QUERY_LENGTH,
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

export function refreshProjectSearchIndex(render, teamId = state.selectedTeamId) {
  const selectedTeam = state.teams.find((team) => team.id === teamId) ?? null;
  if (!selectedTeam?.installationId) {
    return Promise.resolve(null);
  }

  const installationId = selectedTeam.installationId;
  const pendingRefresh = pendingProjectSearchIndexRefreshes.get(installationId);
  if (pendingRefresh) {
    return pendingRefresh;
  }

  if (selectedProjectsTeam()?.installationId === installationId) {
    state.projectsSearch = {
      ...state.projectsSearch,
      indexStatus: "refreshing",
    };
    render?.();
  }

  const refreshPromise = invoke("refresh_project_search_index", {
    input: {
      installationId,
    },
  })
    .then((response) => {
      if (selectedProjectsTeam()?.installationId === installationId) {
        state.projectsSearch = {
          ...state.projectsSearch,
          indexStatus: typeof response?.indexStatus === "string" ? response.indexStatus : "ready",
        };
        render?.();
      }
      return response;
    })
    .catch((error) => {
      if (selectedProjectsTeam()?.installationId === installationId) {
        state.projectsSearch = {
          ...state.projectsSearch,
          indexStatus: "error",
        };
        render?.();
      }
      throw error;
    })
    .finally(() => {
      if (pendingProjectSearchIndexRefreshes.get(installationId) === refreshPromise) {
        pendingProjectSearchIndexRefreshes.delete(installationId);
      }
    });

  pendingProjectSearchIndexRefreshes.set(installationId, refreshPromise);
  return refreshPromise;
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

  if (Array.from(normalizedQuery).length < MIN_PROJECT_SEARCH_QUERY_LENGTH) {
    state.projectsSearch = {
      ...createProjectsSearchState(),
      query,
      status: "too-short",
      queryTooShort: true,
      minimumQueryLength: MIN_PROJECT_SEARCH_QUERY_LENGTH,
    };
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
  const searchQuery = typeof state.projectsSearch?.query === "string"
    ? state.projectsSearch.query
    : "";
  await openTranslateChapter(render, result.chapterId);
  updateTranslateEditorSearchFilterQuery(render, searchQuery);
  render();
  await waitForNextPaint();
  await setActiveEditorField(render, result.rowId, result.languageCode);
}
