import { readPersistentValue, removePersistentValue, writePersistentValue } from "./persistent-store.js";
import {
  loadTeamScopedCacheMap,
  saveTeamScopedCacheMap,
  scopedTeamStorageKey,
  teamCacheKey,
} from "./team-cache.js";

const PROJECT_CACHE_STORAGE_KEY = "gnosis-tms-project-cache";
const CHAPTER_PENDING_MUTATIONS_STORAGE_KEY = "gnosis-tms-chapter-pending-mutations";

function normalizeProject(project) {
  if (!project || typeof project !== "object") {
    return null;
  }

  const id =
    typeof project.id === "string" && project.id.trim()
      ? project.id.trim()
      : null;
  const name =
    typeof project.name === "string" && project.name.trim()
      ? project.name.trim()
      : null;

  if (!id || !name) {
    return null;
  }

  return {
    ...project,
    id,
    name,
    title:
      typeof project.title === "string" && project.title.trim()
        ? project.title.trim()
        : name,
    status: project.status === "deleted" ? "deleted" : "active",
    chapters: Array.isArray(project.chapters) ? project.chapters.map(normalizeChapter).filter(Boolean) : [],
  };
}

function normalizeChapter(chapter) {
  if (!chapter || typeof chapter !== "object") {
    return null;
  }

  const id =
    typeof chapter.id === "string" && chapter.id.trim()
      ? chapter.id.trim()
      : null;
  const name =
    typeof chapter.name === "string" && chapter.name.trim()
      ? chapter.name.trim()
      : null;
  if (!id || !name) {
    return null;
  }

  return {
    ...chapter,
    id,
    name,
    status: chapter.status === "deleted" ? "deleted" : "active",
    linkedGlossary: normalizeChapterGlossaryLink(chapter.linkedGlossary),
  };
}

function normalizeChapterGlossaryLink(link) {
  if (!link || typeof link !== "object") {
    return null;
  }

  const glossaryId =
    typeof link.glossaryId === "string" && link.glossaryId.trim()
      ? link.glossaryId.trim()
      : null;
  const repoName =
    typeof link.repoName === "string" && link.repoName.trim()
      ? link.repoName.trim()
      : null;

  if (!glossaryId || !repoName) {
    return null;
  }

  return {
    glossaryId,
    repoName,
  };
}

function loadProjectCacheMap() {
  return loadTeamScopedCacheMap(PROJECT_CACHE_STORAGE_KEY);
}

function saveProjectCacheMap(cacheMap) {
  saveTeamScopedCacheMap(PROJECT_CACHE_STORAGE_KEY, cacheMap);
}

function removeScopedMutationEntry(storageKey, cacheKey) {
  try {
    const scopedKey = scopedTeamStorageKey(storageKey);
    if (!scopedKey) {
      return;
    }

    const storedValue = readPersistentValue(scopedKey, {});
    const parsed = storedValue ?? {};
    if (!parsed || typeof parsed !== "object" || !Object.prototype.hasOwnProperty.call(parsed, cacheKey)) {
      return;
    }

    delete parsed[cacheKey];
    if (Object.keys(parsed).length === 0) {
      removePersistentValue(scopedKey);
      return;
    }

    writePersistentValue(scopedKey, parsed);
  } catch {}
}

export const projectCacheKey = teamCacheKey;

export function loadStoredProjectsForTeam(team) {
  const cacheKey = projectCacheKey(team);
  if (!cacheKey) {
    return { exists: false, projects: [], deletedProjects: [] };
  }

  const cacheMap = loadProjectCacheMap();
  const entry = cacheMap[cacheKey];
  if (!entry || typeof entry !== "object") {
    return { exists: false, projects: [], deletedProjects: [] };
  }

  return {
    exists: true,
    projects: Array.isArray(entry.projects)
      ? entry.projects.map(normalizeProject).filter(Boolean)
      : [],
    deletedProjects: Array.isArray(entry.deletedProjects)
      ? entry.deletedProjects.map(normalizeProject).filter(Boolean)
      : [],
  };
}

export function saveStoredProjectsForTeam(team, { projects = [], deletedProjects = [] }) {
  const cacheKey = projectCacheKey(team);
  if (!cacheKey) {
    return;
  }

  const cacheMap = loadProjectCacheMap();
  cacheMap[cacheKey] = {
    projects: projects.map(normalizeProject).filter(Boolean),
    deletedProjects: deletedProjects.map(normalizeProject).filter(Boolean),
    updatedAt: new Date().toISOString(),
  };
  saveProjectCacheMap(cacheMap);
}

export function removeStoredProjectDataForTeam(team) {
  const cacheKey = projectCacheKey(team);
  if (!cacheKey) {
    return;
  }

  const cacheMap = loadProjectCacheMap();
  delete cacheMap[cacheKey];
  saveProjectCacheMap(cacheMap);
  removeScopedMutationEntry(CHAPTER_PENDING_MUTATIONS_STORAGE_KEY, cacheKey);
}

export function loadStoredChapterPendingMutations(team) {
  const cacheKey = projectCacheKey(team);
  if (!cacheKey) {
    return [];
  }

  try {
    const scopedKey = scopedTeamStorageKey(CHAPTER_PENDING_MUTATIONS_STORAGE_KEY);
    const storedValue = scopedKey ? readPersistentValue(scopedKey, null) : null;
    if (!storedValue) {
      return [];
    }

    const parsed = storedValue;
    if (!parsed || typeof parsed !== "object") {
      return [];
    }

    return Array.isArray(parsed[cacheKey]) ? parsed[cacheKey] : [];
  } catch {
    return [];
  }
}

export function saveStoredChapterPendingMutations(team, mutations) {
  const cacheKey = projectCacheKey(team);
  if (!cacheKey) {
    return;
  }

  try {
    const scopedKey = scopedTeamStorageKey(CHAPTER_PENDING_MUTATIONS_STORAGE_KEY);
    if (!scopedKey) {
      return;
    }
    const storedValue = readPersistentValue(scopedKey, {});
    const parsed = storedValue ?? {};
    const nextMap = parsed && typeof parsed === "object" ? parsed : {};
    nextMap[cacheKey] = Array.isArray(mutations) ? mutations : [];
    writePersistentValue(scopedKey, nextMap);
  } catch {}
}
