import { createWriteIntentCoordinator } from "./write-intent-coordinator.js";

const writeIntents = createWriteIntentCoordinator({
  defaultScope: "glossary-term-writes:default",
  label: "Glossary term",
});

export function glossaryTermSaveIntentKey(glossaryId, termIdOrClientId) {
  return `glossary-term:save:${glossaryId ?? "unknown"}:${termIdOrClientId ?? "unknown"}`;
}

export function glossaryTermWriteScope(team, repoName) {
  return `glossary-repo:${team?.installationId ?? "unknown"}:${repoName || "unknown"}`;
}

export function requestGlossaryTermWriteIntent(intent, operations = {}) {
  return writeIntents.request(intent, operations);
}

export function getGlossaryTermWriteIntent(key) {
  return writeIntents.getIntent(key);
}

export function anyGlossaryTermWriteIsActive() {
  return writeIntents.anyActive();
}

export function resetGlossaryTermWriteCoordinator() {
  writeIntents.reset();
}
