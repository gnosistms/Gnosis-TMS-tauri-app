import { selectedProjectsTeam } from "./project-chapter-flow.js";
import { invoke } from "./runtime.js";
import { createProjectsSearchState, state } from "./state.js";
import {
  applyProjectSearchToEditor,
  openTranslateChapter,
} from "./translate-flow.js";

const PROJECT_SEARCH_DEBOUNCE_MS = 200;
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

function projectSearchRequestIsCurrent(selectedTeam, query, searchVersion) {
  return (
    searchVersion === activeProjectSearchVersion
    && state.projectsSearch.query.trim() === query
    && selectedProjectsTeam()?.installationId === selectedTeam.installationId
  );
}

function invokeProjectSearch(installationId, query) {
  return invoke("search_projects", {
    input: {
      installationId,
      query,
    },
  });
}

async function runProjectSearch(render, query, searchVersion) {
  const selectedTeam = selectedProjectsTeam();
  if (!selectedTeam?.installationId) {
    state.projectsSearch = {
      ...state.projectsSearch,
      status: "error",
      error: "Projects search requires a GitHub App-connected team.",
    };
    render();
    return;
  }

  state.projectsSearch = {
    ...state.projectsSearch,
    status: "searching",
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
      if (!projectSearchRequestIsCurrent(selectedTeam, query, searchVersion)) {
        return;
      }
    }

    let response = await invokeProjectSearch(selectedTeam.installationId, query);

    if (!projectSearchRequestIsCurrent(selectedTeam, query, searchVersion)) {
      return;
    }

    if (response?.indexStatus === "indexing") {
      state.projectsSearch = {
        ...state.projectsSearch,
        status: "searching",
        indexStatus: "indexing",
      };
      render();
      await refreshProjectSearchIndex(render, selectedTeam.id);
      if (!projectSearchRequestIsCurrent(selectedTeam, query, searchVersion)) {
        return;
      }
      response = await invokeProjectSearch(selectedTeam.installationId, query);
    }

    if (!projectSearchRequestIsCurrent(selectedTeam, query, searchVersion)) {
      return;
    }

    if (response?.indexStatus === "indexing") {
      throw new Error("The project search index could not be prepared. Please try again.");
    }

    const nextResults = [...(response?.results ?? [])];

    state.projectsSearch = {
      ...state.projectsSearch,
      status: response?.queryTooShort === true ? "too-short" : "ready",
      error: "",
      results: nextResults,
      total: Number.isFinite(response?.total) ? response.total : nextResults.length,
      strongTotal: Number.isFinite(response?.strongTotal)
        ? response.strongTotal
        : nextResults.filter((row) => row?.qualityTier !== "weaker").length,
      weakerTotal: Number.isFinite(response?.weakerTotal)
        ? response.weakerTotal
        : nextResults.filter((row) => row?.qualityTier === "weaker").length,
      totalCapped: response?.totalCapped === true,
      indexStatus: typeof response?.indexStatus === "string" ? response.indexStatus : "ready",
      queryTooShort: response?.queryTooShort === true,
      minimumQueryLength:
        Number.isFinite(response?.minimumQueryLength) && response.minimumQueryLength > 0
          ? response.minimumQueryLength
          : MIN_PROJECT_SEARCH_QUERY_LENGTH,
    };
    render();

    if (response?.indexStatus === "stale") {
      void refreshProjectSearchIndex(render, selectedTeam.id).catch(() => {
        // Keep the last usable index and its results available.
      });
    }
  } catch (error) {
    if (searchVersion !== activeProjectSearchVersion) {
      return;
    }

    state.projectsSearch = {
      ...state.projectsSearch,
      status: "error",
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

  const hadUsableIndex = (
    state.projectsSearch?.indexStatus === "stale"
    || (state.projectsSearch?.results?.length ?? 0) > 0
  );

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
          indexStatus: hadUsableIndex ? "stale" : "error",
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
    void runProjectSearch(render, normalizedQuery, searchVersion);
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

function toggleSearchExpansion(render, stateKey, itemId) {
  const normalizedId = String(itemId ?? "").trim();
  if (!normalizedId) {
    return;
  }
  const nextIds = new Set(state.projectsSearch?.[stateKey] ?? []);
  if (nextIds.has(normalizedId)) {
    nextIds.delete(normalizedId);
  } else {
    nextIds.add(normalizedId);
  }
  state.projectsSearch = {
    ...state.projectsSearch,
    [stateKey]: nextIds,
  };
  render();
}

export function toggleProjectSearchProject(render, projectId) {
  toggleSearchExpansion(render, "expandedProjectIds", projectId);
}

export function toggleProjectSearchChapter(render, chapterId) {
  toggleSearchExpansion(render, "expandedChapterIds", chapterId);
}

export function toggleProjectSearchWeakerMatches(render) {
  state.projectsSearch = {
    ...state.projectsSearch,
    includeWeakerMatches: state.projectsSearch?.includeWeakerMatches !== true,
  };
  render();
}

export async function openProjectSearchChapter(render, chapterId, operations = {}) {
  const normalizedChapterId = String(chapterId ?? "").trim();
  const chapterExists = (state.projectsSearch?.results ?? [])
    .some((row) => String(row?.chapterId ?? "") === normalizedChapterId);
  if (!normalizedChapterId || !chapterExists) {
    return false;
  }

  const searchQuery = typeof state.projectsSearch?.query === "string"
    ? state.projectsSearch.query
    : "";
  const openChapter = operations.openTranslateChapter ?? openTranslateChapter;
  const applySearch = operations.applyProjectSearchToEditor ?? applyProjectSearchToEditor;
  const opened = await openChapter(render, normalizedChapterId);
  if (opened !== true) {
    return false;
  }
  applySearch(render, searchQuery);
  return true;
}
