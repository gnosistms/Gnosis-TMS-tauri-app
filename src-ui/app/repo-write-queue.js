const ACTIVE_REPO_WRITE_STATUSES = new Set(["queued", "running"]);

let nextRepoWriteOperationId = 1;
let nextRepoQueueErrorId = 1;
let nextRepoInvalidationId = 1;

const queuesByScope = new Map();
const operationsById = new Map();
const queueListeners = new Set();
const repoQueueErrors = [];
const repoInvalidations = [];
const invalidationListeners = new Set();

function nowIso() {
  return new Date().toISOString();
}

function cloneQueueValue(value) {
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

function normalizePart(value) {
  if (Number.isFinite(value)) {
    return String(value);
  }
  return normalizeString(value);
}

function teamInstallationId(team) {
  return Number.isFinite(team?.installationId)
    ? String(team.installationId)
    : normalizePart(team?.installationId ?? team?.installation_id);
}

function projectIdentifier(project) {
  return normalizePart(project?.id ?? project?.projectId ?? project?.project_id);
}

function projectRepositoryName(project) {
  return normalizeString(
    project?.repoName
      ?? project?.repositoryName
      ?? project?.repository
      ?? project?.name,
  );
}

function queueForScope(scope) {
  let queue = queuesByScope.get(scope);
  if (!queue) {
    queue = {
      scope,
      items: [],
      runningOperationId: null,
      processing: false,
    };
    queuesByScope.set(scope, queue);
  }
  return queue;
}

function emitQueueChanged() {
  for (const listener of queueListeners) {
    try {
      listener(getRepoWriteQueueSnapshot());
    } catch {}
  }
}

function emitInvalidationsChanged(invalidation) {
  for (const listener of invalidationListeners) {
    try {
      listener(invalidation);
    } catch {}
  }
}

function normalizeRepoScope(scope) {
  if (typeof scope === "string" && scope.trim()) {
    return scope.trim();
  }
  if (scope && typeof scope === "object" && typeof scope.scope === "string" && scope.scope.trim()) {
    return scope.scope.trim();
  }
  throw new Error("Repo write queue operations require a non-empty repo scope.");
}

function snapshotOperation(operation) {
  return {
    operationId: operation.operationId,
    scope: operation.scope,
    kind: operation.kind,
    label: operation.label,
    status: operation.status,
    metadata: cloneQueueValue(operation.metadata),
    queuedAt: operation.queuedAt,
    startedAt: operation.startedAt,
    finishedAt: operation.finishedAt,
    error: operation.error,
  };
}

function snapshotQueue(queue) {
  const operations = [
    ...queue.items.map((operationId) => operationsById.get(operationId)).filter(Boolean),
  ];
  if (queue.runningOperationId) {
    const running = operationsById.get(queue.runningOperationId);
    if (running) {
      operations.unshift(running);
    }
  }

  const queuedOperations = operations.filter((operation) => operation.status === "queued");
  const runningOperations = operations.filter((operation) => operation.status === "running");

  return {
    scope: queue.scope,
    queuedCount: queuedOperations.length,
    runningCount: runningOperations.length,
    activeCount: queuedOperations.length + runningOperations.length,
    runningOperationId: runningOperations[0]?.operationId ?? null,
    queuedOperationIds: queuedOperations.map((operation) => operation.operationId),
    hasActiveWrites: operations.some((operation) => ACTIVE_REPO_WRITE_STATUSES.has(operation.status)),
    operations: operations.map(snapshotOperation),
  };
}

function cleanupCompletedOperation(operation) {
  if (ACTIVE_REPO_WRITE_STATUSES.has(operation.status)) {
    return;
  }

  operationsById.delete(operation.operationId);
  const queue = queuesByScope.get(operation.scope);
  if (!queue) {
    return;
  }
  queue.items = queue.items.filter((operationId) => operationId !== operation.operationId);
  if (!queue.processing && !queue.runningOperationId && queue.items.length === 0) {
    queuesByScope.delete(operation.scope);
  }
}

function permissionDeniedError(result) {
  const message = typeof result?.message === "string" && result.message.trim()
    ? result.message.trim()
    : "Repo write permission denied.";
  const error = new Error(message);
  error.code = "REPO_WRITE_PERMISSION_DENIED";
  error.isRepoWritePermissionDenied = true;
  return error;
}

function runPermissionCheck(operation) {
  if (typeof operation.checkPermission !== "function") {
    return null;
  }
  return Promise.resolve(operation.checkPermission(snapshotOperation(operation))).then((result) => {
    if (result === false || result?.allowed === false) {
      throw permissionDeniedError(result);
    }
  });
}

function normalizeQueueError(details = {}) {
  const sourceError = details.error;
  return {
    id: details.id ?? `repo-queue-error-${nextRepoQueueErrorId++}`,
    repoScope: normalizeString(details.repoScope ?? details.scope),
    projectId: normalizePart(details.projectId),
    chapterId: normalizePart(details.chapterId),
    rowId: normalizePart(details.rowId),
    operationId: normalizeString(details.operationId),
    kind: normalizeString(details.kind),
    message:
      normalizeString(details.message)
      || normalizeString(sourceError?.message)
      || String(sourceError ?? "Repo write failed."),
    sourceScreen: normalizeString(details.sourceScreen),
    createdAt: normalizeString(details.createdAt) || nowIso(),
    metadata: cloneQueueValue(details.metadata ?? null),
  };
}

async function processScopeQueue(queue) {
  if (queue.processing) {
    return;
  }

  queue.processing = true;
  emitQueueChanged();

  try {
    while (queue.items.length > 0) {
      const operationId = queue.items.shift();
      const operation = operationsById.get(operationId);
      if (!operation || operation.status !== "queued") {
        continue;
      }

      queue.runningOperationId = operationId;
      operation.status = "running";
      operation.startedAt = nowIso();
      operation.error = "";
      emitQueueChanged();

      try {
        const permissionCheck = runPermissionCheck(operation);
        if (permissionCheck) {
          await permissionCheck;
        }
        const result = await operation.run(snapshotOperation(operation));
        operation.status = "succeeded";
        operation.finishedAt = nowIso();
        operation.resolve(result);
      } catch (error) {
        operation.status = "failed";
        operation.finishedAt = nowIso();
        operation.error = error?.message ?? String(error);
        if (operation.recordFailure !== false) {
          recordRepoQueueError({
            ...(operation.errorTarget ?? {}),
            repoScope: operation.scope,
            operationId: operation.operationId,
            kind: operation.kind,
            message: operation.error,
            error,
            sourceScreen: operation.sourceScreen,
            metadata: operation.metadata,
          });
        }
        operation.reject(error);
      } finally {
        queue.runningOperationId = null;
        emitQueueChanged();
        cleanupCompletedOperation(operation);
        emitQueueChanged();
      }
    }
  } finally {
    queue.processing = false;
    if (!queue.runningOperationId && queue.items.length === 0) {
      queuesByScope.delete(queue.scope);
    }
    emitQueueChanged();
  }
}

export function resolveProjectRepoScope(input = {}, options = {}) {
  if (options?.metadataOnly === true || input?.metadataOnly === true) {
    return {
      scope: null,
      kind: "metadata-only",
      installationId: null,
      projectId: null,
      repoName: "",
      reason: "metadataOnly",
    };
  }

  const team = input?.team ?? null;
  const project = input?.project ?? null;
  const installationId = normalizePart(input?.installationId) || teamInstallationId(team);
  const projectId = normalizePart(input?.projectId) || projectIdentifier(project);
  const repoName = normalizeString(input?.repoName) || projectRepositoryName(project);
  const teamId = normalizePart(input?.teamId) || normalizePart(team?.id);

  if (installationId && projectId && repoName) {
    return {
      scope: `${installationId}:${projectId}:${repoName}`,
      kind: "project-repo",
      installationId,
      projectId,
      repoName,
      reason: "",
    };
  }

  if (installationId && projectId) {
    return {
      scope: `${installationId}:${projectId}`,
      kind: "project-id",
      installationId,
      projectId,
      repoName,
      reason: "missingRepoName",
    };
  }

  if (installationId && repoName) {
    return {
      scope: `${installationId}:${repoName}`,
      kind: "repo-name",
      installationId,
      projectId: null,
      repoName,
      reason: "missingProjectId",
    };
  }

  if (installationId) {
    return {
      scope: `${installationId}:projects`,
      kind: "team-projects",
      installationId,
      projectId: null,
      repoName: "",
      reason: "teamFallback",
    };
  }

  if (teamId) {
    return {
      scope: `team:${teamId}:projects`,
      kind: "team-projects",
      installationId: null,
      projectId: null,
      repoName: "",
      reason: "missingInstallationId",
    };
  }

  return {
    scope: null,
    kind: "unscoped",
    installationId: null,
    projectId,
    repoName,
    reason: "missingTeamOrInstallation",
  };
}

export function projectRepoScope(input = {}, options = {}) {
  return resolveProjectRepoScope(input, options).scope;
}

export function enqueueRepoWrite(options = {}) {
  const scope = normalizeRepoScope(options.scope ?? options.repoScope);
  if (typeof options.run !== "function") {
    throw new Error("Repo write queue operations require a run callback.");
  }

  const operationId = normalizeString(options.operationId) || `repo-write-${nextRepoWriteOperationId++}`;
  const operation = {
    operationId,
    scope,
    kind: normalizeString(options.kind) || "repoWrite",
    label: normalizeString(options.label),
    status: "queued",
    metadata: cloneQueueValue(options.metadata ?? null),
    queuedAt: nowIso(),
    startedAt: null,
    finishedAt: null,
    error: "",
    sourceScreen: normalizeString(options.sourceScreen),
    errorTarget: cloneQueueValue(options.errorTarget ?? null),
    recordFailure: options.recordFailure !== false,
    run: options.run,
    checkPermission: options.checkPermission,
    resolve: null,
    reject: null,
  };

  const promise = new Promise((resolve, reject) => {
    operation.resolve = resolve;
    operation.reject = reject;
  });

  operationsById.set(operation.operationId, operation);
  const queue = queueForScope(scope);
  queue.items.push(operation.operationId);
  emitQueueChanged();
  void processScopeQueue(queue);
  return promise;
}

export function getRepoWriteQueueSnapshot(scope = null) {
  const normalizedScope = scope == null ? null : normalizeRepoScope(scope);
  const queues = Array.from(queuesByScope.values())
    .filter((queue) => normalizedScope == null || queue.scope === normalizedScope)
    .map(snapshotQueue)
    .filter((queue) => queue.activeCount > 0);
  const operations = queues.flatMap((queue) => queue.operations);
  const queuedCount = operations.filter((operation) => operation.status === "queued").length;
  const runningCount = operations.filter((operation) => operation.status === "running").length;

  return {
    queuedCount,
    runningCount,
    activeCount: queuedCount + runningCount,
    hasActiveWrites: queuedCount + runningCount > 0,
    scopes: queues,
    operations,
  };
}

export function repoWriteQueueHasActiveWrites(scope = null) {
  return getRepoWriteQueueSnapshot(scope).hasActiveWrites;
}

export function subscribeRepoWriteQueue(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }
  queueListeners.add(listener);
  return () => queueListeners.delete(listener);
}

