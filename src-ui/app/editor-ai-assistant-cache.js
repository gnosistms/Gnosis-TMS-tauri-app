import { loadTeamScopedCacheMap, saveTeamScopedCacheMap, teamCacheKey } from "./team-cache.js";
import {
  buildEditorAssistantThreadKey,
  extractPersistedEditorAssistantState,
  normalizeEditorAssistantChapterArtifacts,
  normalizeEditorAssistantState,
  normalizeEditorAssistantThreadState,
} from "./editor-ai-assistant-state.js";

const EDITOR_ASSISTANT_STORAGE_KEY = "gnosis-tms-editor-ai-assistant";

function normalizeProjectId(projectId) {
  return typeof projectId === "string" && projectId.trim() ? projectId.trim() : "";
}

function normalizeChapterId(chapterId) {
  return typeof chapterId === "string" && chapterId.trim() ? chapterId.trim() : "";
}

function chapterAssistantCacheKey(projectId, chapterId) {
  const normalizedProjectId = normalizeProjectId(projectId);
  const normalizedChapterId = normalizeChapterId(chapterId);
  if (!normalizedProjectId || !normalizedChapterId) {
    return null;
  }

  return `${normalizedProjectId}::${normalizedChapterId}`;
}

function loadAssistantCacheMap() {
  return loadTeamScopedCacheMap(EDITOR_ASSISTANT_STORAGE_KEY);
}

function saveAssistantCacheMap(cacheMap) {
  saveTeamScopedCacheMap(
    EDITOR_ASSISTANT_STORAGE_KEY,
    cacheMap && typeof cacheMap === "object" ? cacheMap : {},
  );
}

function normalizePersistedAssistantChapterData(value) {
  const normalizedState = normalizeEditorAssistantState(value);
  return {
    threadsByKey: Object.fromEntries(
      Object.entries(normalizedState.threadsByKey)
        .map(([threadKey, thread]) => {
          const normalizedThread = normalizeEditorAssistantThreadState(thread);
          const expectedThreadKey = buildEditorAssistantThreadKey(
            normalizedThread.rowId,
            normalizedThread.targetLanguageCode,
          );
          if (!expectedThreadKey || expectedThreadKey !== threadKey) {
            return null;
          }

          return [threadKey, normalizedThread];
        })
        .filter(Boolean),
    ),
    chapterArtifacts: normalizeEditorAssistantChapterArtifacts(
      normalizedState.chapterArtifacts,
    ),
  };
}

export function loadStoredEditorAssistantChapterData(team, projectId, chapterId) {
  const teamKey = teamCacheKey(team);
  const chapterKey = chapterAssistantCacheKey(projectId, chapterId);
  if (!teamKey || !chapterKey) {
    return extractPersistedEditorAssistantState(null);
  }

  const cacheMap = loadAssistantCacheMap();
  const teamCache = cacheMap[teamKey];
  if (!teamCache || typeof teamCache !== "object") {
    return extractPersistedEditorAssistantState(null);
  }

  return normalizePersistedAssistantChapterData(teamCache[chapterKey]);
}

export function saveStoredEditorAssistantChapterData(team, projectId, chapterId, assistant) {
  const teamKey = teamCacheKey(team);
  const chapterKey = chapterAssistantCacheKey(projectId, chapterId);
  if (!teamKey || !chapterKey) {
    return;
  }

  const cacheMap = loadAssistantCacheMap();
  const nextAssistant = normalizePersistedAssistantChapterData(assistant);
  const nextTeamCache =
    cacheMap[teamKey] && typeof cacheMap[teamKey] === "object"
      ? { ...cacheMap[teamKey] }
      : {};

  const hasThreads = Object.keys(nextAssistant.threadsByKey).length > 0;
  const hasArtifacts =
    Object.keys(nextAssistant.chapterArtifacts.documentDigestsBySourceLanguage).length > 0;

  if (hasThreads || hasArtifacts) {
    nextTeamCache[chapterKey] = nextAssistant;
    cacheMap[teamKey] = nextTeamCache;
    saveAssistantCacheMap(cacheMap);
    return;
  }

  delete nextTeamCache[chapterKey];
  if (Object.keys(nextTeamCache).length > 0) {
    cacheMap[teamKey] = nextTeamCache;
  } else {
    delete cacheMap[teamKey];
  }
  saveAssistantCacheMap(cacheMap);
}
