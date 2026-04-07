import {
  getActiveStorageLogin,
} from "./team-storage.js";
import {
  readPersistentValue,
  writePersistentValue,
} from "./persistent-store.js";

const PROJECT_CACHE_STORAGE_KEY = "gnosis-tms-project-cache";
const PROJECT_PENDING_MUTATIONS_STORAGE_KEY = "gnosis-tms-project-pending-mutations";
const CHAPTER_PENDING_MUTATIONS_STORAGE_KEY = "gnosis-tms-chapter-pending-mutations";

function scopedStorageKey(baseKey, login = getActiveStorageLogin()) {
  return login ? `${baseKey}:${login}` : null;
}

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
    linkedGlossary1: normalizeChapterGlossaryLink(chapter.linkedGlossary1),
    linkedGlossary2: normalizeChapterGlossaryLink(chapter.linkedGlossary2),
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

function loadProjectCacheMap(login = getActiveStorageLogin()) {
  try {
    const scopedKey = scopedStorageKey(PROJECT_CACHE_STORAGE_KEY, login);
    const storedValue = scopedKey ? readPersistentValue(scopedKey, null) : null;
    if (!storedValue) {
      return {};
    }

    const parsed = storedValue;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveProjectCacheMap(cacheMap, login = getActiveStorageLogin()) {
  try {
    const scopedKey = scopedStorageKey(PROJECT_CACHE_STORAGE_KEY, login);
    if (!scopedKey) {
      return;
    }
    writePersistentValue(scopedKey, cacheMap);
  } catch {}
}

export function projectCacheKey(team) {
  if (Number.isFinite(team?.installationId)) {
    return `installation:${team.installationId}`;
  }

  if (typeof team?.githubOrg === "string" && team.githubOrg.trim()) {
    return `org:${team.githubOrg.trim().toLowerCase()}`;
  }

  if (typeof team?.id === "string" && team.id.trim()) {
    return `team:${team.id.trim()}`;
  }

  return null;
}

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

export function loadStoredProjectPendingMutations(team) {
  const cacheKey = projectCacheKey(team);
  if (!cacheKey) {
    return [];
  }

  try {
    const scopedKey = scopedStorageKey(PROJECT_PENDING_MUTATIONS_STORAGE_KEY);
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

export function saveStoredProjectPendingMutations(team, mutations) {
  const cacheKey = projectCacheKey(team);
  if (!cacheKey) {
    return;
  }

  try {
    const scopedKey = scopedStorageKey(PROJECT_PENDING_MUTATIONS_STORAGE_KEY);
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

export function loadStoredChapterPendingMutations(team) {
  const cacheKey = projectCacheKey(team);
  if (!cacheKey) {
    return [];
  }

  try {
    const scopedKey = scopedStorageKey(CHAPTER_PENDING_MUTATIONS_STORAGE_KEY);
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
    const scopedKey = scopedStorageKey(CHAPTER_PENDING_MUTATIONS_STORAGE_KEY);
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