export function waitForRepoWriteQueueIdle(scope = null) {
  if (!repoWriteQueueHasActiveWrites(scope)) {
    return Promise.resolve(getRepoWriteQueueSnapshot(scope));
  }

  return new Promise((resolve) => {
    const unsubscribe = subscribeRepoWriteQueue(() => {
      if (!repoWriteQueueHasActiveWrites(scope)) {
        unsubscribe();
        resolve(getRepoWriteQueueSnapshot(scope));
      }
    });
  });
}

export function flushRepoWriteQueue(scope = null) {
  return waitForRepoWriteQueueIdle(scope);
}

export function recordRepoQueueError(details = {}) {
  const error = normalizeQueueError(details);
  repoQueueErrors.push(error);
  emitQueueChanged();
  return error;
}

export function getRepoQueueErrors(predicate = null) {
  const errors = typeof predicate === "function"
    ? repoQueueErrors.filter(predicate)
    : repoQueueErrors;
  return errors.map(cloneQueueValue);
}

export function clearRepoQueueErrors(predicate = null) {
  if (typeof predicate !== "function") {
    const changed = repoQueueErrors.length > 0;
    repoQueueErrors.splice(0, repoQueueErrors.length);
    if (changed) {
      emitQueueChanged();
    }
    return changed;
  }

  let changed = false;
  for (let index = repoQueueErrors.length - 1; index >= 0; index -= 1) {
    if (predicate(repoQueueErrors[index])) {
      repoQueueErrors.splice(index, 1);
      changed = true;
    }
  }
  if (changed) {
    emitQueueChanged();
  }
  return changed;
}

