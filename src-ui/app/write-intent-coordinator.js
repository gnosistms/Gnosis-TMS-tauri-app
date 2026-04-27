const ACTIVE_WRITE_STATUSES = new Set(["pending", "running"]);

function nowIso() {
  return new Date().toISOString();
}

export function cloneWriteIntentValue(value) {
  if (value == null) {
    return value;
  }
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function createWriteIntentCoordinator(options = {}) {
  const defaultScope = typeof options.defaultScope === "string" && options.defaultScope.trim()
    ? options.defaultScope.trim()
    : "write-intents:default";
  const label = typeof options.label === "string" && options.label.trim()
    ? options.label.trim()
    : "Write";

  const intentsByKey = new Map();
  const operationsByKey = new Map();
  const queuesByScope = new Map();
  const listeners = new Set();

  function writeStateChanged() {
    for (const listener of listeners) {
      try {
        listener();
      } catch {}
    }
  }

  function normalizeScope(scope) {
    return typeof scope === "string" && scope.trim() ? scope.trim() : defaultScope;
  }

  function queueForScope(scope) {
    const normalizedScope = normalizeScope(scope);
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

  function reset() {
    intentsByKey.clear();
    operationsByKey.clear();
    queuesByScope.clear();
    writeStateChanged();
  }

  function subscribe(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function request(intent, operations = {}) {
    if (!intent?.key || !intent?.scope || typeof operations.run !== "function") {
      throw new Error(`${label} write intents require a key, scope, and run callback.`);
    }

    const previous = intentsByKey.get(intent.key);
    const nextIntent = {
      ...intent,
      value: cloneWriteIntentValue(intent.value),
      previousValue: cloneWriteIntentValue(intent.previousValue),
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

  function getIntent(key) {
    return intentsByKey.get(key) ?? null;
  }

  function getState(key) {
    return intentsByKey.get(key)?.status ?? "idle";
  }

  function isActive(key) {
    return ACTIVE_WRITE_STATUSES.has(getState(key));
  }

  function scopeIsActive(scope) {
    const queue = queuesByScope.get(scope);
    if (queue?.running || (queue?.items?.length ?? 0) > 0) {
      return true;
    }
    for (const intent of intentsByKey.values()) {
      if (intent.scope === scope && ACTIVE_WRITE_STATUSES.has(intent.status)) {
        return true;
      }
    }
    return false;
  }

  function anyActive(predicate = null) {
    for (const intent of intentsByKey.values()) {
      if (
        ACTIVE_WRITE_STATUSES.has(intent.status)
        && (typeof predicate !== "function" || predicate(intent))
      ) {
        return true;
      }
    }
    return false;
  }

  function getIntents() {
    return Array.from(intentsByKey.values());
  }

  function clearIntentsWhere(predicate) {
    if (typeof predicate !== "function") {
      return false;
    }
    let changed = false;
    for (const [key, intent] of intentsByKey.entries()) {
      if (predicate(intent, key)) {
        intentsByKey.delete(key);
        operationsByKey.delete(key);
        changed = true;
      }
    }
    if (changed) {
      writeStateChanged();
    }
    return changed;
  }

  return {
    anyActive,
    clearIntentsWhere,
    getIntent,
    getIntents,
    getState,
    isActive,
    request,
    reset,
    scopeIsActive,
    subscribe,
  };
}
