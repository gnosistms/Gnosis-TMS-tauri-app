import {
  cloneWriteIntentValue,
  createWriteIntentCoordinator,
} from "./write-intent-coordinator.js";
import {
  addDeletedMarkerToDescription,
  normalizeTeamSnapshot,
  removeDeletedMarkerFromDescription,
} from "./team-flow/shared.js";

const writeIntents = createWriteIntentCoordinator({
  defaultScope: "team-writes:default",
  label: "Team",
});

function normalizeSnapshot(snapshot) {
  return normalizeTeamSnapshot({
    items: Array.isArray(snapshot?.items) ? snapshot.items : [],
    deletedItems: Array.isArray(snapshot?.deletedItems) ? snapshot.deletedItems : [],
  });
}

export function teamRenameIntentKey(teamId) {
  return `team:rename:${teamId ?? "unknown"}`;
}

export function teamLifecycleIntentKey(teamId) {
  return `team:lifecycle:${teamId ?? "unknown"}`;
}

export function teamWriteScope(team) {
  return `team:${team?.installationId ?? team?.id ?? "unknown"}`;
}

export function requestTeamWriteIntent(intent, operations = {}) {
  if (intent?.type === "teamLifecycle") {
    writeIntents.clearIntentsWhere((currentIntent) =>
      currentIntent.teamId === intent.teamId
      && currentIntent.type === "teamLifecycle"
      && currentIntent.key !== intent.key
    );
  }
  if (intent?.type === "teamPermanentDelete") {
    writeIntents.clearIntentsWhere((currentIntent) =>
      currentIntent.teamId === intent.teamId
      && (currentIntent.type === "teamRename" || currentIntent.type === "teamLifecycle")
    );
  }
  return writeIntents.request(intent, operations);
}

export function getTeamWriteIntent(key) {
  return writeIntents.getIntent(key);
}

export function anyTeamWriteIsActive() {
  return writeIntents.anyActive();
}

export function resetTeamWriteCoordinator() {
  writeIntents.reset();
}

function findTeam(snapshot, teamId) {
  return snapshot.items.find((team) => team?.id === teamId)
    ?? snapshot.deletedItems.find((team) => team?.id === teamId)
    ?? null;
}

function patchTeam(snapshot, teamId, patch) {
  let changed = false;
  const patchOne = (team) => {
    if (team?.id !== teamId) {
      return team;
    }
    changed = true;
    return {
      ...team,
      ...cloneWriteIntentValue(patch),
    };
  };
  const nextSnapshot = {
    items: snapshot.items.map(patchOne),
    deletedItems: snapshot.deletedItems.map(patchOne),
  };
  return changed ? nextSnapshot : snapshot;
}

function moveTeam(snapshot, teamId, targetCollection, patch = {}) {
  const team = findTeam(snapshot, teamId);
  if (!team) {
    return snapshot;
  }
  const nextTeam = {
    ...team,
    ...cloneWriteIntentValue(patch),
  };
  const items = snapshot.items.filter((item) => item?.id !== teamId);
  const deletedItems = snapshot.deletedItems.filter((item) => item?.id !== teamId);
  if (targetCollection === "deleted") {
    deletedItems.unshift(nextTeam);
  } else {
    items.unshift(nextTeam);
  }
  return normalizeTeamSnapshot({ items, deletedItems });
}

function removeTeam(snapshot, teamId) {
  return {
    items: snapshot.items.filter((team) => team?.id !== teamId),
    deletedItems: snapshot.deletedItems.filter((team) => team?.id !== teamId),
  };
}

export function applyTeamWriteIntentsToSnapshot(snapshot) {
  let nextSnapshot = normalizeSnapshot(snapshot);

  for (const intent of writeIntents.getIntents()) {
    if (intent.status === "confirmed") {
      continue;
    }

    if (intent.type === "teamRename") {
      nextSnapshot = patchTeam(nextSnapshot, intent.teamId, {
        name: intent.value?.name,
        pendingMutation: "rename",
        pendingError: "",
      });
      continue;
    }

    if (intent.type === "teamLifecycle") {
      const targetDeleted = intent.value?.lifecycleState === "deleted";
      const currentTeam = findTeam(nextSnapshot, intent.teamId);
      nextSnapshot = moveTeam(
        nextSnapshot,
        intent.teamId,
        targetDeleted ? "deleted" : "active",
        {
          description: targetDeleted
            ? addDeletedMarkerToDescription(currentTeam?.description)
            : removeDeletedMarkerFromDescription(currentTeam?.description),
          isDeleted: targetDeleted,
          deletedAt: targetDeleted ? intent.value?.deletedAt ?? new Date().toISOString() : null,
          syncState: targetDeleted ? "deleted" : "active",
          statusLabel: targetDeleted ? "Removed from active teams" : "",
          pendingMutation: targetDeleted ? "softDelete" : "restore",
          pendingError: "",
        },
      );
      continue;
    }

    if (intent.type === "teamPermanentDelete" && intent.status === "pendingConfirmation") {
      nextSnapshot = removeTeam(nextSnapshot, intent.teamId);
    }
  }

  return Array.isArray(snapshot?.items) || Array.isArray(snapshot?.deletedItems)
    ? {
        ...snapshot,
        items: nextSnapshot.items,
        deletedItems: nextSnapshot.deletedItems,
      }
    : nextSnapshot;
}

function intentMatchesSnapshot(intent, snapshot) {
  const team = findTeam(snapshot, intent.teamId);

  if (intent.type === "teamRename") {
    return team?.name === intent.value?.name;
  }
  if (intent.type === "teamLifecycle") {
    if (intent.value?.lifecycleState === "deleted") {
      return snapshot.deletedItems.some((item) => item?.id === intent.teamId);
    }
    return snapshot.items.some((item) => item?.id === intent.teamId);
  }
  if (intent.type === "teamPermanentDelete" || intent.type === "teamLeave") {
    return !team;
  }
  return false;
}

export function clearConfirmedTeamWriteIntents(snapshot) {
  const normalizedSnapshot = normalizeSnapshot(snapshot);
  writeIntents.clearIntentsWhere((intent) =>
    intent.status === "pendingConfirmation" && intentMatchesSnapshot(intent, normalizedSnapshot)
  );
}
