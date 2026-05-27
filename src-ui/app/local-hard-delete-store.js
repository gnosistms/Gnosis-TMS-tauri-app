import {
  readPersistentValue,
  removePersistentValue,
  writePersistentValue,
} from "./persistent-store.js";
import { getActiveStorageLogin } from "./team-storage.js";

const LOCAL_HARD_DELETE_STORAGE_KEY = "gnosis-tms-local-hard-delete-tombstones";

function scopedStorageKey(login = getActiveStorageLogin()) {
  return login ? `${LOCAL_HARD_DELETE_STORAGE_KEY}:${login}` : null;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeKind(value) {
  const kind = normalizeText(value);
  return kind || null;
}

function normalizeTombstone(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const installationId = Number.isFinite(value.installationId)
    ? value.installationId
    : null;
  const resourceKind = normalizeKind(value.resourceKind);
  const resourceId = normalizeText(value.resourceId);
  const repoName = normalizeText(value.repoName);
  const fullName = normalizeText(value.fullName);
  if (!resourceKind || (!resourceId && !repoName && !fullName)) {
    return null;
  }

  return {
    installationId,
    resourceKind,
    resourceId,
    repoName,
    fullName,
    deletedAt:
      typeof value.deletedAt === "string" && value.deletedAt.trim()
        ? value.deletedAt.trim()
        : new Date().toISOString(),
  };
}

function loadLocalHardDeleteTombstones() {
  try {
    const key = scopedStorageKey();
    if (!key) {
      return [];
    }
    const stored = readPersistentValue(key, []);
    return (Array.isArray(stored) ? stored : [])
      .map(normalizeTombstone)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function saveLocalHardDeleteTombstones(tombstones) {
  try {
    const key = scopedStorageKey();
    if (!key) {
      return;
    }
    const normalized = (Array.isArray(tombstones) ? tombstones : [])
      .map(normalizeTombstone)
      .filter(Boolean);
    if (normalized.length === 0) {
      removePersistentValue(key);
      return;
    }
    writePersistentValue(key, normalized);
  } catch {}
}

function teamInstallationId(team) {
  return Number.isFinite(team?.installationId) ? team.installationId : null;
}

function resourceIdentifier(resource, kind) {
  const idFields = kind === "team"
    ? [resource?.id, resource?.githubOrg]
    : [resource?.id, resource?.projectId, resource?.glossaryId, resource?.qaListId];
  const resourceId = idFields.map(normalizeText).find(Boolean) ?? "";
  const repoName = normalizeText(resource?.repoName ?? resource?.name ?? resource?.githubOrg);
  const fullName = normalizeText(resource?.fullName);
  return { resourceId, repoName, fullName };
}

function tombstoneIdentity(tombstone) {
  return [
    tombstone.installationId ?? "",
    normalizeLower(tombstone.resourceKind),
    normalizeLower(tombstone.resourceId),
    normalizeLower(tombstone.repoName),
    normalizeLower(tombstone.fullName),
  ].join("|");
}

export function addLocalHardDeleteTombstone(team, resourceKind, resource) {
  const identifiers = resourceIdentifier(resource, resourceKind);
  const tombstone = normalizeTombstone({
    installationId: teamInstallationId(team),
    resourceKind,
    ...identifiers,
    deletedAt: new Date().toISOString(),
  });
  if (!tombstone) {
    return;
  }

  const tombstones = loadLocalHardDeleteTombstones();
  const next = tombstones.filter((item) => tombstoneIdentity(item) !== tombstoneIdentity(tombstone));
  next.push(tombstone);
  saveLocalHardDeleteTombstones(next);
}

export function resourceMatchesLocalHardDeleteTombstone(team, resourceKind, resource, tombstone) {
  const normalized = normalizeTombstone(tombstone);
  if (!normalized || normalized.resourceKind !== resourceKind) {
    return false;
  }
  const installationId = teamInstallationId(team);
  if (normalized.installationId !== null && installationId !== null && normalized.installationId !== installationId) {
    return false;
  }

  const identifiers = resourceIdentifier(resource, resourceKind);
  return (
    Boolean(identifiers.resourceId && normalizeLower(identifiers.resourceId) === normalizeLower(normalized.resourceId))
    || Boolean(identifiers.fullName && normalizeLower(identifiers.fullName) === normalizeLower(normalized.fullName))
    || Boolean(identifiers.repoName && normalizeLower(identifiers.repoName) === normalizeLower(normalized.repoName))
  );
}

export function isLocalHardDeletedResource(team, resourceKind, resource) {
  return loadLocalHardDeleteTombstones().some((tombstone) =>
    resourceMatchesLocalHardDeleteTombstone(team, resourceKind, resource, tombstone)
  );
}

export function clearLocalHardDeleteTombstoneForResource(team, resourceKind, resource) {
  const tombstones = loadLocalHardDeleteTombstones();
  const next = tombstones.filter((tombstone) =>
    !resourceMatchesLocalHardDeleteTombstone(team, resourceKind, resource, tombstone)
  );
  if (next.length !== tombstones.length) {
    saveLocalHardDeleteTombstones(next);
  }
}

export function filterLocalHardDeletedResources(team, resourceKind, resources, { isDeleted } = {}) {
  const tombstones = loadLocalHardDeleteTombstones();
  if (!Array.isArray(resources) || tombstones.length === 0) {
    return Array.isArray(resources) ? resources : [];
  }
  const deletedPredicate = typeof isDeleted === "function" ? isDeleted : () => true;
  return resources.filter((resource) =>
    !deletedPredicate(resource)
    || !tombstones.some((tombstone) =>
      resourceMatchesLocalHardDeleteTombstone(team, resourceKind, resource, tombstone)
    )
  );
}

export function clearRestoredLocalHardDeleteTombstones(team, resourceKind, resources, { isActive } = {}) {
  const activePredicate = typeof isActive === "function" ? isActive : () => false;
  const activeResources = (Array.isArray(resources) ? resources : []).filter(activePredicate);
  if (activeResources.length === 0) {
    return;
  }
  const tombstones = loadLocalHardDeleteTombstones();
  const next = tombstones.filter((tombstone) =>
    !activeResources.some((resource) =>
      resourceMatchesLocalHardDeleteTombstone(team, resourceKind, resource, tombstone)
    )
  );
  if (next.length !== tombstones.length) {
    saveLocalHardDeleteTombstones(next);
  }
}
