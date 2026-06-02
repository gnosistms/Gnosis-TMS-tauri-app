import {
  enqueueRepoWrite,
  publishRepoInvalidation,
} from "./repo-write-queue.js";

const ACTIVE_EDITOR_OPERATION_STATUSES = new Set(["queued", "running"]);

let nextEditorOperationId = 1;

function nowIso() {
  return new Date().toISOString();
}

function cloneEditorOperationValue(value) {
  if (value == null) {
    return value;
  }
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function permissionDeniedError(result) {
  const message = typeof result?.message === "string" && result.message.trim()
    ? result.message.trim()
    : "Editor write permission denied.";
  const error = new Error(message);
  error.code = "EDITOR_OPERATION_PERMISSION_DENIED";
  error.isEditorOperationPermissionDenied = true;
  return error;
}

function snapshotEditorOperation(operation) {
  return {
    operationId: operation.operationId,
    repoScope: operation.repoScope,
    chapterScope: operation.chapterScope,
    rowScope: operation.rowScope,
    coalesceKey: operation.coalesceKey,
    kind: operation.kind,
    status: operation.status,
    value: cloneEditorOperationValue(operation.value),
    metadata: cloneEditorOperationValue(operation.metadata),
    queuedAt: operation.queuedAt,
    startedAt: operation.startedAt,
    finishedAt: operation.finishedAt,
    error: operation.error,
    supersededBy: operation.supersededBy,
    stale: operation.stale === true,
  };
}

function normalizePermissionResult(result) {
  if (result === false || result?.allowed === false) {
    throw permissionDeniedError(result);
  }
}

async function runPermissionCheck(operation, handlers, defaultCheckPermission) {
  const checker = typeof handlers.checkPermission === "function"
    ? handlers.checkPermission
    : defaultCheckPermission;
  if (typeof checker !== "function") {
    return;
  }
  normalizePermissionResult(await checker(snapshotEditorOperation(operation)));
}

function repoOperationIdFor(operation) {
  return `editor:${operation.operationId}`;
}

export function createEditorOperationQueue(options = {}) {
  const enqueueRepoWriteFn = typeof options.enqueueRepoWrite === "function"
    ? options.enqueueRepoWrite
    : enqueueRepoWrite;
  const defaultCheckPermission = typeof options.checkPermission === "function"
    ? options.checkPermission
    : null;
  const publishInvalidation = typeof options.publishInvalidation === "function"
    ? options.publishInvalidation
    : publishRepoInvalidation;

  const operationsById = new Map();
  const latestByCoalesceKey = new Map();
  const promisesById = new Map();
  const listeners = new Set();

  function emitChanged() {
    const snapshot = getSnapshot();
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {}
    }
  }

  function isLatestCoalescedOperation(operation) {
    return !operation.coalesceKey || latestByCoalesceKey.get(operation.coalesceKey) === operation.operationId;
  }

  function markQueuedOperationCancelled(previousOperation, cancelledBy) {
    previousOperation.status = "cancelled";
    previousOperation.supersededBy = cancelledBy;
    previousOperation.finishedAt = nowIso();
    previousOperation.error = "";
    previousOperation.handlers?.onCancel?.(snapshotEditorOperation(previousOperation));
  }

  function handlePreviousCoalescedOperation(coalesceKey, nextOperationId) {
    if (!coalesceKey) {
      return null;
    }

    const previousOperationId = latestByCoalesceKey.get(coalesceKey);
    if (!previousOperationId) {
      return null;
    }

    const previousOperation = operationsById.get(previousOperationId);
    if (!previousOperation) {
      return null;
    }

    if (previousOperation.status === "queued") {
      markQueuedOperationCancelled(previousOperation, nextOperationId);
    } else if (previousOperation.status === "running") {
      previousOperation.supersededBy = nextOperationId;
      previousOperation.stale = true;
    }
    return snapshotEditorOperation(previousOperation);
  }

  async function runEditorOperation(operationId) {
    const operation = operationsById.get(operationId);
    if (!operation || operation.status === "cancelled") {
      return { skipped: true };
    }

    operation.status = "running";
    operation.startedAt = nowIso();
    operation.error = "";
    operation.handlers?.onStatusChange?.(snapshotEditorOperation(operation));
    emitChanged();

    try {
      await runPermissionCheck(operation, operation.handlers, defaultCheckPermission);
      const result = await operation.handlers.run(snapshotEditorOperation(operation));
      operation.finishedAt = nowIso();

      if (!isLatestCoalescedOperation(operation)) {
        operation.status = "succeeded";
        operation.stale = true;
        operation.handlers?.onStaleSuccess?.(result, snapshotEditorOperation(operation));
        operation.handlers?.onStatusChange?.(snapshotEditorOperation(operation));
        emitChanged();
        return result;
      }

      operation.status = "succeeded";
      operation.error = "";
      operation.handlers?.onSuccess?.(result, snapshotEditorOperation(operation));
      if (Array.isArray(operation.invalidationKeys) && operation.invalidationKeys.length > 0) {
        publishInvalidation({
          keys: operation.invalidationKeys,
          repoScope: operation.repoScope,
          operationId: operation.operationId,
          sourceScreen: "editor",
          metadata: operation.metadata,
        });
      }
      operation.handlers?.onStatusChange?.(snapshotEditorOperation(operation));
      emitChanged();
      return result;
    } catch (error) {
      operation.finishedAt = nowIso();
      operation.error = error?.message ?? String(error);

      if (!isLatestCoalescedOperation(operation)) {
        operation.status = "cancelled";
        operation.stale = true;
        operation.handlers?.onStaleError?.(error, snapshotEditorOperation(operation));
        operation.handlers?.onStatusChange?.(snapshotEditorOperation(operation));
        emitChanged();
        return { staleError: true };
      }

      operation.status = "failed";
      operation.handlers?.onError?.(error, snapshotEditorOperation(operation));
      operation.handlers?.onStatusChange?.(snapshotEditorOperation(operation));
      emitChanged();
      throw error;
    }
  }

  function requestOperation(intent = {}, handlers = {}) {
    if (!normalizeString(intent.repoScope)) {
      throw new Error("Editor operations require a repoScope.");
    }
    if (typeof handlers.run !== "function") {
      throw new Error("Editor operations require a run callback.");
    }

    const operationId = normalizeString(intent.operationId) || `editor-operation-${nextEditorOperationId++}`;
    const coalesceKey = normalizeString(intent.coalesceKey);
    const previousOperation = handlePreviousCoalescedOperation(coalesceKey, operationId);
    const operation = {
      operationId,
      repoScope: normalizeString(intent.repoScope),
      chapterScope: normalizeString(intent.chapterScope),
      rowScope: normalizeString(intent.rowScope),
      coalesceKey,
      kind: normalizeString(intent.kind) || "editorOperation",
      status: "queued",
      value: cloneEditorOperationValue(intent.value ?? null),
      metadata: cloneEditorOperationValue(intent.metadata ?? null),
      invalidationKeys: Array.isArray(intent.invalidationKeys)
        ? intent.invalidationKeys.map(normalizeString).filter(Boolean)
        : [],
      queuedAt: nowIso(),
      startedAt: null,
      finishedAt: null,
      error: "",
      supersededBy: "",
      stale: false,
      handlers,
    };

    operationsById.set(operation.operationId, operation);
    if (coalesceKey) {
      latestByCoalesceKey.set(coalesceKey, operation.operationId);
    }

    handlers.applyOptimistic?.(snapshotEditorOperation(operation), previousOperation);
    handlers.onStatusChange?.(snapshotEditorOperation(operation));
    emitChanged();

    const promise = enqueueRepoWriteFn({
      scope: operation.repoScope,
      operationId: repoOperationIdFor(operation),
      kind: `editor:${operation.kind}`,
      sourceScreen: "editor",
      metadata: {
        editorOperationId: operation.operationId,
        chapterScope: operation.chapterScope,
        rowScope: operation.rowScope,
        coalesceKey: operation.coalesceKey,
        ...cloneEditorOperationValue(operation.metadata ?? {}),
      },
      errorTarget: {
        repoScope: operation.repoScope,
        operationId: operation.operationId,
      },
      run: async () => runEditorOperation(operation.operationId),
    });
    promise.catch(() => {});
    promisesById.set(operation.operationId, promise);

    return {
      ...snapshotEditorOperation(operation),
      promise,
    };
  }

  function getOperation(operationId) {
    const operation = operationsById.get(operationId);
    return operation ? snapshotEditorOperation(operation) : null;
  }

  function getSnapshot(filter = {}) {
    const repoScope = normalizeString(filter.repoScope);
    const operations = Array.from(operationsById.values())
      .filter((operation) => !repoScope || operation.repoScope === repoScope)
      .map(snapshotEditorOperation);
    const queuedCount = operations.filter((operation) => operation.status === "queued").length;
    const runningCount = operations.filter((operation) => operation.status === "running").length;

    return {
      queuedCount,
      runningCount,
      activeCount: queuedCount + runningCount,
      hasActiveOperations: queuedCount + runningCount > 0,
      operations,
    };
  }

  function operationIsActive(operationId) {
    const operation = operationsById.get(operationId);
    return operation ? ACTIVE_EDITOR_OPERATION_STATUSES.has(operation.status) : false;
  }

  function anyActive(predicate = null) {
    for (const operation of operationsById.values()) {
      if (
        ACTIVE_EDITOR_OPERATION_STATUSES.has(operation.status)
        && (typeof predicate !== "function" || predicate(snapshotEditorOperation(operation)))
      ) {
        return true;
      }
    }
    return false;
  }

  function waitForIdle(predicate = null) {
    if (!anyActive(predicate)) {
      return Promise.resolve(getSnapshot());
    }

    return new Promise((resolve) => {
      const unsubscribe = subscribe(() => {
        if (!anyActive(predicate)) {
          unsubscribe();
          resolve(getSnapshot());
        }
      });
    });
  }

  function subscribe(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function clearOperationsWhere(predicate) {
    if (typeof predicate !== "function") {
      return false;
    }

    let changed = false;
    for (const [operationId, operation] of operationsById.entries()) {
      if (predicate(snapshotEditorOperation(operation))) {
        operationsById.delete(operationId);
        promisesById.delete(operationId);
        changed = true;
      }
    }
    if (changed) {
      emitChanged();
    }
    return changed;
  }

  function reset() {
    operationsById.clear();
    latestByCoalesceKey.clear();
    promisesById.clear();
    emitChanged();
  }

  return {
    anyActive,
    clearOperationsWhere,
    getOperation,
    getSnapshot,
    operationIsActive,
    requestOperation,
    reset,
    subscribe,
    waitForIdle,
  };
}

const defaultEditorOperationQueue = createEditorOperationQueue();

export function requestEditorOperation(intent = {}, handlers = {}) {
  return defaultEditorOperationQueue.requestOperation(intent, handlers);
}

export function getEditorOperation(operationId) {
  return defaultEditorOperationQueue.getOperation(operationId);
}

export function getEditorOperationQueueSnapshot(filter = {}) {
  return defaultEditorOperationQueue.getSnapshot(filter);
}

export function editorOperationIsActive(operationId) {
  return defaultEditorOperationQueue.operationIsActive(operationId);
}

export function anyEditorOperationIsActive(predicate = null) {
  return defaultEditorOperationQueue.anyActive(predicate);
}

export function waitForEditorOperationQueueIdle(predicate = null) {
  return defaultEditorOperationQueue.waitForIdle(predicate);
}

export function subscribeEditorOperationQueue(listener) {
  return defaultEditorOperationQueue.subscribe(listener);
}

export function clearEditorOperationsWhere(predicate) {
  return defaultEditorOperationQueue.clearOperationsWhere(predicate);
}

export function resetEditorOperationQueue() {
  defaultEditorOperationQueue.reset();
}
