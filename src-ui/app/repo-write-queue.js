import { reportBackendNonfatalError } from "./telemetry.js";

const ACTIVE_REPO_WRITE_STATUSES = new Set(["queued", "running"]);
const LOCAL_REPO_WRITE_OPERATION_TYPES = new Set(["localEditorWrite", "localMetadataWrite"]);
const REMOTE_REPO_WRITE_OPERATION_TYPES = new Set(["remoteSync"]);
const OVERDUE_THRESHOLDS_MS = {
  localEditorWrite: 15_000,
  localMetadataWrite: 15_000,
  remoteSync: 120_000,
  repoMaintenance: 120_000,
};
const DEFAULT_OVERDUE_THRESHOLD_MS = 60_000;

let nextRepoWriteOperationId = 1;
let nextRepoQueueErrorId = 1;
let nextRepoInvalidationId = 1;
let nowMsClock = () => Date.now();
let scheduleOverdueCheck = (callback, delayMs) => setTimeout(callback, delayMs);
let cancelOverdueCheck = (handle) => clearTimeout(handle);
let reportRepoWriteOverdue = (payload) => reportBackendNonfatalError(payload);

const DEBUG_REPO_WRITE = false;

const queuesByScope = new Map();
const operationsById = new Map();
const queueListeners = new Set();
const repoQueueErrors = [];
const repoInvalidations = [];
const invalidationListeners = new Set();

function nowIso() {
  return new Date().toISOString();
}

function thresholdFor(operationType) {
  return OVERDUE_THRESHOLDS_MS[operationType] ?? DEFAULT_OVERDUE_THRESHOLD_MS;
}

