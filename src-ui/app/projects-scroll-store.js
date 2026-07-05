// Local persistence for the projects page scroll position: per-login,
// per-team entries over persistent-store.js, following editor-preferences.js.
//
// An entry stores the session anchor (item key + viewport offset), a raw
// scrollTop as coarse fallback, and the project-id set at save time. The id
// set is the invalidation basis: on page entry, if any current project id is
// missing from the saved set — a project was created locally or arrived via
// remote sync while away — the saved position is discarded and the page opens
// at the top. Removals do not invalidate (the anchor fallback chain absorbs
// them), and additions the user witnesses live never yank the viewport: the
// check runs only when (re)entering the page.

import { getActiveStorageLogin } from "./team-storage.js";
import {
  readPersistentValue,
  removePersistentValue,
  writePersistentValue,
} from "./persistent-store.js";
import {
  clearProjectsSessionAnchor,
  readProjectsSessionAnchor,
  updateProjectsSessionAnchor,
} from "./projects-scroll-session.js";

const PROJECTS_SCROLL_STORAGE_KEY = "gnosis-tms-projects-scroll";
const PROJECTS_SCROLL_SAVE_DEBOUNCE_MS = 300;

function normalizeStorageLogin(login) {
  return typeof login === "string" && login.trim() ? login.trim().toLowerCase() : null;
}

