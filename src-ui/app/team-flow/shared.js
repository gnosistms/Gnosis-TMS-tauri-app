import { splitStoredTeamRecords } from "../team-storage.js";
import { state } from "../state.js";
import { removeItem, replaceItem } from "../optimistic-collection.js";
import {
  buildTeamRecordFromInstallationData,
  reconcileTeamRecordWithInstallation,
} from "./team-records.js";

export const DELETED_TEAM_MARKER = "[DELETED]";

export function isTeamSoftDeleted(description) {
  return typeof description === "string" && description.trimStart().startsWith(DELETED_TEAM_MARKER);
}

export function addDeletedMarkerToDescription(description) {
  const normalized = typeof description === "string" ? description.trim() : "";
  if (isTeamSoftDeleted(normalized)) {
    return normalized;
  }
  return normalized ? `${DELETED_TEAM_MARKER} ${normalized}` : DELETED_TEAM_MARKER;
}

export function removeDeletedMarkerFromDescription(description) {
  const normalized = typeof description === "string" ? description : "";
  const withoutMarker = normalized.replace(/^\s*\[DELETED\]\s*/u, "");
  return withoutMarker.trim() || null;
}

export function resetOpenState() {
  return {
    step: "intro",
    error: "",
    githubAppInstallationId: null,
    githubAppInstallation: null,
    invalidInstallationAccountLogin: "",
    invalidInstallationAccountType: "",
    expectedOrganizationName: "",
  };
}

export function isOrganizationTeamRecord(team) {
  const accountType = String(team?.accountType ?? "").trim().toLowerCase();
  return accountType === "organization";
}

export function applyStoredTeamRecords(teamRecords) {
  const { activeTeams, deletedTeams } = splitStoredTeamRecords(teamRecords);
  const visibleActiveTeams = activeTeams.filter(isOrganizationTeamRecord);
  const visibleDeletedTeams = deletedTeams.filter(isOrganizationTeamRecord);
  state.teams = visibleActiveTeams;
  state.deletedTeams = visibleDeletedTeams;
  if (visibleDeletedTeams.length === 0) {
    state.showDeletedTeams = false;
  }
}

export function applyTeamSnapshotToState(snapshot) {
  state.teams = snapshot.items.filter(isOrganizationTeamRecord);
  state.deletedTeams = snapshot.deletedItems.filter(isOrganizationTeamRecord);
  if (state.deletedTeams.length === 0) {
    state.showDeletedTeams = false;
  }
}

export function resolveNextSelectedTeamId(currentTeamId, teams) {
  if (currentTeamId && teams.some((team) => team.id === currentTeamId)) {
    return currentTeamId;
  }

  return teams[0]?.id ?? null;
}

export function buildTeamRecordFromInstallation(installation) {
  const deleted = isTeamSoftDeleted(installation.description);
  const resolvedName = installation.accountName || installation.accountLogin;
  return buildTeamRecordFromInstallationData(installation, {
    id: `github-app-installation-${installation.installationId}`,
    name: resolvedName,
    githubOrg: installation.accountLogin,
    ownerLogin: installation.accountLogin,
    description: installation.description ?? null,
    installationId: installation.installationId,
    membershipRole: installation.membershipRole ?? "member",
    accountType: installation.accountType ?? null,
    isDeleted: deleted,
    deletedAt: deleted ? new Date().toISOString() : null,
    syncState: deleted ? "deleted" : "active",
    statusLabel: deleted ? "Removed from active teams" : "",
    lastSeenAt: new Date().toISOString(),
    unconfirmedSince: null,
  });
}

export const UNCONFIRMED_TEAM_STATUS_LABEL = "Couldn't verify team access just now";
const UNLISTED_TEAM_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// A team may only be removed from the stored records by an affirmative signal:
// the user deletes or leaves it, or it stays MISSING from successful listings
// for over a week (a real uninstall is absent from every healthy response; a
// GitHub brownout is not). A team merely absent from — or degraded in — one
// listing keeps its cached record and capabilities; treating those as
// uninstalls erased teams (the 2026-07-14 incident).
//
// unconfirmedSince is the absence clock: stamped when a team first goes
// missing from a listing, cleared whenever a listing contains the team
// (healthy or degraded — presence proves the installation exists).

// A team PRESENT in the listing but with a degraded entry (the broker could
// not verify it against GitHub): keep the cached record and capabilities,
// show it as unconfirmed, and reset the absence clock. Never expires.
export function markStoredTeamUnconfirmed(storedTeam) {
  if (!storedTeam) {
    return null;
  }
  if (storedTeam.isDeleted === true) {
    return { ...storedTeam, unconfirmedSince: null };
  }
  return {
    ...storedTeam,
    syncState: "unconfirmed",
    statusLabel: UNCONFIRMED_TEAM_STATUS_LABEL,
    unconfirmedSince: null,
  };
}

// A team MISSING from a successful listing: keep it as unconfirmed and start
// (or continue) the absence clock; drop it once it has been absent for over a
// week of successful listings. Soft-deleted records keep their deleted
// presentation but age out on the same clock — a genuinely uninstalled
// team's deleted record should not sit in the list forever.
export function retainUnlistedStoredTeam(storedTeam, { now = new Date() } = {}) {
  if (!storedTeam) {
    return null;
  }
  const unconfirmedSinceMs = Date.parse(storedTeam.unconfirmedSince ?? "");
  if (
    Number.isFinite(unconfirmedSinceMs)
    && now.getTime() - unconfirmedSinceMs > UNLISTED_TEAM_RETENTION_MS
  ) {
    return null;
  }
  const unconfirmedSince = Number.isFinite(unconfirmedSinceMs)
    ? storedTeam.unconfirmedSince
    : now.toISOString();
  if (storedTeam.isDeleted === true) {
    return { ...storedTeam, unconfirmedSince };
  }
  return {
    ...storedTeam,
    syncState: "unconfirmed",
    statusLabel: UNCONFIRMED_TEAM_STATUS_LABEL,
    unconfirmedSince,
  };
}