function parseIsoMs(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function activeOperationStartMs(operation) {
  if (operation.status === "running") {
    return parseIsoMs(operation.startedAt) ?? parseIsoMs(operation.queuedAt);
  }
  if (operation.status === "queued") {
    return parseIsoMs(operation.queuedAt);
  }
  return null;
}

function activeOperationElapsedMs(operation) {
  const startedMs = activeOperationStartMs(operation);
  if (!Number.isFinite(startedMs)) {
    return 0;
  }
  return Math.max(0, nowMsClock() - startedMs);
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

function logRepoWriteDiagnostic(event, operation, details = {}) {
  if (!DEBUG_REPO_WRITE) {
    return;
  }
  if (typeof console === "undefined" || typeof console.info !== "function") {
    return;
  }
  console.info("[gtms repo-write]", event, {
    operationId: operation?.operationId ?? "",
    kind: operation?.kind ?? "",
    operationType: operation?.operationType ?? "",
    priority: operation?.priority ?? "",
    scope: operation?.scope ?? "",
    queuedAt: operation?.queuedAt ?? null,
    startedAt: operation?.startedAt ?? null,
    ...details,
  });
}

function normalizePriority(value) {
  const normalized = normalizeString(value);
  if (normalized === "blockingLocal" || normalized === "durableLocal") {
    return normalized;
  }
  return "normal";
}

function normalizeOperationType(value, kind = "") {
  const normalized = normalizeString(value);
  if (
    normalized === "localEditorWrite"
    || normalized === "localMetadataWrite"
    || normalized === "remoteSync"
    || normalized === "repoMaintenance"
  ) {
    return normalized;
  }

  const normalizedKind = normalizeString(kind);
  if (normalizedKind.startsWith("editor:")) {
    return "localEditorWrite";
  }
  if (normalizedKind === "editorBackgroundSync" || normalizedKind.endsWith("BackgroundSync")) {
    return "remoteSync";
  }
  return "repoMaintenance";
}

function priorityRank(priority) {
  if (priority === "blockingLocal") {
    return 2;
  }
  return priority === "durableLocal" ? 1 : 0;
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
  const elapsedMs = activeOperationElapsedMs(operation);
  const overdue =
    ACTIVE_REPO_WRITE_STATUSES.has(operation.status)
    && (operation.overdueReported === true || elapsedMs >= thresholdFor(operation.operationType));
  return {
    operationId: operation.operationId,
    scope: operation.scope,
    kind: operation.kind,
    operationType: operation.operationType,
    label: operation.label,
    priority: operation.priority,
    status: operation.status,
    metadata: cloneQueueValue(operation.metadata),
    queuedAt: operation.queuedAt,
    startedAt: operation.startedAt,
    finishedAt: operation.finishedAt,
    error: operation.error,
    elapsedMs,
    overdue,
  };
}

function oldestActiveOperation(operations) {
  let oldest = null;
  let oldestStart = Infinity;
  for (const operation of operations) {
    if (!ACTIVE_REPO_WRITE_STATUSES.has(operation.status)) {
      continue;
    }
    const startMs = activeOperationStartMs(operation);
    if (!Number.isFinite(startMs) || startMs >= oldestStart) {
      continue;
    }
    oldest = operation;
    oldestStart = startMs;
  }
  return oldest ? snapshotOperation(oldest) : null;
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
  const activeLocalOperations = operations.filter((operation) =>
    ACTIVE_REPO_WRITE_STATUSES.has(operation.status)
    && LOCAL_REPO_WRITE_OPERATION_TYPES.has(operation.operationType),
  );
  const activeRemoteOperations = operations.filter((operation) =>
    ACTIVE_REPO_WRITE_STATUSES.has(operation.status)
    && REMOTE_REPO_WRITE_OPERATION_TYPES.has(operation.operationType),
  );
  const snapshotOperations = operations.map(snapshotOperation);

  return {
    scope: queue.scope,
    queuedCount: queuedOperations.length,
    runningCount: runningOperations.length,
    activeCount: queuedOperations.length + runningOperations.length,
    runningOperationId: runningOperations[0]?.operationId ?? null,
    queuedOperationIds: queuedOperations.map((operation) => operation.operationId),
    hasActiveWrites: operations.some((operation) => ACTIVE_REPO_WRITE_STATUSES.has(operation.status)),
    hasActiveLocalWrites: activeLocalOperations.length > 0,
    hasActiveRemoteSync: activeRemoteOperations.length > 0,
    hasRunningRemoteSync: activeRemoteOperations.some((operation) => operation.status === "running"),
    hasOverdueWrites: snapshotOperations.some((operation) => operation.overdue),
    oldestActiveOperation: oldestActiveOperation(operations),
    operations: snapshotOperations,
  };
}

function cleanupCompletedOperation(operation) {
  clearOperationOverdueTimer(operation);
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

function clearOperationOverdueTimer(operation) {
  if (!operation?.overdueTimer) {
    return;
  }
  cancelOverdueCheck(operation.overdueTimer);
  operation.overdueTimer = null;
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
      operation.overdueTimer = scheduleOverdueCheck(() => {
        if (operation.status !== "running" || operation.overdueReported === true) {
          return;
        }
        operation.overdueReported = true;
        reportRepoWriteOverdue({
          operation: "repo_write_overdue",
          reason: operation.operationType || operation.kind,
        });
        emitQueueChanged();
      }, thresholdFor(operation.operationType));
      logRepoWriteDiagnostic("running", operation, { queuedCount: queue.items.length });
      emitQueueChanged();

      try {
        const permissionCheck = runPermissionCheck(operation);
        if (permissionCheck) {
          await permissionCheck;
        }
        const result = await operation.run(snapshotOperation(operation));
        operation.status = "succeeded";
        operation.finishedAt = nowIso();
        logRepoWriteDiagnostic("succeeded", operation, { finishedAt: operation.finishedAt });
        operation.resolve(result);
      } catch (error) {
        operation.status = "failed";
        operation.finishedAt = nowIso();
        operation.error = error?.message ?? String(error);
        logRepoWriteDiagnostic("failed", operation, {
          finishedAt: operation.finishedAt,
          error: operation.error,
        });
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
        clearOperationOverdueTimer(operation);
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
  const kind = normalizeString(options.kind) || "repoWrite";
  const operationType = normalizeOperationType(options.operationType, kind);
  const operation = {
    operationId,
    scope,
    kind,
    operationType,
    label: normalizeString(options.label),
    priority: operationType === "localEditorWrite"
      ? "durableLocal"
      : normalizePriority(options.priority),
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
    overdueReported: false,
    overdueTimer: null,
  };

  const promise = new Promise((resolve, reject) => {
    operation.resolve = resolve;
    operation.reject = reject;
  });

  operationsById.set(operation.operationId, operation);
  const queue = queueForScope(scope);
  const insertIndex = queue.items.findIndex((queuedOperationId) => {
    const queuedOperation = operationsById.get(queuedOperationId);
    return priorityRank(queuedOperation?.priority) < priorityRank(operation.priority);
  });
  if (insertIndex === -1) {
    queue.items.push(operation.operationId);
  } else {
    queue.items.splice(insertIndex, 0, operation.operationId);
  }
  logRepoWriteDiagnostic("queued", operation, {
    queuedCount: queue.items.length,
    insertedAt: insertIndex === -1 ? queue.items.length - 1 : insertIndex,
  });
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
  const activeLocalWrites = operations.filter((operation) =>
    ACTIVE_REPO_WRITE_STATUSES.has(operation.status)
    && LOCAL_REPO_WRITE_OPERATION_TYPES.has(operation.operationType),
  );
  const activeRemoteSync = operations.filter((operation) =>
    ACTIVE_REPO_WRITE_STATUSES.has(operation.status)
    && REMOTE_REPO_WRITE_OPERATION_TYPES.has(operation.operationType),
  );
  const oldestOperation = oldestActiveOperation(
    queues.flatMap((queue) => [
      ...queue.operations,
    ]),
  );

  return {
    queuedCount,
    runningCount,
    activeCount: queuedCount + runningCount,
    hasActiveWrites: queuedCount + runningCount > 0,
    hasActiveLocalWrites: activeLocalWrites.length > 0,
    hasActiveRemoteSync: activeRemoteSync.length > 0,
    hasRunningRemoteSync: activeRemoteSync.some((operation) => operation.status === "running"),
    hasOverdueWrites: operations.some((operation) => operation.overdue),
    oldestActiveOperation: oldestOperation,
    scopes: queues,
    operations,
  };
}

export function __setRepoWriteQueueClock(fn) {
  nowMsClock = typeof fn === "function" ? fn : (() => Date.now());
}

export function __setRepoWriteOverdueScheduler(schedule, cancel) {
  scheduleOverdueCheck = typeof schedule === "function"
    ? schedule
    : ((callback, delayMs) => setTimeout(callback, delayMs));
  cancelOverdueCheck = typeof cancel === "function"
    ? cancel
    : ((handle) => clearTimeout(handle));
}

export function __setRepoWriteOverdueReporter(reporter) {
  reportRepoWriteOverdue = typeof reporter === "function"
    ? reporter
    : ((payload) => reportBackendNonfatalError(payload));
}

export function repoWriteQueueHasActiveWrites(scope = null) {
  return getRepoWriteQueueSnapshot(scope).hasActiveWrites;
}

export function repoWriteQueueHasActiveLocalWrites(scope = null) {
  return getRepoWriteQueueSnapshot(scope).hasActiveLocalWrites;
}

export function repoWriteQueueHasRunningRemoteSync(scope = null) {
  return getRepoWriteQueueSnapshot(scope).hasRunningRemoteSync;
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
  for (const operation of operationsById.values()) {
    clearOperationOverdueTimer(operation);
  }
  queuesByScope.clear();
  operationsById.clear();
  repoQueueErrors.splice(0, repoQueueErrors.length);
  repoInvalidations.splice(0, repoInvalidations.length);
  nextRepoWriteOperationId = 1;
  nextRepoQueueErrorId = 1;
  nextRepoInvalidationId = 1;
  nowMsClock = () => Date.now();
  scheduleOverdueCheck = (callback, delayMs) => setTimeout(callback, delayMs);
  cancelOverdueCheck = (handle) => clearTimeout(handle);
  reportRepoWriteOverdue = (payload) => reportBackendNonfatalError(payload);
  emitQueueChanged();
}