export function publishRepoInvalidation(details = {}) {
  const rawKeys = Array.isArray(details.keys)
    ? details.keys
    : details.key
      ? [details.key]
      : [];
  const invalidation = {
    id: details.id ?? `repo-invalidation-${nextRepoInvalidationId++}`,
    keys: rawKeys.map(normalizeString).filter(Boolean),
    repoScope: normalizeString(details.repoScope ?? details.scope),
    sourceOperationId: normalizeString(details.sourceOperationId ?? details.operationId),
    sourceScreen: normalizeString(details.sourceScreen),
    createdAt: normalizeString(details.createdAt) || nowIso(),
    metadata: cloneQueueValue(details.metadata ?? null),
  };
  repoInvalidations.push(invalidation);
  emitInvalidationsChanged(cloneQueueValue(invalidation));
  return cloneQueueValue(invalidation);
}

export function getRepoInvalidations(predicate = null) {
  const invalidations = typeof predicate === "function"
    ? repoInvalidations.filter(predicate)
    : repoInvalidations;
  return invalidations.map(cloneQueueValue);
}

export function consumeRepoInvalidations(predicate = null) {
  const consumed = [];
  const shouldConsume = typeof predicate === "function" ? predicate : () => true;
  for (let index = repoInvalidations.length - 1; index >= 0; index -= 1) {
    if (shouldConsume(repoInvalidations[index])) {
      consumed.unshift(cloneQueueValue(repoInvalidations[index]));
      repoInvalidations.splice(index, 1);
    }
  }
  return consumed;
}

export function subscribeRepoInvalidations(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }
  invalidationListeners.add(listener);
  return () => invalidationListeners.delete(listener);
}

export function resetRepoWriteQueue() {
  queuesByScope.clear();
  operationsById.clear();
  repoQueueErrors.splice(0, repoQueueErrors.length);
  repoInvalidations.splice(0, repoInvalidations.length);
  nextRepoWriteOperationId = 1;
  nextRepoQueueErrorId = 1;
  nextRepoInvalidationId = 1;
  emitQueueChanged();
}
