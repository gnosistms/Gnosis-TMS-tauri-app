import { readPersistentValue, removePersistentValue, writePersistentValue } from "./persistent-store.js";
import { scopedTeamStorageKey, teamCacheKey } from "./team-cache.js";
import { normalizeEditorDerivedGlossariesByRowId } from "./editor-derived-glossary-state.js";

const EDITOR_DERIVED_GLOSSARY_STORAGE_KEY = "gnosis-tms-editor-derived-glossaries";

function normalizeProjectId(projectId) {
  return typeof projectId === "string" && projectId.trim() ? projectId.trim() : "";
}

function normalizeChapterId(chapterId) {
  return typeof chapterId === "string" && chapterId.trim() ? chapterId.trim() : "";
}

function chapterDerivedGlossaryCacheKey(projectId, chapterId) {
  const normalizedProjectId = normalizeProjectId(projectId);
  const normalizedChapterId = normalizeChapterId(chapterId);
  if (!normalizedProjectId || !normalizedChapterId) {
    return null;
  }

  return `${normalizedProjectId}::${normalizedChapterId}`;
}

function loadDerivedGlossaryCacheMap() {
  try {
    const scopedKey = scopedTeamStorageKey(EDITOR_DERIVED_GLOSSARY_STORAGE_KEY);
    const storedValue = scopedKey ? readPersistentValue(scopedKey, null) : null;
    return storedValue && typeof storedValue === "object" ? storedValue : {};
  } catch {
    return {};
  }
}

function saveDerivedGlossaryCacheMap(cacheMap) {
  try {
    const scopedKey = scopedTeamStorageKey(EDITOR_DERIVED_GLOSSARY_STORAGE_KEY);
    if (!scopedKey) {
      return;
    }

    if (cacheMap && typeof cacheMap === "object" && Object.keys(cacheMap).length > 0) {
      writePersistentValue(scopedKey, cacheMap);
      return;
    }

    removePersistentValue(scopedKey);
  } catch {}
}

function normalizePersistedDerivedGlossaryEntry(entry) {
  const normalizedEntry = normalizeEditorDerivedGlossariesByRowId({
    persisted: entry,
  }).persisted;
  if (normalizedEntry?.status !== "ready") {
    return null;
  }

  return {
    status: "ready",
    error: "",
    requestKey: normalizedEntry.requestKey,
    translationSourceLanguageCode: normalizedEntry.translationSourceLanguageCode,
    glossarySourceLanguageCode: normalizedEntry.glossarySourceLanguageCode,
    targetLanguageCode: normalizedEntry.targetLanguageCode,
    translationSourceText: normalizedEntry.translationSourceText,
    glossarySourceText: normalizedEntry.glossarySourceText,
    glossarySourceTextOrigin: normalizedEntry.glossarySourceTextOrigin,
    glossaryRevisionKey: normalizedEntry.glossaryRevisionKey,
    entries: normalizedEntry.entries,
  };
}

function normalizePersistedDerivedGlossariesByRowId(derivedGlossariesByRowId) {
  return Object.fromEntries(
    Object.entries(normalizeEditorDerivedGlossariesByRowId(derivedGlossariesByRowId))
      .filter(([, entry]) => entry?.status === "ready")
      .map(([rowId, entry]) => [rowId, normalizePersistedDerivedGlossaryEntry(entry)])
      .filter(([, entry]) => Boolean(entry)),
  );
}

export function loadStoredEditorDerivedGlossariesForChapter(team, projectId, chapterId) {
  const teamKey = teamCacheKey(team);
  const chapterKey = chapterDerivedGlossaryCacheKey(projectId, chapterId);
  if (!teamKey || !chapterKey) {
    return {};
  }

  const cacheMap = loadDerivedGlossaryCacheMap();
  const teamCache = cacheMap[teamKey];
  if (!teamCache || typeof teamCache !== "object") {
    return {};
  }

  return normalizePersistedDerivedGlossariesByRowId(teamCache[chapterKey]);
}

export function saveStoredEditorDerivedGlossariesForChapter(
  team,
  projectId,
  chapterId,
  derivedGlossariesByRowId,
) {
  const teamKey = teamCacheKey(team);
  const chapterKey = chapterDerivedGlossaryCacheKey(projectId, chapterId);
  if (!teamKey || !chapterKey) {
    return;
  }

  const cacheMap = loadDerivedGlossaryCacheMap();
  const nextEntries = normalizePersistedDerivedGlossariesByRowId(derivedGlossariesByRowId);
  const nextTeamCache =
    cacheMap[teamKey] && typeof cacheMap[teamKey] === "object"
      ? { ...cacheMap[teamKey] }
      : {};

  if (Object.keys(nextEntries).length > 0) {
    nextTeamCache[chapterKey] = nextEntries;
    cacheMap[teamKey] = nextTeamCache;
    saveDerivedGlossaryCacheMap(cacheMap);
    return;
  }

  delete nextTeamCache[chapterKey];
  if (Object.keys(nextTeamCache).length > 0) {
    cacheMap[teamKey] = nextTeamCache;
  } else {
    delete cacheMap[teamKey];
  }
  saveDerivedGlossaryCacheMap(cacheMap);
}

export function saveStoredEditorDerivedGlossaryEntryForChapter(
  team,
  projectId,
  chapterId,
  rowId,
  entry,
) {
  if (typeof rowId !== "string" || !rowId.trim()) {
    return;
  }

  const nextEntries = loadStoredEditorDerivedGlossariesForChapter(team, projectId, chapterId);
  const normalizedEntry = normalizePersistedDerivedGlossaryEntry(entry);
  if (normalizedEntry) {
    nextEntries[rowId] = normalizedEntry;
  } else {
    delete nextEntries[rowId];
  }
  saveStoredEditorDerivedGlossariesForChapter(team, projectId, chapterId, nextEntries);
}

export function removeStoredEditorDerivedGlossaryEntryForChapter(
  team,
  projectId,
  chapterId,
  rowId,
) {
  if (typeof rowId !== "string" || !rowId.trim()) {
    return;
  }

  const nextEntries = loadStoredEditorDerivedGlossariesForChapter(team, projectId, chapterId);
  if (!(rowId in nextEntries)) {
    return;
  }

  delete nextEntries[rowId];
  saveStoredEditorDerivedGlossariesForChapter(team, projectId, chapterId, nextEntries);
}
