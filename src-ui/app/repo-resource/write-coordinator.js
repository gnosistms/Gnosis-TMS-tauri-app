import { createWriteIntentCoordinator } from "../write-intent-coordinator.js";
import { resourceId } from "./resource-descriptor.js";

function patchResource(snapshot, id, patch, config) {
  if (!snapshot || typeof snapshot !== "object") {
    return snapshot;
  }

  let changed = false;
  const resources = (Array.isArray(snapshot[config.collectionField]) ? snapshot[config.collectionField] : [])
    .map((resource) => {
      if (resourceId(resource, config) !== id) {
        return resource;
      }
      changed = true;
      return {
        ...resource,
        ...patch,
      };
    });

  return changed
    ? {
      ...snapshot,
      [config.collectionField]: resources,
    }
    : snapshot;
}

function intentMatchesSnapshot(intent, snapshot, config) {
  const resource = (Array.isArray(snapshot?.[config.collectionField]) ? snapshot[config.collectionField] : [])
    .find((item) => resourceId(item, config) === intent[config.resourceIdField]);
  if (!resource) {
    return false;
  }

  if (intent.type === config.titleIntentType) {
    return resource.title === intent.value?.title;
  }
  if (intent.type === config.lifecycleIntentType) {
    return (resource.lifecycleState === "deleted" ? "deleted" : "active") === intent.value?.lifecycleState;
  }
  return false;
}

export function createRepoResourceWriteCoordinator(config) {
  const writeIntents = createWriteIntentCoordinator({
    defaultScope: config.defaultScope,
    label: config.label,
  });

  return {
    reset() {
      writeIntents.reset();
    },
    titleIntentKey(id) {
      return `${config.keyPrefix}:title:${id}`;
    },
    lifecycleIntentKey(id) {
      return `${config.keyPrefix}:lifecycle:${id}`;
    },
    repoSyncIntentKey(repoName) {
      return `${config.keyPrefix}:repo-sync:${repoName}`;
    },
    teamMetadataWriteScope(team) {
      return `team-metadata:${team?.installationId ?? "unknown"}`;
    },
    requestWriteIntent(intent, operations = {}) {
      return writeIntents.request(intent, operations);
    },
    getWriteIntent(key) {
      return writeIntents.getIntent(key);
    },
    anyWriteIsActive() {
      return writeIntents.anyActive();
    },
    anyMutatingWriteIsActive() {
      return writeIntents.anyActive((intent) => intent.type !== config.repoSyncIntentType);
    },
    applyWriteIntentsToSnapshot(snapshot) {
      let nextSnapshot = snapshot && typeof snapshot === "object"
        ? {
            ...snapshot,
            [config.collectionField]: Array.isArray(snapshot[config.collectionField])
              ? snapshot[config.collectionField]
              : [],
          }
        : snapshot;

      for (const intent of writeIntents.getIntents()) {
        if (intent.status === "confirmed") {
          continue;
        }
        if (intent.type === config.titleIntentType) {
          nextSnapshot = patchResource(nextSnapshot, intent[config.resourceIdField], {
            title: intent.value?.title,
            pendingMutation: "rename",
          }, config);
          continue;
        }
        if (intent.type === config.lifecycleIntentType) {
          nextSnapshot = patchResource(nextSnapshot, intent[config.resourceIdField], {
            lifecycleState: intent.value?.lifecycleState === "deleted" ? "deleted" : "active",
            pendingMutation: intent.value?.lifecycleState === "deleted" ? "softDelete" : "restore",
          }, config);
        }
      }

      return nextSnapshot;
    },
    clearConfirmedWriteIntents(snapshot) {
      writeIntents.clearIntentsWhere((intent) =>
        intent.status === "pendingConfirmation"
        && intentMatchesSnapshot(intent, snapshot, config)
      );
    },
  };
}
