import { state } from "./state.js";
import {
  areResourcePageWritesDisabled,
  areResourcePageWriteSubmissionsDisabled,
} from "./resource-page-controller.js";
import {
  anyProjectMutatingWriteIsActive,
  anyProjectWriteIsActive,
} from "./project-write-coordinator.js";
import { getRepoWriteQueueSnapshot } from "./repo-write-queue.js";

export function projectWriteBlockedMessage() {
  return "Wait for the current projects refresh or write to finish.";
}

export function projectLifecycleWriteBlockedMessage() {
  return "Wait for the current project write to finish.";
}

export function areProjectHeavyWritesDisabled() {
  return areResourcePageWritesDisabled(state.projectsPage) || anyProjectWriteIsActive();
}

export function anyProjectMutatingRepoQueueWriteActive() {
  return getRepoWriteQueueSnapshot().operations.some((operation) => {
    const kind = String(operation?.kind ?? "");
    return !kind.startsWith("editor:") && kind !== "projectRepoSync";
  });
}

export function areProjectCreationWritesDisabled() {
  return (
    areResourcePageWritesDisabled(state.projectsPage)
    || anyProjectMutatingWriteIsActive()
    || anyProjectMutatingRepoQueueWriteActive()
  );
}

export function areProjectLocalHardDeleteWritesDisabled() {
  return areResourcePageWritesDisabled(state.projectsPage);
}

export function areProjectLifecycleWritesDisabled() {
  return areResourcePageWriteSubmissionsDisabled(state.projectsPage);
}

export function resourceHasPendingLifecycleMutation(resource) {
  return typeof resource?.pendingMutation === "string" && resource.pendingMutation.trim();
}

export function projectHasPendingDeletedFileMutation(project) {
  return (Array.isArray(project?.chapters) ? project.chapters : [])
    .some((chapter) => chapter?.status === "deleted" && resourceHasPendingLifecycleMutation(chapter));
}
