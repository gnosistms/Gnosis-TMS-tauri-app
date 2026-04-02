import { splitStoredTeamRecords } from "../team-storage.js";
import { state } from "../state.js";
import { removeItem, replaceItem } from "../optimistic-collection.js";
import { deriveInstallationApprovalState, normalizeInstallationPermissions } from "../github-app-permissions.js";

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
    step: "guide",
    error: "",
    githubAppInstallationId: null,
    githubAppInstallation: null,
  };
}

export function applyStoredTeamRecords(teamRecords) {
  const { activeTeams, deletedTeams } = splitStoredTeamRecords(teamRecords);
  state.teams = activeTeams;
  state.deletedTeams = deletedTeams;
  if (deletedTeams.length === 0) {
    state.showDeletedTeams = false;
  }
}

export function applyTeamSnapshotToState(snapshot) {
  state.teams = snapshot.items;
  state.deletedTeams = snapshot.deletedItems;
  if (snapshot.deletedItems.length === 0) {
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
  const approvalState = deriveInstallationApprovalState(installation.permissions);
  return {
    id: `github-app-installation-${installation.installationId}`,
    name: resolvedName,
    githubOrg: installation.accountLogin,
    ownerLogin: installation.accountLogin,
    description: installation.description ?? null,
    installationId: installation.installationId,
    membershipRole: installation.membershipRole ?? "member",
    canDelete: installation.canDelete === true,
    canManageMembers: installation.canManageMembers === true,
    canManageProjects: installation.canManageProjects === true,
    canLeave: installation.canLeave !== false,
    needsAppApproval: approvalState.needsAppApproval,
    appApprovalUrl: installation.appApprovalUrl ?? null,
    appRequestUrl: installation.appRequestUrl ?? null,
    grantedAppPermissions: approvalState.grantedAppPermissions,
    missingAppPermissions: approvalState.missingAppPermissions,
    isDeleted: deleted,
    deletedAt: deleted ? new Date().toISOString() : null,
    syncState: deleted ? "deleted" : "active",
    statusLabel: deleted ? "Removed from active teams" : "",
    lastSeenAt: new Date().toISOString(),
  };
}

export function reconcileStoredTeam(storedTeam, installation) {
  const deleted = isTeamSoftDeleted(installation.description);
  const resolvedName =
    installation.accountName || installation.accountLogin || storedTeam.name || storedTeam.githubOrg;
  const nextGrantedPermissions = normalizeInstallationPermissions(
    installation.permissions ?? storedTeam.grantedAppPermissions,
  );
  const approvalState = deriveInstallationApprovalState(nextGrantedPermissions);
  return {
    ...storedTeam,
    name: resolvedName,
    githubOrg: installation.accountLogin || storedTeam.githubOrg,
    ownerLogin: installation.accountLogin || storedTeam.ownerLogin || storedTeam.githubOrg,
    description: installation.description ?? storedTeam.description ?? null,
    membershipRole: installation.membershipRole || storedTeam.membershipRole || "member",
    canDelete: installation.canDelete === true,
    canManageMembers: installation.canManageMembers === true,
    canManageProjects: installation.canManageProjects === true,
    canLeave: installation.canLeave !== false,
    needsAppApproval: approvalState.needsAppApproval,
    appApprovalUrl: installation.appApprovalUrl ?? storedTeam.appApprovalUrl ?? null,
    appRequestUrl: installation.appRequestUrl ?? storedTeam.appRequestUrl ?? null,
    grantedAppPermissions: approvalState.grantedAppPermissions,
    missingAppPermissions: approvalState.missingAppPermissions,
    lastSeenAt: new Date().toISOString(),
    isDeleted: deleted,
    deletedAt: deleted ? storedTeam.deletedAt ?? new Date().toISOString() : null,
    syncState: deleted ? "deleted" : "active",
    statusLabel: deleted ? "Removed from active teams" : "",
  };
}

export function normalizeTeamSnapshot(snapshot, pendingMutations = []) {
  const latestMutationByTeamId = new Map();
  for (const mutation of pendingMutations) {
    if (mutation?.teamId) {
      latestMutationByTeamId.set(mutation.teamId, mutation.type);
    }
  }

  const activeById = new Map(snapshot.items.map((team) => [team.id, team]));
  const deletedById = new Map(snapshot.deletedItems.map((team) => [team.id, team]));
  const teamIds = new Set([...activeById.keys(), ...deletedById.keys()]);

  const items = [];
  const deletedItems = [];

  for (const teamId of teamIds) {
    const activeTeam = activeById.get(teamId);
    const deletedTeam = deletedById.get(teamId);
    const latestMutation = latestMutationByTeamId.get(teamId);

    if (activeTeam && deletedTeam) {
      if (latestMutation === "softDelete") {
        deletedItems.push({
          ...deletedTeam,
          isDeleted: true,
          syncState: "deleted",
          statusLabel: deletedTeam.statusLabel || "Removed from active teams",
        });
        continue;
      }

      if (latestMutation === "restore" || latestMutation === "rename") {
        items.push({
          ...activeTeam,
          isDeleted: false,
          deletedAt: null,
          syncState: "active",
          statusLabel: "",
        });
        continue;
      }

      if (deletedTeam.isDeleted === true && activeTeam.isDeleted !== true) {
        deletedItems.push({
          ...deletedTeam,
          isDeleted: true,
          syncState: "deleted",
          statusLabel: deletedTeam.statusLabel || "Removed from active teams",
        });
        continue;
      }

      items.push({
        ...activeTeam,
        isDeleted: false,
        deletedAt: null,
        syncState: "active",
        statusLabel: "",
      });
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
      items.push({
        ...activeTeam,
        isDeleted: false,
        deletedAt: null,
        syncState: "active",
        statusLabel: "",
      });
    }
  }

  return { items, deletedItems };
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
