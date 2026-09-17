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

export function glossaryTermWriteIsActive(team, repoName) {
  const scope = glossaryTermWriteScope(team, repoName);
  return writeIntents.anyActive((intent) => intent.scope === scope);
}

// A term write can involve a git sync over the network with no timeout of its own
// (see src-tauri/src/repo_sync_shared.rs), so this wait is bounded: callers must not
// hang indefinitely on a stuck/offline write. A caller that times out proceeds with
// whatever data it has rather than freezing.
const GLOSSARY_TERM_WRITE_SETTLE_TIMEOUT_MS = 10000;

export function waitForGlossaryTermWritesToSettle(team, repoName) {
  const scope = glossaryTermWriteScope(team, repoName);
  if (!writeIntents.scopeIsActive(scope)) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      unsubscribe();
      globalThis.clearTimeout(timeoutId);
      resolve();
    };
    const unsubscribe = writeIntents.subscribe(() => {
      if (!writeIntents.scopeIsActive(scope)) finish();
    });
    const timeoutId = globalThis.setTimeout(finish, GLOSSARY_TERM_WRITE_SETTLE_TIMEOUT_MS);
  });
}

export function failedGlossaryTermWrites(team, glossaryId, repoName) {
  const scope = glossaryTermWriteScope(team, repoName);
  return writeIntents.getIntents().filter((intent) =>
    intent.scope === scope && intent.teamId === team?.id
    && intent.glossaryId === glossaryId && intent.status === "failed",
  );
}

export function clearFailedGlossaryTermWrite(key) {
  writeIntents.clearIntentsWhere((intent) => intent.key === key && intent.status === "failed");
}

export function resetGlossaryTermWriteCoordinator() {
  writeIntents.reset();
}
