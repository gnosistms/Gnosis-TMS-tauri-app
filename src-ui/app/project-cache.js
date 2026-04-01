import {
  getActiveStorageLogin,
} from "./team-storage.js";

const PROJECT_CACHE_STORAGE_KEY = "gnosis-tms-project-cache";
const PROJECT_PENDING_MUTATIONS_STORAGE_KEY = "gnosis-tms-project-pending-mutations";

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
    chapters: Array.isArray(project.chapters) ? project.chapters : [],
  };
}

function loadProjectCacheMap(login = getActiveStorageLogin()) {
  try {
    const scopedKey = scopedStorageKey(PROJECT_CACHE_STORAGE_KEY, login);
    const storedValue = scopedKey ? window.localStorage?.getItem(scopedKey) : null;
    if (!storedValue) {
      return {};
    }

    const parsed = JSON.parse(storedValue);
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
    window.localStorage?.setItem(scopedKey, JSON.stringify(cacheMap));
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
    const storedValue = scopedKey ? window.localStorage?.getItem(scopedKey) : null;
    if (!storedValue) {
      return [];
    }

    const parsed = JSON.parse(storedValue);
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
    const storedValue = window.localStorage?.getItem(scopedKey);
    const parsed = storedValue ? JSON.parse(storedValue) : {};
    const nextMap = parsed && typeof parsed === "object" ? parsed : {};
    nextMap[cacheKey] = Array.isArray(mutations) ? mutations : [];
    window.localStorage?.setItem(scopedKey, JSON.stringify(nextMap));
  } catch {}
}
