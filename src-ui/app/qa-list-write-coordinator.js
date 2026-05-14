import { createWriteIntentCoordinator } from "./write-intent-coordinator.js";

const writeIntents = createWriteIntentCoordinator({
  defaultScope: "qa-list-writes:default",
  label: "QA list",
});

export function resetQaListWriteCoordinator() {
  writeIntents.reset();
}

export function qaListTitleIntentKey(qaListId) {
  return `qa-list:title:${qaListId}`;
}

export function qaListLifecycleIntentKey(qaListId) {
  return `qa-list:lifecycle:${qaListId}`;
}

export function qaListRepoSyncIntentKey(repoName) {
  return `qa-list:repo-sync:${repoName}`;
}

export function qaListTeamMetadataWriteScope(team) {
  return `team-metadata:${team?.installationId ?? "unknown"}`;
}

export function requestQaListWriteIntent(intent, operations = {}) {
  return writeIntents.request(intent, operations);
}

export function getQaListWriteIntent(key) {
  return writeIntents.getIntent(key);
}

export function anyQaListWriteIsActive() {
  return writeIntents.anyActive();
}

export function anyQaListMutatingWriteIsActive() {
  return writeIntents.anyActive((intent) => intent.type !== "qaListRepoSync");
}

function patchQaList(snapshot, qaListId, patch) {
  if (!snapshot || typeof snapshot !== "object") {
    return snapshot;
  }

  let changed = false;
  const qaLists = (Array.isArray(snapshot.qaLists) ? snapshot.qaLists : [])
    .map((qaList) => {
      if (qaList?.id !== qaListId) {
        return qaList;
      }
      changed = true;
      return {
        ...qaList,
        ...patch,
      };
    });

  return changed
    ? {
      ...snapshot,
      qaLists,
    }
    : snapshot;
}

function intentMatchesSnapshot(intent, snapshot) {
  const qaList = (Array.isArray(snapshot?.qaLists) ? snapshot.qaLists : [])
    .find((item) => item?.id === intent.qaListId);
  if (!qaList) {
    return false;
  }

  if (intent.type === "qaListTitle") {
    return qaList.title === intent.value?.title;
  }
  if (intent.type === "qaListLifecycle") {
    return (qaList.lifecycleState === "deleted" ? "deleted" : "active") === intent.value?.lifecycleState;
  }
  return false;
}

export function applyQaListWriteIntentsToSnapshot(snapshot) {
  let nextSnapshot = snapshot && typeof snapshot === "object"
    ? {
        ...snapshot,
        qaLists: Array.isArray(snapshot.qaLists) ? snapshot.qaLists : [],
      }
    : snapshot;

  for (const intent of writeIntents.getIntents()) {
    if (intent.status === "confirmed") {
      continue;
    }
    if (intent.type === "qaListTitle") {
      nextSnapshot = patchQaList(nextSnapshot, intent.qaListId, {
        title: intent.value?.title,
        pendingMutation: "rename",
      });
      continue;
    }
    if (intent.type === "qaListLifecycle") {
      nextSnapshot = patchQaList(nextSnapshot, intent.qaListId, {
        lifecycleState: intent.value?.lifecycleState === "deleted" ? "deleted" : "active",
        pendingMutation: intent.value?.lifecycleState === "deleted" ? "softDelete" : "restore",
      });
    }
  }

  return nextSnapshot;
}

export function clearConfirmedQaListWriteIntents(snapshot) {
  writeIntents.clearIntentsWhere((intent) =>
    intent.status === "pendingConfirmation"
    && intentMatchesSnapshot(intent, snapshot)
  );
}
