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

function normalizeProjectSnapshot(snapshot) {
  const projectSnapshot = snapshot?.snapshot && typeof snapshot.snapshot === "object"
    ? snapshot.snapshot
    : snapshot;
  return {
    items: Array.isArray(projectSnapshot?.items) ? projectSnapshot.items : [],
    deletedItems: Array.isArray(projectSnapshot?.deletedItems) ? projectSnapshot.deletedItems : [],
  };
}

function writeStateChanged() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {}
  }
}

function queueForScope(scope) {
  const normalizedScope = typeof scope === "string" && scope.trim() ? scope.trim() : "project-writes:default";
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

export function resetProjectWriteCoordinator() {
  intentsByKey.clear();
  operationsByKey.clear();
  queuesByScope.clear();
  writeStateChanged();
}

export function subscribeProjectWriteState(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function projectTitleIntentKey(projectId) {
  return `project:title:${projectId}`;
}

export function projectLifecycleIntentKey(projectId) {
  return `project:lifecycle:${projectId}`;
}

export function chapterTitleIntentKey(projectId, chapterId) {
  return `chapter:title:${projectId}:${chapterId}`;
}

export function chapterLifecycleIntentKey(projectId, chapterId) {
  return `chapter:lifecycle:${projectId}:${chapterId}`;
}

export function chapterGlossaryIntentKey(projectId, chapterId) {
  return `chapter:glossary:${projectId}:${chapterId}`;
}

export function projectRepoSyncIntentKey(projectId) {
  return `project:repo-sync:${projectId}`;
}

export function teamMetadataWriteScope(team) {
  return `team-metadata:${team?.installationId ?? "unknown"}`;
}

export function projectRepoWriteScope(team, projectId) {
  return `project-repo:${team?.installationId ?? "unknown"}:${projectId ?? "unknown"}`;
}

export function requestProjectWriteIntent(intent, operations = {}) {
  if (!intent?.key || !intent?.scope || typeof operations.run !== "function") {
    throw new Error("Project write intents require a key, scope, and run callback.");
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

export function getProjectWriteIntent(key) {
  return intentsByKey.get(key) ?? null;
}

export function getProjectWriteState(key) {
  return intentsByKey.get(key)?.status ?? "idle";
}

export function projectWriteIsActive(key) {
  const status = getProjectWriteState(key);
  return status === "pending" || status === "running";
}

export function projectWriteScopeIsActive(scope) {
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

export function anyProjectWriteIsActive() {
  for (const intent of intentsByKey.values()) {
    if (intent.status === "pending" || intent.status === "running") {
      return true;
    }
  }
  return false;
}

function patchProject(snapshot, projectId, patch) {
  let changed = false;
  const patchOne = (project) => {
    if (project?.id !== projectId) {
      return project;
    }
    changed = true;
    return {
      ...project,
      ...patch,
    };
  };
  const items = snapshot.items.map(patchOne);
  const deletedItems = snapshot.deletedItems.map(patchOne);
  return changed ? { items, deletedItems } : snapshot;
}

function moveProject(snapshot, projectId, targetCollection, patch) {
  const allProjects = [...snapshot.items, ...snapshot.deletedItems];
  const project = allProjects.find((item) => item?.id === projectId);
  if (!project) {
    return snapshot;
  }
  const nextProject = {
    ...project,
    ...patch,
  };
  const items = snapshot.items.filter((item) => item?.id !== projectId);
  const deletedItems = snapshot.deletedItems.filter((item) => item?.id !== projectId);
  if (targetCollection === "deleted") {
    deletedItems.push(nextProject);
  } else {
    items.push(nextProject);
  }
  return { items, deletedItems };
}

function patchChapter(snapshot, projectId, chapterId, patch) {
  const patchProjectChapters = (project) => {
    if (project?.id !== projectId || !Array.isArray(project.chapters)) {
      return project;
    }
    let changed = false;
    const chapters = project.chapters.map((chapter) => {
      if (chapter?.id !== chapterId) {
        return chapter;
      }
      changed = true;
      return {
        ...chapter,
        ...patch,
      };
    });
    return changed ? { ...project, chapters } : project;
  };
  return {
    items: snapshot.items.map(patchProjectChapters),
    deletedItems: snapshot.deletedItems.map(patchProjectChapters),
  };
}

function glossaryLinksEqual(left, right) {
  const normalize = (value) => value
    ? {
        glossaryId: value.glossaryId ?? "",
        repoName: value.repoName ?? "",
      }
    : null;
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function intentMatchesSnapshot(intent, snapshot) {
  const projects = [...snapshot.items, ...snapshot.deletedItems];
  const project = projects.find((item) => item?.id === intent.projectId);
  if (!project) {
    return false;
  }

  if (intent.type === "projectTitle") {
    return project.title === intent.value?.title;
  }
  if (intent.type === "projectLifecycle") {
    const location = snapshot.deletedItems.some((item) => item?.id === intent.projectId)
      ? "deleted"
      : "active";
    return location === intent.value?.lifecycleState;
  }

  const chapter = Array.isArray(project.chapters)
    ? project.chapters.find((item) => item?.id === intent.chapterId)
    : null;
  if (!chapter) {
    return false;
  }
  if (intent.type === "chapterTitle") {
    return chapter.name === intent.value?.title;
  }
  if (intent.type === "chapterLifecycle") {
    return (chapter.status === "deleted" ? "deleted" : "active") === intent.value?.status;
  }
  if (intent.type === "chapterGlossary") {
    return glossaryLinksEqual(chapter.linkedGlossary, intent.value?.glossary ?? null);
  }
  return false;
}

export function applyProjectWriteIntentsToSnapshot(snapshot) {
  let nextSnapshot = normalizeProjectSnapshot(snapshot);

  for (const intent of intentsByKey.values()) {
    if (intent.status === "confirmed") {
      continue;
    }
    if (intent.type === "projectTitle") {
      nextSnapshot = patchProject(nextSnapshot, intent.projectId, {
        title: intent.value?.title,
        pendingMutation: "rename",
      });
      continue;
    }
    if (intent.type === "projectLifecycle") {
      nextSnapshot = moveProject(
        nextSnapshot,
        intent.projectId,
        intent.value?.lifecycleState === "deleted" ? "deleted" : "active",
        {
          lifecycleState: intent.value?.lifecycleState === "deleted" ? "deleted" : "active",
          pendingMutation: intent.value?.lifecycleState === "deleted" ? "softDelete" : "restore",
        },
      );
      continue;
    }
    if (intent.type === "chapterTitle") {
      nextSnapshot = patchChapter(nextSnapshot, intent.projectId, intent.chapterId, {
        name: intent.value?.title,
        pendingMutation: "rename",
      });
      continue;
    }
    if (intent.type === "chapterLifecycle") {
      nextSnapshot = patchChapter(nextSnapshot, intent.projectId, intent.chapterId, {
        status: intent.value?.status === "deleted" ? "deleted" : "active",
        pendingMutation: intent.value?.status === "deleted" ? "softDelete" : "restore",
      });
      continue;
    }
    if (intent.type === "chapterGlossary") {
      nextSnapshot = patchChapter(nextSnapshot, intent.projectId, intent.chapterId, {
        linkedGlossary: cloneValue(intent.value?.glossary ?? null),
        pendingGlossaryMutation: true,
      });
    }
  }

  return nextSnapshot;
}

export function clearConfirmedProjectWriteIntents(snapshot) {
  const normalizedSnapshot = normalizeProjectSnapshot(snapshot);
  let changed = false;
  for (const [key, intent] of intentsByKey.entries()) {
    if (intentMatchesSnapshot(intent, normalizedSnapshot)) {
      intentsByKey.delete(key);
      operationsByKey.delete(key);
      changed = true;
    }
  }
  if (changed) {
    writeStateChanged();
  }
}