export function reconcileStoredTeam(storedTeam, installation) {
  const deleted = isTeamSoftDeleted(installation.description);
  const resolvedName =
    installation.accountName || installation.accountLogin || storedTeam.name || storedTeam.githubOrg;
  return reconcileTeamRecordWithInstallation(storedTeam, installation, {
    name: resolvedName,
    githubOrg: installation.accountLogin || storedTeam.githubOrg,
    ownerLogin: installation.accountLogin || storedTeam.ownerLogin || storedTeam.githubOrg,
    description: installation.description ?? storedTeam.description ?? null,
    membershipRole: installation.membershipRole || storedTeam.membershipRole || "member",
    accountType: installation.accountType ?? storedTeam.accountType ?? null,
    lastSeenAt: new Date().toISOString(),
    isDeleted: deleted,
    deletedAt: deleted ? storedTeam.deletedAt ?? new Date().toISOString() : null,
    syncState: deleted ? "deleted" : "active",
    statusLabel: deleted ? "Removed from active teams" : "",
    unconfirmedSince: null,
  });
}

export function normalizeTeamSnapshot(snapshot) {
  const activeById = new Map(snapshot.items.map((team) => [team.id, team]));
  const deletedById = new Map(snapshot.deletedItems.map((team) => [team.id, team]));
  const teamIds = new Set([...activeById.keys(), ...deletedById.keys()]);

  const items = [];
  const deletedItems = [];

  for (const teamId of teamIds) {
    const activeTeam = activeById.get(teamId);
    const deletedTeam = deletedById.get(teamId);

    if (activeTeam && deletedTeam) {
      if (deletedTeam.isDeleted === true && activeTeam.isDeleted !== true) {
        deletedItems.push({
          ...deletedTeam,
          isDeleted: true,
          syncState: "deleted",
          statusLabel: deletedTeam.statusLabel || "Removed from active teams",
        });
        continue;
      }

      items.push(normalizeActiveTeamForSnapshot(activeTeam));
      continue;
    }

    if (deletedTeam) {
      deletedItems.push({
        ...deletedTeam,
        isDeleted: true,
        syncState: "deleted",
        statusLabel: deletedTeam.statusLabel || "Removed from active teams",
      });
      continue;
    }

    if (activeTeam) {
      items.push(normalizeActiveTeamForSnapshot(activeTeam));
    }
  }

  return { items, deletedItems };
}

// Unconfirmed teams are active-but-unverified; snapshot normalization must not
// promote them back to a clean "active" presentation.
function normalizeActiveTeamForSnapshot(activeTeam) {
  return {
    ...activeTeam,
    isDeleted: false,
    deletedAt: null,
    ...(activeTeam.syncState === "unconfirmed" ? {} : { syncState: "active", statusLabel: "" }),
  };
}

export function applyTeamPendingMutation(snapshot, mutation) {
  const normalizedSnapshot = normalizeTeamSnapshot(snapshot);
  if (!mutation?.teamId) {
    return normalizedSnapshot;
  }

  const findTeam = () =>
    normalizedSnapshot.items.find((item) => item.id === mutation.teamId) ??
    normalizedSnapshot.deletedItems.find((item) => item.id === mutation.teamId);
  const currentTeam = findTeam();
  if (!currentTeam) {
    return normalizedSnapshot;
  }

  if (mutation.type === "softDelete") {
    const deletedTeam = {
      ...currentTeam,
      description: addDeletedMarkerToDescription(currentTeam.description),
      isDeleted: true,
      deletedAt: mutation.deletedAt ?? currentTeam.deletedAt ?? new Date().toISOString(),
      syncState: "deleted",
      statusLabel: "Removed from active teams",
    };
    return normalizeTeamSnapshot({
      items: removeItem(normalizedSnapshot.items, mutation.teamId),
      deletedItems: [deletedTeam, ...removeItem(normalizedSnapshot.deletedItems, mutation.teamId)],
    });
  }

  if (mutation.type === "restore") {
    const restoredTeam = {
      ...currentTeam,
      description: removeDeletedMarkerFromDescription(currentTeam.description),
      isDeleted: false,
      deletedAt: null,
      syncState: "active",
      statusLabel: "",
    };
    return normalizeTeamSnapshot({
      items: replaceItem(removeItem(normalizedSnapshot.items, mutation.teamId), restoredTeam),
      deletedItems: removeItem(normalizedSnapshot.deletedItems, mutation.teamId),
    });
  }

  if (mutation.type === "rename") {
    const renamedTeam = {
      ...currentTeam,
      name: mutation.name,
    };
    if (currentTeam.isDeleted) {
      return normalizeTeamSnapshot({
        items: removeItem(normalizedSnapshot.items, mutation.teamId),
        deletedItems: replaceItem(normalizedSnapshot.deletedItems, renamedTeam),
      });
    }

    return normalizeTeamSnapshot({
      items: replaceItem(normalizedSnapshot.items, renamedTeam),
      deletedItems: removeItem(normalizedSnapshot.deletedItems, mutation.teamId),
    });
  }

  return normalizedSnapshot;
}
