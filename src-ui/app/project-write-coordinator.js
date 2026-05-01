import {
  cloneWriteIntentValue,
  createWriteIntentCoordinator,
} from "./write-intent-coordinator.js";

const writeIntents = createWriteIntentCoordinator({
  defaultScope: "project-writes:default",
  label: "Project",
});

function normalizeProjectSnapshot(snapshot) {
  const projectSnapshot = snapshot?.snapshot && typeof snapshot.snapshot === "object"
    ? snapshot.snapshot
    : snapshot;
  return {
    items: Array.isArray(projectSnapshot?.items) ? projectSnapshot.items : [],
    deletedItems: Array.isArray(projectSnapshot?.deletedItems) ? projectSnapshot.deletedItems : [],
  };
}

export function resetProjectWriteCoordinator() {
  writeIntents.reset();
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
  return writeIntents.request(intent, operations);
}

export function getProjectWriteIntent(key) {
  return writeIntents.getIntent(key);
}

export function anyProjectWriteIsActive() {
  return writeIntents.anyActive();
}

export function anyProjectMutatingWriteIsActive() {
  return writeIntents.anyActive((intent) => intent.type !== "projectRepoSync");
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

  for (const intent of writeIntents.getIntents()) {
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
        linkedGlossary: cloneWriteIntentValue(intent.value?.glossary ?? null),
        pendingGlossaryMutation: true,
      });
    }
  }

  return nextSnapshot;
}

export function clearConfirmedProjectWriteIntents(snapshot) {
  const normalizedSnapshot = normalizeProjectSnapshot(snapshot);
  writeIntents.clearIntentsWhere((intent) =>
    intent.status === "pendingConfirmation"
    && intentMatchesSnapshot(intent, normalizedSnapshot)
  );
}
