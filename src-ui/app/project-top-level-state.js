import { state } from "./state.js";
import {
  applyTopLevelResourceMutation,
  rollbackTopLevelResourceMutation,
} from "./resource-top-level-mutations.js";

function getProjectSortName(project) {
  if (typeof project?.title === "string" && project.title.trim()) {
    return project.title.trim();
  }

  if (typeof project?.name === "string" && project.name.trim()) {
    return project.name.trim();
  }

  return "";
}

function compareProjectsByName(left, right) {
  const nameComparison = getProjectSortName(left).localeCompare(getProjectSortName(right), undefined, {
    sensitivity: "base",
    numeric: true,
  });
  if (nameComparison !== 0) {
    return nameComparison;
  }

  return String(left?.id ?? "").localeCompare(String(right?.id ?? ""), undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

export function sortProjectsByName(projects = []) {
  return [...projects].sort(compareProjectsByName);
}

export function sortProjectSnapshot(snapshot) {
  return {
    items: sortProjectsByName(snapshot?.items ?? []),
    deletedItems: sortProjectsByName(snapshot?.deletedItems ?? []),
  };
}

function normalizeProjectSnapshot(snapshot, pendingMutations = []) {
  const latestMutationByProjectId = new Map();
  for (const mutation of pendingMutations) {
    latestMutationByProjectId.set(mutation.projectId, mutation.type);
  }

  const activeById = new Map((snapshot?.items ?? []).map((item) => [item.id, item]));
  const deletedById = new Map((snapshot?.deletedItems ?? []).map((item) => [item.id, item]));

  for (const [projectId] of deletedById.entries()) {
    if (!activeById.has(projectId)) {
      continue;
    }

    const latestMutation = latestMutationByProjectId.get(projectId);
    if (latestMutation === "restore" || latestMutation === "rename") {
      deletedById.delete(projectId);
      continue;
    }

    if (latestMutation === "softDelete") {
      activeById.delete(projectId);
      continue;
    }

    activeById.delete(projectId);
  }

  return sortProjectSnapshot({
    items: [...activeById.values()],
    deletedItems: [...deletedById.values()],
  });
}

export function projectSnapshotFromState() {
  return sortProjectSnapshot({
    items: state.projects,
    deletedItems: state.deletedProjects,
  });
}

export function applyProjectSnapshotToState(snapshot, options = {}) {
  const sortedSnapshot = sortProjectSnapshot(snapshot);
  state.projects = sortedSnapshot.items;
  state.deletedProjects = sortedSnapshot.deletedItems;
  if (sortedSnapshot.deletedItems.length === 0) {
    state.showDeletedProjects = false;
  }
  options?.reconcileExpandedDeletedFiles?.();
}

export function applyProjectPendingMutation(snapshot, mutation) {
  return applyTopLevelResourceMutation(snapshot, mutation, {
    getMutationResourceId: (nextMutation) => nextMutation.resourceId ?? nextMutation.projectId ?? "",
    normalizeSnapshot: normalizeProjectSnapshot,
    markDeleted: (project) => ({
      ...project,
      status: "deleted",
    }),
    markActive: (project) => ({
      ...project,
      status: "active",
    }),
    renameResource: (project, nextMutation) => ({
      ...project,
      title: nextMutation.title,
    }),
  });
}

export function rollbackVisibleProjectMutation(mutation, options = {}) {
  const snapshot = rollbackTopLevelResourceMutation(
    projectSnapshotFromState(),
    mutation,
    applyProjectPendingMutation,
    {
      getMutationResourceId: (nextMutation) =>
        nextMutation.resourceId ?? nextMutation.projectId ?? "",
    },
  );
  applyProjectSnapshotToState(snapshot, options);
}
