import { createWriteIntentCoordinator } from "./write-intent-coordinator.js";

const writeIntents = createWriteIntentCoordinator({
  defaultScope: "glossary-writes:default",
  label: "Glossary",
});

export function resetGlossaryWriteCoordinator() {
  writeIntents.reset();
}

export function glossaryTitleIntentKey(glossaryId) {
  return `glossary:title:${glossaryId}`;
}

export function glossaryLifecycleIntentKey(glossaryId) {
  return `glossary:lifecycle:${glossaryId}`;
}

export function glossaryRepoSyncIntentKey(repoName) {
  return `glossary:repo-sync:${repoName}`;
}

export function teamMetadataWriteScope(team) {
  return `team-metadata:${team?.installationId ?? "unknown"}`;
}

export function requestGlossaryWriteIntent(intent, operations = {}) {
  return writeIntents.request(intent, operations);
}

export function getGlossaryWriteIntent(key) {
  return writeIntents.getIntent(key);
}

export function anyGlossaryWriteIsActive() {
  return writeIntents.anyActive();
}

export function anyGlossaryMutatingWriteIsActive() {
  return writeIntents.anyActive((intent) => intent.type !== "glossaryRepoSync");
}

function patchGlossary(snapshot, glossaryId, patch) {
  if (!snapshot || typeof snapshot !== "object") {
    return snapshot;
  }

  let changed = false;
  const glossaries = (Array.isArray(snapshot.glossaries) ? snapshot.glossaries : [])
    .map((glossary) => {
      if (glossary?.id !== glossaryId) {
        return glossary;
      }
      changed = true;
      return {
        ...glossary,
        ...patch,
      };
    });

  return changed
    ? {
      ...snapshot,
      glossaries,
    }
    : snapshot;
}

function intentMatchesSnapshot(intent, snapshot) {
  const glossary = (Array.isArray(snapshot?.glossaries) ? snapshot.glossaries : [])
    .find((item) => item?.id === intent.glossaryId);
  if (!glossary) {
    return false;
  }

  if (intent.type === "glossaryTitle") {
    return glossary.title === intent.value?.title;
  }
  if (intent.type === "glossaryLifecycle") {
    return (glossary.lifecycleState === "deleted" ? "deleted" : "active") === intent.value?.lifecycleState;
  }
  return false;
}

export function applyGlossaryWriteIntentsToSnapshot(snapshot) {
  let nextSnapshot = snapshot && typeof snapshot === "object"
    ? {
        ...snapshot,
        glossaries: Array.isArray(snapshot.glossaries) ? snapshot.glossaries : [],
      }
    : snapshot;

  for (const intent of writeIntents.getIntents()) {
    if (intent.status === "confirmed") {
      continue;
    }
    if (intent.type === "glossaryTitle") {
      nextSnapshot = patchGlossary(nextSnapshot, intent.glossaryId, {
        title: intent.value?.title,
        pendingMutation: "rename",
      });
      continue;
    }
    if (intent.type === "glossaryLifecycle") {
      nextSnapshot = patchGlossary(nextSnapshot, intent.glossaryId, {
        lifecycleState: intent.value?.lifecycleState === "deleted" ? "deleted" : "active",
        pendingMutation: intent.value?.lifecycleState === "deleted" ? "softDelete" : "restore",
      });
    }
  }

  return nextSnapshot;
}

export function clearConfirmedGlossaryWriteIntents(snapshot) {
  writeIntents.clearIntentsWhere((intent) =>
    intent.status === "pendingConfirmation"
    && intentMatchesSnapshot(intent, snapshot)
  );
}