function scopedProjectsScrollKey(login = getActiveStorageLogin()) {
  const normalizedLogin = normalizeStorageLogin(login);
  return normalizedLogin ? `${PROJECTS_SCROLL_STORAGE_KEY}:${normalizedLogin}` : null;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeStoredProjectsScrollEntry(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const itemKey = typeof value.itemKey === "string" ? value.itemKey.trim() : "";
  if (!itemKey) {
    return null;
  }

  const offsetTop = Number(value.offsetTop);
  const scrollTop = Number(value.scrollTop);
  const projectIds = Array.isArray(value.projectIds)
    ? value.projectIds.filter((id) => typeof id === "string" && id)
    : [];

  return {
    itemKey,
    offsetTop: Number.isFinite(offsetTop) ? offsetTop : 0,
    ...(Number.isFinite(scrollTop) && scrollTop >= 0 ? { scrollTop } : {}),
    projectIds,
    ...(typeof value.savedAt === "string" && value.savedAt ? { savedAt: value.savedAt } : {}),
  };
}

function loadStoredProjectsScrollMap(login = getActiveStorageLogin()) {
  const key = scopedProjectsScrollKey(login);
  if (!key) {
    return {};
  }

  const rawValue = readPersistentValue(key, null);
  if (rawValue === null || rawValue === undefined) {
    return {};
  }

  if (!isPlainObject(rawValue)) {
    removePersistentValue(key);
    return {};
  }

  const normalizedMap = {};
  for (const [teamId, value] of Object.entries(rawValue)) {
    if (typeof teamId !== "string" || !teamId.trim()) {
      continue;
    }

    const normalizedEntry = normalizeStoredProjectsScrollEntry(value);
    if (normalizedEntry) {
      normalizedMap[teamId] = normalizedEntry;
    }
  }

  return normalizedMap;
}

export function loadStoredProjectsScrollEntry(teamId, login = getActiveStorageLogin()) {
  if (typeof teamId !== "string" || !teamId.trim()) {
    return null;
  }

  return loadStoredProjectsScrollMap(login)[teamId] ?? null;
}

export function saveStoredProjectsScrollEntry(teamId, entry, login = getActiveStorageLogin()) {
  if (typeof teamId !== "string" || !teamId.trim()) {
    return;
  }

  const normalizedEntry = normalizeStoredProjectsScrollEntry(entry);
  const key = scopedProjectsScrollKey(login);
  if (!normalizedEntry || !key) {
    return;
  }

  const entries = loadStoredProjectsScrollMap(login);
  entries[teamId] = normalizedEntry;
  writePersistentValue(key, entries);
}

export function clearStoredProjectsScrollEntry(teamId, login = getActiveStorageLogin()) {
  if (typeof teamId !== "string" || !teamId.trim()) {
    return;
  }

  const key = scopedProjectsScrollKey(login);
  if (!key) {
    return;
  }

  const entries = loadStoredProjectsScrollMap(login);
  if (!Object.prototype.hasOwnProperty.call(entries, teamId)) {
    return;
  }

  delete entries[teamId];
  if (Object.keys(entries).length > 0) {
    writePersistentValue(key, entries);
  } else {
    removePersistentValue(key);
  }
}

/**
 * A saved position is invalid when a project exists now that was not in the
 * saved id set — a new project appeared while the position was in storage.
 */
export function projectsScrollEntryIsInvalidated(entry, currentProjectIds) {
  const savedIds = new Set(Array.isArray(entry?.projectIds) ? entry.projectIds : []);
  return (Array.isArray(currentProjectIds) ? currentProjectIds : []).some(
    (id) => !savedIds.has(id),
  );
}

// --- Render-time reconciliation -------------------------------------------

// Entry restore is deferred until the first projects render with data, so a
// cold start (empty list while discovery runs) neither restores against an
// empty list nor misses invalidation when projects arrive a moment later.
let pendingRestoreTeamId = "";
let lastRenderedProjectsTeamId = null;
// Set when an entry resolves to "no position" (nothing stored, or the stored
// entry was invalidated). The controller consumes it to force the top —
// necessary because the generic same-screen scroll restore would otherwise
// carry the previous team's pixel offset across a team switch.
let pendingTopReset = false;

function currentProjectIdsFromState(appState) {
  return (Array.isArray(appState?.projects) ? appState.projects : []).map((project) =>
    String(project?.id ?? ""),
  );
}

/**
 * Called before every full render. On projects-page entry (from another
 * screen, or a team switch while on the page) it arbitrates between the
 * in-memory session anchor and the stored entry:
 *
 * - stored entry invalidated by a new project -> discard both, open at top
 * - otherwise, seed the session anchor from the stored entry when the
 *   session has none (app restart); an existing session anchor wins.
 */
export function reconcileProjectsScrollOnRender(previousScreen, appState) {
  if (appState?.screen !== "projects") {
    pendingRestoreTeamId = "";
    lastRenderedProjectsTeamId = null;
    return;
  }

  const teamId = appState.selectedTeamId ?? "";
  const isEntry = previousScreen !== "projects" || lastRenderedProjectsTeamId !== teamId;
  lastRenderedProjectsTeamId = teamId;
  if (isEntry) {
    pendingRestoreTeamId = teamId;
    if (!readProjectsSessionAnchor(teamId)) {
      // A stale anchor from another team must not drive this team's restore.
      clearProjectsSessionAnchor();
    }
  }

  if (pendingRestoreTeamId !== teamId) {
    return;
  }

  const currentProjectIds = currentProjectIdsFromState(appState);
  if (currentProjectIds.length === 0) {
    return;
  }

  pendingRestoreTeamId = "";
  const storedEntry = loadStoredProjectsScrollEntry(teamId);
  if (!storedEntry) {
    if (!readProjectsSessionAnchor(teamId)) {
      pendingTopReset = true;
    }
    return;
  }

  if (projectsScrollEntryIsInvalidated(storedEntry, currentProjectIds)) {
    clearStoredProjectsScrollEntry(teamId);
    clearProjectsSessionAnchor();
    pendingTopReset = true;
    return;
  }

  if (!readProjectsSessionAnchor(teamId)) {
    updateProjectsSessionAnchor(
      { itemKey: storedEntry.itemKey, offsetTop: storedEntry.offsetTop },
      teamId,
    );
  }
}

/** One-shot: whether the current projects render should open at the top. */
export function consumeProjectsScrollTopReset() {
  const shouldReset = pendingTopReset;
  pendingTopReset = false;
  return shouldReset;
}

// --- Save scheduling --------------------------------------------------------

let saveTimeoutId = 0;
let pendingSave = null;

function writePendingSave() {
  if (!pendingSave) {
    return;
  }

  const { teamId, ...entry } = pendingSave;
  pendingSave = null;
  saveStoredProjectsScrollEntry(teamId, {
    ...entry,
    savedAt: new Date().toISOString(),
  });
}

/**
 * Debounced save while scrolling. All entry data is captured at schedule
 * time so a navigation away before the timer fires still persists the last
 * position (and never reads another screen's DOM).
 */
export function scheduleProjectsScrollSave(teamId, anchor, projectIds, scrollTop) {
  if (typeof teamId !== "string" || !teamId || !anchor?.itemKey) {
    return;
  }

  pendingSave = {
    teamId,
    itemKey: anchor.itemKey,
    offsetTop: anchor.offsetTop,
    ...(Number.isFinite(scrollTop) && scrollTop >= 0 ? { scrollTop } : {}),
    projectIds,
  };
  if (saveTimeoutId) {
    clearTimeout(saveTimeoutId);
  }
  saveTimeoutId = setTimeout(() => {
    saveTimeoutId = 0;
    writePendingSave();
  }, PROJECTS_SCROLL_SAVE_DEBOUNCE_MS);
}

export function resetProjectsScrollStoreForTests() {
  pendingRestoreTeamId = "";
  lastRenderedProjectsTeamId = null;
  pendingTopReset = false;
  pendingSave = null;
  if (saveTimeoutId) {
    clearTimeout(saveTimeoutId);
    saveTimeoutId = 0;
  }
}
