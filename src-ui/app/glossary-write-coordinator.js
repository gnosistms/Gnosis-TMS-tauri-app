const intentsByKey = new Map();
const operationsByKey = new Map();
const queuesByScope = new Map();
const listeners = new Set();

function nowIso() {
  return new Date().toISOString();
}

function cloneValue(value) {
  if (value == null) {
    return value;
  }
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function writeStateChanged() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {}
  }
}

function queueForScope(scope) {
  const normalizedScope = typeof scope === "string" && scope.trim() ? scope.trim() : "glossary-writes:default";
  let queue = queuesByScope.get(normalizedScope);
  if (!queue) {
    queue = {
      scope: normalizedScope,
      items: [],
      queuedKeys: new Set(),
      running: false,
    };
    queuesByScope.set(normalizedScope, queue);
  }
  return queue;
}

function enqueueIntentKey(scope, key) {
  const queue = queueForScope(scope);
  if (!queue.queuedKeys.has(key)) {
    queue.items.push(key);
    queue.queuedKeys.add(key);
  }
  void processScopeQueue(queue);
}

async function processScopeQueue(queue) {
  if (queue.running) {
    return;
  }

  queue.running = true;
  writeStateChanged();
  try {
    while (queue.items.length > 0) {
      const key = queue.items.shift();
      queue.queuedKeys.delete(key);
      const operations = operationsByKey.get(key);
      const intent = intentsByKey.get(key);
      if (!intent || !operations || intent.scope !== queue.scope) {
        continue;
      }

      const runningVersion = intent.version;
      intentsByKey.set(key, {
        ...intent,
        status: "running",
        error: "",
        updatedAt: nowIso(),
      });
      operations.onStatusChange?.(intentsByKey.get(key));
      writeStateChanged();

      try {
        await operations.run(intentsByKey.get(key));
        const latest = intentsByKey.get(key);
        if (!latest) {
          continue;
        }
        if (latest.version !== runningVersion) {
          enqueueIntentKey(latest.scope, latest.key);
          continue;
        }

        const confirmedIntent = {
          ...latest,
          status: "pendingConfirmation",
          error: "",
          updatedAt: nowIso(),
        };
        intentsByKey.set(key, confirmedIntent);
        operations.onSuccess?.(confirmedIntent);
        operations.onStatusChange?.(confirmedIntent);
        if (operations.clearOnSuccess === true) {
          intentsByKey.delete(key);
          operationsByKey.delete(key);
        }
      } catch (error) {
        const latest = intentsByKey.get(key);
        if (!latest) {
          continue;
        }
        if (latest.version !== runningVersion) {
          enqueueIntentKey(latest.scope, latest.key);
          continue;
        }

        const failedIntent = {
          ...latest,
          status: "failed",
          error: error?.message ?? String(error),
          updatedAt: nowIso(),
        };
        intentsByKey.set(key, failedIntent);
        operations.onError?.(error, failedIntent);
        operations.onStatusChange?.(failedIntent);
      } finally {
        writeStateChanged();
      }
    }
  } finally {
    queue.running = false;
    writeStateChanged();
  }
}

export function resetGlossaryWriteCoordinator() {
  intentsByKey.clear();
  operationsByKey.clear();
  queuesByScope.clear();
  writeStateChanged();
}

export function subscribeGlossaryWriteState(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
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
  if (!intent?.key || !intent?.scope || typeof operations.run !== "function") {
    throw new Error("Glossary write intents require a key, scope, and run callback.");
  }

  const previous = intentsByKey.get(intent.key);
  const nextIntent = {
    ...intent,
    value: cloneValue(intent.value),
    previousValue: cloneValue(intent.previousValue),
    status: "pending",
    error: "",
    createdAt: previous?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    version: (previous?.version ?? 0) + 1,
  };

  intentsByKey.set(nextIntent.key, nextIntent);
  operationsByKey.set(nextIntent.key, operations);
  operations.applyOptimistic?.(nextIntent, previous);
  operations.onStatusChange?.(nextIntent);
  writeStateChanged();
  enqueueIntentKey(nextIntent.scope, nextIntent.key);
  return nextIntent;
}

export function getGlossaryWriteIntent(key) {
  return intentsByKey.get(key) ?? null;
}

export function getGlossaryWriteState(key) {
  return intentsByKey.get(key)?.status ?? "idle";
}

export function glossaryWriteIsActive(key) {
  const status = getGlossaryWriteState(key);
  return status === "pending" || status === "running";
}

export function glossaryWriteScopeIsActive(scope) {
  const queue = queuesByScope.get(scope);
  if (queue?.running || (queue?.items?.length ?? 0) > 0) {
    return true;
  }
  for (const intent of intentsByKey.values()) {
    if (intent.scope === scope && (intent.status === "pending" || intent.status === "running")) {
      return true;
    }
  }
  return false;
}

export function anyGlossaryWriteIsActive() {
  for (const intent of intentsByKey.values()) {
    if (intent.status === "pending" || intent.status === "running") {
      return true;
    }
  }
  return false;
}

export function anyGlossaryMutatingWriteIsActive() {
  for (const intent of intentsByKey.values()) {
    if (
      intent.type !== "glossaryRepoSync"
      && (intent.status === "pending" || intent.status === "running")
    ) {
      return true;
    }
  }
  return false;
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

  for (const intent of intentsByKey.values()) {
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
  let changed = false;
  for (const [key, intent] of intentsByKey.entries()) {
    if (intentMatchesSnapshot(intent, snapshot)) {
      intentsByKey.delete(key);
      operationsByKey.delete(key);
      changed = true;
    }
  }
  if (changed) {
    writeStateChanged();
  }
}
