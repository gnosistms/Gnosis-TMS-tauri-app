import {
  sectionSeparator,
  textAction,
} from "../lib/ui.js";
import { deriveProjectResolution } from "../app/resource-resolution.js";
import {
  canDownloadProjectFiles,
  canMutateProjectFiles,
  shouldShowDeletedProjectPermanentDelete,
} from "../app/resource-capabilities.js";
import {
  areResourcePageWritesDisabled,
  areResourcePageWriteSubmissionsDisabled,
} from "../app/resource-page-controller.js";
import {
  anyProjectWriteIsActive,
} from "../app/project-write-coordinator.js";
import { getRepoWriteQueueSnapshot } from "../app/repo-write-queue.js";
import { resourceHasPendingLifecycleMutation } from "../app/project-page-write-state.js";
import { renderProjectCard } from "./project-list-render.js";

function renderDeletedProjectsToggle(state) {
  const isOpen = state.showDeletedProjects;
  return sectionSeparator({
    label: isOpen ? "Hide deleted projects" : "Show deleted projects",
    action: "toggle-deleted-projects",
    isOpen,
  });
}

export function renderDeletedProjectsSection(state) {
  if (state.deletedProjects.length === 0) {
    return "";
  }

  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId) ?? state.teams[0];
  const canManageDeletedProjects = canMutateProjectFiles(selectedTeam);
  const canDownloadDeletedProjectFiles = canDownloadProjectFiles(selectedTeam);
  const canPermanentlyDeleteProjects = shouldShowDeletedProjectPermanentDelete(selectedTeam);
  const offlineMode = state.offline?.isEnabled === true;
  const pageWritesDisabled = areResourcePageWritesDisabled(state.projectsPage);
  const projectRepoQueueActive = getRepoWriteQueueSnapshot().operations.some(
    (operation) => !String(operation.kind ?? "").startsWith("editor:"),
  );
  const heavyActionsDisabled = pageWritesDisabled || anyProjectWriteIsActive() || projectRepoQueueActive;
  const localHardDeleteActionsDisabled = pageWritesDisabled;
  const lifecycleActionsDisabled = areResourcePageWriteSubmissionsDisabled(state.projectsPage);
  const syncSnapshotsByProjectId = state.projectRepoSyncByProjectId ?? {};
  const glossaryChangesDisabled = state.projectImport?.status === "importing";
  const discovery = state.projectDiscovery ?? {};
  const refreshInProgress =
    state.projectsPage?.isRefreshing === true
    || state.projectsPageSync?.status === "syncing"
    || discovery.status === "loading";

  const toggle = renderDeletedProjectsToggle(state);
  if (!state.showDeletedProjects) {
    return toggle;
  }

  return `
    ${toggle}
    <section class="stack stack--deleted-projects">
      <section class="stack project-card-stack">${state.deletedProjects
        .map((project) =>
          {
            const syncSnapshot = syncSnapshotsByProjectId[project.id] ?? null;
            const resolution = deriveProjectResolution(project, syncSnapshot, {
              suppressMissingLocalRepoRepair: refreshInProgress,
            });
            const disableLifecycleActions = offlineMode || resolution?.blockLifecycleActions === true;
            const disableLocalHardDeleteActions =
              localHardDeleteActionsDisabled
              || resourceHasPendingLifecycleMutation(project)
              || resolution?.blockLifecycleActions === true;
            return renderProjectCard(project, state.expandedProjects.has(project.id), {
              canManageProjects: canManageDeletedProjects,
              canDownloadFiles: canDownloadDeletedProjectFiles,
              isDeleted: true,
              offlineMode,
              pageWritesDisabled,
              heavyActionsDisabled,
              localHardDeleteActionsDisabled,
              lifecycleActionsDisabled,
              glossaryChangesDisabled,
              glossaries: state.glossaries,
              syncSnapshot,
              suppressMissingLocalRepoRepair: refreshInProgress,
              actions:
                project?.recordState === "tombstone"
                  ? []
                  : [
                      canManageDeletedProjects
                        ? textAction("Restore", `restore-project:${project.id}`, { disabled: lifecycleActionsDisabled || disableLifecycleActions })
                        : "",
                      canPermanentlyDeleteProjects
                        ? textAction("Delete", `delete-deleted-project:${project.id}`, {
                            disabled: disableLocalHardDeleteActions,
                          })
                        : "",
                    ].filter(Boolean),
            });
          },
        )
        .join("")}</section>
    </section>
  `;
}

