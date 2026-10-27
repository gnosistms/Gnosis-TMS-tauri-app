import { getActiveStorageLogin } from "./team-storage.js";
import {
  readPersistentValue,
  removePersistentValue,
  writePersistentValue,
} from "./persistent-store.js";

// Local-only memory of the last successful export per chapter (option id,
// plus the last WordPress post for each connected site). Not synced to the team.
const EDITOR_EXPORT_DEFAULTS_STORAGE_KEY = "gnosis-tms-editor-export-defaults";
const EDITOR_EXPORT_PDF_PAPER_SIZE_STORAGE_KEY = "gnosis-tms-editor-export-pdf-paper-size";

function normalizeStorageLogin(login) {
  return typeof login === "string" && login.trim() ? login.trim().toLowerCase() : null;
}

function scopedEditorExportDefaultsKey(login = getActiveStorageLogin()) {
  const normalizedLogin = normalizeStorageLogin(login);
  return normalizedLogin ? `${EDITOR_EXPORT_DEFAULTS_STORAGE_KEY}:${normalizedLogin}` : null;
}

function scopedEditorExportPdfPaperSizeKey(login = getActiveStorageLogin()) {
  const normalizedLogin = normalizeStorageLogin(login);
  return normalizedLogin ? `${EDITOR_EXPORT_PDF_PAPER_SIZE_STORAGE_KEY}:${normalizedLogin}` : null;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeWordPressPost(value, requireSiteId = true) {
  if (!isPlainObject(value)) return null;
  const postId = Number.parseInt(String(value.postId ?? ""), 10);
  if (!Number.isFinite(postId) || postId <= 0) return null;
  const siteId = typeof value.siteId === "string" ? value.siteId.trim() : "";
  if (requireSiteId && !siteId) return null;
  const normalized = {
    ...(siteId ? { siteId } : {}),
    postId,
    postTitle: typeof value.postTitle === "string" ? value.postTitle.trim() : "",
  };
  if (siteId) {
    normalized.siteKind = typeof value.siteKind === "string" ? value.siteKind.trim() : "";
    normalized.siteUrl = typeof value.siteUrl === "string" ? value.siteUrl.trim() : "";
  }
  return normalized;
}

function normalizeStoredWordPress(value) {
  if (!isPlainObject(value)) return null;

  const destinationsBySite = new Map();
  if (Array.isArray(value.destinations)) {
    for (const candidate of value.destinations) {
      const destination = normalizeWordPressPost(candidate);
      if (destination) destinationsBySite.set(destination.siteId, destination);
    }
  }

  // Pre-per-site records stored the one destination directly on `wordpress`.
  const legacyDestination = normalizeWordPressPost(value, false);
  if (legacyDestination?.siteId) {
    destinationsBySite.set(legacyDestination.siteId, legacyDestination);
  }

  const destinations = [...destinationsBySite.values()];
  const requestedLastSiteId = typeof value.lastSiteId === "string" ? value.lastSiteId.trim() : "";
  const legacySiteId = legacyDestination?.siteId ?? "";
  const lastSiteId = destinations.some((item) => item.siteId === requestedLastSiteId)
    ? requestedLastSiteId
    : destinations.some((item) => item.siteId === legacySiteId)
      ? legacySiteId
      : "";
  const unscopedLegacyDestination = legacyDestination && !legacyDestination.siteId
    ? legacyDestination
    : normalizeWordPressPost(value.legacyDestination, false);

  if (destinations.length === 0 && !unscopedLegacyDestination) return null;
  return {
    ...(lastSiteId ? { lastSiteId } : {}),
    destinations,
    ...(unscopedLegacyDestination ? { legacyDestination: unscopedLegacyDestination } : {}),
  };
}

function normalizeStoredEditorExportDefault(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const optionId = typeof value.optionId === "string" ? value.optionId.trim() : "";
  if (!optionId) {
    return null;
  }

  const normalized = { optionId };
  const wordpress = normalizeStoredWordPress(value.wordpress);
  if (wordpress) normalized.wordpress = wordpress;
  return normalized;
}

function saveEditorExportDefaultsMap(defaults, login = getActiveStorageLogin()) {
  const key = scopedEditorExportDefaultsKey(login);
  if (!key) return;
  if (Object.keys(defaults).length > 0) writePersistentValue(key, defaults);
  else removePersistentValue(key);
}

export function clearStoredWordPressAssociationsForSite(siteId, login = getActiveStorageLogin()) {
  const normalizedSiteId = String(siteId ?? "").trim();
  if (!normalizedSiteId) return;
  const defaults = loadStoredEditorExportDefaultsMap(login);
  let changed = false;
  for (const [chapterId, value] of Object.entries(defaults)) {
    const current = normalizeStoredEditorExportDefault(value);
    if (!current?.wordpress?.destinations.some((item) => item.siteId === normalizedSiteId)) continue;
    const destinations = current.wordpress.destinations.filter((item) => item.siteId !== normalizedSiteId);
    const wordpress = destinations.length > 0 || current.wordpress.legacyDestination
      ? {
        ...(current.wordpress.lastSiteId !== normalizedSiteId && current.wordpress.lastSiteId
          ? { lastSiteId: current.wordpress.lastSiteId }
          : {}),
        destinations,
        ...(current.wordpress.legacyDestination
          ? { legacyDestination: current.wordpress.legacyDestination }
          : {}),
      }
      : null;
    defaults[chapterId] = {
      optionId: current.optionId,
      ...(wordpress ? { wordpress } : {}),
    };
    changed = true;
  }
  if (changed) saveEditorExportDefaultsMap(defaults, login);
}

export function findStoredWordPressDestination(wordpress, siteId) {
  const normalizedSiteId = String(siteId ?? "").trim();
  if (!normalizedSiteId) return null;
  const normalized = normalizeStoredWordPress(wordpress);
  return normalized?.destinations.find((item) => item.siteId === normalizedSiteId) ?? null;
}

export function lastStoredWordPressDestination(wordpress) {
  const normalized = normalizeStoredWordPress(wordpress);
  if (!normalized?.lastSiteId) return null;
  return findStoredWordPressDestination(normalized, normalized.lastSiteId);
}

export function upsertStoredWordPressDestination(
  chapterId,
  destination,
  login = getActiveStorageLogin(),
) {
  const normalizedDestination = normalizeWordPressPost(destination);
  if (!normalizedDestination) return;
  const current = loadStoredEditorExportDefault(chapterId, login);
  const destinations = (current?.wordpress?.destinations ?? [])
    .filter((item) => item.siteId !== normalizedDestination.siteId);
  destinations.push(normalizedDestination);
  saveStoredEditorExportDefault(chapterId, {
    optionId: "link:wordpress",
    wordpress: {
      lastSiteId: normalizedDestination.siteId,
      destinations,
      ...(current?.wordpress?.legacyDestination
        ? { legacyDestination: current.wordpress.legacyDestination }
        : {}),
    },
  }, login);
}

function loadStoredEditorExportDefaultsMap(login = getActiveStorageLogin()) {
  const key = scopedEditorExportDefaultsKey(login);
  if (!key) {
    return {};
  }

  const rawValue = readPersistentValue(key, null);
  if (!isPlainObject(rawValue)) {
    return {};
  }
  return rawValue;
}

export function loadStoredEditorExportDefault(chapterId, login = getActiveStorageLogin()) {
  if (typeof chapterId !== "string" || !chapterId.trim()) {
    return null;
  }

  const defaults = loadStoredEditorExportDefaultsMap(login);
  return normalizeStoredEditorExportDefault(defaults[chapterId]);
}

export function saveStoredEditorExportDefault(
  chapterId,
  value,
  login = getActiveStorageLogin(),
) {
  if (typeof chapterId !== "string" || !chapterId.trim()) {
    return;
  }

  const key = scopedEditorExportDefaultsKey(login);
  if (!key) {
    return;
  }

  const defaults = loadStoredEditorExportDefaultsMap(login);
  const previous = normalizeStoredEditorExportDefault(defaults[chapterId]);
  const normalized = normalizeStoredEditorExportDefault(value);
  if (!normalized) {
    if (!Object.prototype.hasOwnProperty.call(defaults, chapterId)) {
      return;
    }
    delete defaults[chapterId];
    if (Object.keys(defaults).length > 0) {
      writePersistentValue(key, defaults);
    } else {
      removePersistentValue(key);
    }
    return;
  }

  if (normalized.optionId !== "link:wordpress" && !normalized.wordpress && previous?.wordpress) {
    normalized.wordpress = previous.wordpress;
  }

  defaults[chapterId] = normalized;
  writePersistentValue(key, defaults);
}

export function loadStoredEditorExportPaperSize(login = getActiveStorageLogin()) {
  const key = scopedEditorExportPdfPaperSizeKey(login);
  if (!key) {
    return null;
  }
  const stored = readPersistentValue(key, null);
  return typeof stored === "string" && stored.trim() ? stored.trim() : null;
}

export function saveStoredEditorExportPaperSize(
  paperSize,
  login = getActiveStorageLogin(),
) {
  const key = scopedEditorExportPdfPaperSizeKey(login);
  if (!key) {
    return;
  }
  const normalized = typeof paperSize === "string" ? paperSize.trim() : "";
  if (!normalized) {
    removePersistentValue(key);
    return;
  }
  writePersistentValue(key, normalized);
}
