import {
  escapeHtml,
  renderCollapseChevron,
  renderInlineStateBox,
  textAction,
} from "../lib/ui.js";
import { deriveProjectResolution } from "../app/resource-resolution.js";
import {
  renderProjectFilesBody,
  visibleProjectFileCount,
} from "./project-chapter-list-render.js";

export function renderProjectCard(project, expanded, options = {}) {
  const canManageProjects = options.canManageProjects !== false;
  const canDownloadFiles = options.canDownloadFiles !== false;
  const canPermanentlyDeleteFiles = options.canPermanentlyDeleteFiles === true;
  const isDeleted = options.isDeleted === true;
  const offlineMode = options.offlineMode === true;
  const isTombstone = project?.recordState === "tombstone";
  const syncSnapshot = options.syncSnapshot ?? null;
  const syncStatus = typeof syncSnapshot?.status === "string" ? syncSnapshot.status.trim() : "";
  const localRepoUnavailable = syncStatus === "notCloned";
  const localRepoSetupPending = (
    syncStatus === "syncing"
    || localRepoUnavailable
  );
  const resolution = deriveProjectResolution(project, syncSnapshot, {
    suppressMissingLocalRepoRepair: options.suppressMissingLocalRepoRepair === true,
  });
  const disableLifecycleActions = resolution?.blockLifecycleActions === true || isDeleted;
  const disableContentActions = resolution?.blockContentActions === true || isDeleted;
  const lifecycleActionsDisabled = options.lifecycleActionsDisabled === true;
  const pageWritesDisabled = options.pageWritesDisabled === true;
  const heavyActionsDisabled = options.heavyActionsDisabled === true || pageWritesDisabled;
  const localHardDeleteActionsDisabled = options.localHardDeleteActionsDisabled === true || pageWritesDisabled;
  const addFilesWriteDisabled =
    options.addFilesWriteDisabled === undefined
      ? heavyActionsDisabled
      : options.addFilesWriteDisabled === true;
  const glossaryChangesDisabled = options.glossaryChangesDisabled === true;
  const deleteAction = options.deleteAction ?? `delete-project:${project.id}`;
  const disablePermanentDelete = options.disablePermanentDelete === true;
  const addFilesDisabled = options.addFilesDisabled === true;
  const filesLength = visibleProjectFileCount(project);
  const actions =
    options.actions ??
    (
      isDeleted && isTombstone
        ? []
        : [
            canManageProjects
              ? textAction("Add files", `add-project-files:${project.id}`, {
                  disabled: offlineMode || addFilesWriteDisabled || addFilesDisabled || localRepoSetupPending || disableContentActions,
                })
              : "",
            canManageProjects
              ? textAction("Rename", `rename-project:${project.id}`, {
                  disabled: offlineMode || lifecycleActionsDisabled || disableLifecycleActions,
                })
              : "",
            canManageProjects
              ? textAction("Delete", deleteAction, {
                  disabled: offlineMode || lifecycleActionsDisabled || disableLifecycleActions || disablePermanentDelete,
                })
              : "",
          ].filter(Boolean)
    );
  const fileCount = isDeleted && isTombstone
      ? "Permanently deleted"
    : localRepoSetupPending && filesLength === 0
      ? "Setting up local repo..."
      : `${filesLength} file${filesLength === 1 ? "" : "s"}`;
  const resolutionMarkup = resolution
    ? renderInlineStateBox({
        tone: resolution.tone,
        message: resolution.message,
        help: resolution.help,
        className: "resource-state-box expandable-card__status",
        actionLabel: resolution.actionLabel,
        action: resolution.action,
        actionDisabled: offlineMode || heavyActionsDisabled,
      })
    : "";

  const fileRows = expanded
    ? renderProjectFilesBody(project, {
        canManageProjects,
        canDownloadFiles,
        canPermanentlyDeleteFiles,
        offlineMode,
        lifecycleActionsDisabled,
        glossaryChangesDisabled,
        disableContentActions,
        localRepoUnavailable,
        localHardDeleteActionsDisabled,
        showDeletedFiles: options.showDeletedFiles === true,
        glossaryOptions: options.glossaries ?? [],
      })
    : "";

  return `
    <article class="card card--expandable ${expanded ? "is-expanded" : ""} ${
      isDeleted ? "card--deleted" : ""
    }">
      <div class="expandable-card__header">
        <button
          class="expandable-card__summary-button collapse-affordance"
          data-action="toggle-project:${project.id}"
          aria-expanded="${expanded ? "true" : "false"}"
        >
          ${renderCollapseChevron(expanded, "expandable-card__chevron")}
          <span class="expandable-card__title-wrap">
            <span class="expandable-card__title">${escapeHtml(project.title ?? project.name)}</span>
            <span class="expandable-card__meta">${escapeHtml(fileCount)}</span>
          </span>
        </button>
        <div class="expandable-card__actions">
          ${actions.join("")}
        </div>
      </div>
      ${resolutionMarkup}
      ${fileRows}
    </article>
  `;
}

