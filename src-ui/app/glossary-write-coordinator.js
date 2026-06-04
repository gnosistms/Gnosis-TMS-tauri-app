import { createRepoResourceWriteCoordinator } from "./repo-resource/write-coordinator.js";

const glossaryWriteCoordinator = createRepoResourceWriteCoordinator({
  defaultScope: "glossary-writes:default",
  label: "Glossary",
  keyPrefix: "glossary",
  collectionField: "glossaries",
  intentResourceIdField: "glossaryId",
  titleIntentType: "glossaryTitle",
  lifecycleIntentType: "glossaryLifecycle",
  repoSyncIntentType: "glossaryRepoSync",
});

export function resetGlossaryWriteCoordinator() {
  glossaryWriteCoordinator.reset();
}

export function glossaryTitleIntentKey(glossaryId) {
  return glossaryWriteCoordinator.titleIntentKey(glossaryId);
}

export function glossaryLifecycleIntentKey(glossaryId) {
  return glossaryWriteCoordinator.lifecycleIntentKey(glossaryId);
}

export function glossaryRepoSyncIntentKey(repoName) {
  return glossaryWriteCoordinator.repoSyncIntentKey(repoName);
}

export function teamMetadataWriteScope(team) {
  return glossaryWriteCoordinator.teamMetadataWriteScope(team);
}

export function requestGlossaryWriteIntent(intent, operations = {}) {
  return glossaryWriteCoordinator.requestWriteIntent(intent, operations);
}

export function getGlossaryWriteIntent(key) {
  return glossaryWriteCoordinator.getWriteIntent(key);
}

export function anyGlossaryWriteIsActive() {
  return glossaryWriteCoordinator.anyWriteIsActive();
}

export function anyGlossaryMutatingWriteIsActive() {
  return glossaryWriteCoordinator.anyMutatingWriteIsActive();
}

export function applyGlossaryWriteIntentsToSnapshot(snapshot) {
  return glossaryWriteCoordinator.applyWriteIntentsToSnapshot(snapshot);
}

export function clearConfirmedGlossaryWriteIntents(snapshot) {
  glossaryWriteCoordinator.clearConfirmedWriteIntents(snapshot);
}
