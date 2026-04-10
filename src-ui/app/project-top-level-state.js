import { state } from "./state.js";

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

export function applyProjectSnapshotToState(snapshot, options = {}) {
  const sortedSnapshot = sortProjectSnapshot(snapshot);
  state.projects = sortedSnapshot.items;
  state.deletedProjects = sortedSnapshot.deletedItems;
  if (sortedSnapshot.deletedItems.length === 0) {
    state.showDeletedProjects = false;
  }
  options?.reconcileExpandedDeletedFiles?.();
}
