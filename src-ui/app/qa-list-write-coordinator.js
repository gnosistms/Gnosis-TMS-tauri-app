import { createRepoResourceWriteCoordinator } from "./repo-resource/write-coordinator.js";

const qaListWriteCoordinator = createRepoResourceWriteCoordinator({
  defaultScope: "qa-list-writes:default",
  label: "QA list",
  keyPrefix: "qa-list",
  collectionField: "qaLists",
  intentResourceIdField: "qaListId",
  titleIntentType: "qaListTitle",
  lifecycleIntentType: "qaListLifecycle",
  repoSyncIntentType: "qaListRepoSync",
});

export function resetQaListWriteCoordinator() {
  qaListWriteCoordinator.reset();
}

export function qaListTitleIntentKey(qaListId) {
  return qaListWriteCoordinator.titleIntentKey(qaListId);
}

export function qaListLifecycleIntentKey(qaListId) {
  return qaListWriteCoordinator.lifecycleIntentKey(qaListId);
}

export function qaListRepoSyncIntentKey(repoName) {
  return qaListWriteCoordinator.repoSyncIntentKey(repoName);
}

export function qaListTeamMetadataWriteScope(team) {
  return qaListWriteCoordinator.teamMetadataWriteScope(team);
}

export function requestQaListWriteIntent(intent, operations = {}) {
  return qaListWriteCoordinator.requestWriteIntent(intent, operations);
}

export function getQaListWriteIntent(key) {
  return qaListWriteCoordinator.getWriteIntent(key);
}

export function anyQaListWriteIsActive() {
  return qaListWriteCoordinator.anyWriteIsActive();
}

export function anyQaListMutatingWriteIsActive() {
  return qaListWriteCoordinator.anyMutatingWriteIsActive();
}

export function applyQaListWriteIntentsToSnapshot(snapshot) {
  return qaListWriteCoordinator.applyWriteIntentsToSnapshot(snapshot);
}

export function clearConfirmedQaListWriteIntents(snapshot) {
  qaListWriteCoordinator.clearConfirmedWriteIntents(snapshot);
}
