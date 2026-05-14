import { createWriteIntentCoordinator } from "./write-intent-coordinator.js";

const writeIntents = createWriteIntentCoordinator({
  defaultScope: "qa-term-writes:default",
  label: "QA term",
});

let activeQaListTermWriteCount = 0;

export function qaTermSaveIntentKey(qaListId, termIdOrClientId) {
  return `qa-term:save:${qaListId ?? "unknown"}:${termIdOrClientId ?? "unknown"}`;
}

export function qaTermWriteScope(team, repoName) {
  return `qa-list-repo:${team?.installationId ?? "unknown"}:${repoName || "unknown"}`;
}

export function requestQaTermWriteIntent(intent, operations = {}) {
  return writeIntents.request(intent, operations);
}

export function getQaTermWriteIntent(key) {
  return writeIntents.getIntent(key);
}

export function anyQaTermWriteIsActive() {
  return activeQaListTermWriteCount > 0 || writeIntents.anyActive();
}

export function beginQaTermWrite() {
  activeQaListTermWriteCount += 1;
}

export function endQaTermWrite() {
  activeQaListTermWriteCount = Math.max(0, activeQaListTermWriteCount - 1);
}

export function qaListTermWriteIsActive() {
  return anyQaTermWriteIsActive();
}

export function resetQaTermWriteCoordinator() {
  activeQaListTermWriteCount = 0;
  writeIntents.reset();
}
