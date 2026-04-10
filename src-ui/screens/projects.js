import {
  buildPageRefreshAction,
  buildSectionNav,
  createSearchField,
  escapeHtml,
  pageShell,
  primaryButton,
  renderCollapseChevron,
  renderInlineStateBox,
  renderSelectPillControl,
  renderStateCard,
  sectionSeparator,
  textAction,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { renderProjectCreationModal } from "./project-creation-modal.js";
import { renderChapterGlossaryConflictModal } from "./chapter-glossary-conflict-modal.js";
import { renderChapterPermanentDeletionModal } from "./chapter-permanent-deletion-modal.js";
import { renderChapterRenameModal } from "./chapter-rename-modal.js";
import { renderProjectPermanentDeletionModal } from "./project-permanent-deletion-modal.js";
import { renderProjectRenameModal } from "./project-rename-modal.js";
import {
  getNoticeBadgeText,
  getScopedSyncBadgeText,
} from "../app/status-feedback.js";
import { resolveChapterSourceWordCount } from "../app/translate-flow.js";
import { deriveProjectResolution } from "../app/resource-resolution.js";
import {
  canPermanentlyDeleteProjectFiles,
  shouldShowDeletedProjectPermanentDelete,
  shouldShowNewProjectButton,
} from "../app/resource-capabilities.js";

function compareFilesByName(left, right) {
  const leftName = typeof left?.name === "string" ? left.name.trim() : "";
  const rightName = typeof right?.name === "string" ? right.name.trim() : "";
  const nameComparison = leftName.localeCompare(rightName, undefined, {
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

function availableGlossaryOptions(glossaries = []) {
  return (Array.isArray(glossaries) ? glossaries : []).filter(
    (glossary) => glossary?.lifecycleState !== "deleted",
  );
}

function findGlossaryOptionById(glossaries, glossaryId) {
  if (typeof glossaryId !== "string" || !glossaryId.trim()) {
    return null;
  }

  return availableGlossaryOptions(glossaries).find((glossary) => glossary.id === glossaryId) ?? null;
}

function renderChapterGlossarySelect(chapter, slotNumber, glossaries, options = {}) {
  const linkedGlossary = slotNumber === 1 ? chapter.linkedGlossary1 : chapter.linkedGlossary2;
  const selectedGlossary = findGlossaryOptionById(glossaries, linkedGlossary?.glossaryId);
  const slotKey = `glossary_${slotNumber}`;
  const tooltipText = `Select glossary ${slotNumber}`;
  const optionList = availableGlossaryOptions(glossaries);

  return renderSelectPillControl({
    className: "select-pill--toolbar select-pill--chapter-glossary select-pill--truncate-value",
    value: selectedGlossary?.title ?? "no glossary",
    tooltip: tooltipText,
    disabled: options.disabled === true,
    wrapperAttributes: {
      "data-stop-row-action": true,
    },
    selectAttributes: {
      "data-chapter-glossary-select": true,
      "data-chapter-id": chapter.id,
      "data-glossary-slot": slotKey,
      "aria-label": tooltipText,
    },
    options: [
      {
        value: "",
        label: "no glossary",
        selected: !selectedGlossary,
      },
      ...optionList.map((glossary) => ({
        value: glossary.id,
        label: glossary.title,
        selected: glossary.id === selectedGlossary?.id,
      })),
    ],
  });
}

function renderProjectCard(project, expanded, options = {}) {
  const canManageProjects = options.canManageProjects !== false;
  const canPermanentlyDeleteFiles = options.canPermanentlyDeleteFiles === true;
  const isDeleted = options.isDeleted === true;
  const offlineMode = options.offlineMode === true;
  const isPendingCreate = project?.isPendingCreate === true;
  const isTombstone = project?.recordState === "tombstone";
  const syncSnapshot = options.syncSnapshot ?? null;
  const syncStatus = typeof syncSnapshot?.status === "string" ? syncSnapshot.status.trim() : "";
  const localRepoSetupPending = (
    syncStatus === "syncing"
    || syncStatus === "notCloned"
    || (isPendingCreate && !Number.isFinite(project?.repoId))
  );
  const resolution = deriveProjectResolution(project, syncSnapshot);
  const disableLifecycleActions = resolution?.blockLifecycleActions === true;
  const disableContentActions = resolution?.blockContentActions === true;
  const deleteAction = options.deleteAction ?? `delete-project:${project.id}`;
  const disablePermanentDelete = options.disablePermanentDelete === true;
  const addFilesDisabled = options.addFilesDisabled === true;
  const glossaryOptions = options.glossaries ?? [];
  const allFiles = Array.isArray(project.chapters) ? project.chapters : [];
  const files = allFiles.filter((chapter) => chapter?.status !== "deleted").sort(compareFilesByName);
  const deletedFiles = allFiles.filter((chapter) => chapter?.status === "deleted").sort(compareFilesByName);
  const showDeletedFiles = options.showDeletedFiles === true;
  const actions =
    options.actions ??
    (
      isDeleted && isTombstone
        ? []
        : [
            canManageProjects
              ? textAction("Add files", `add-project-files:${project.id}`, {
                  disabled: offlineMode || addFilesDisabled || localRepoSetupPending || disableContentActions,
                })
              : "",
            canManageProjects
              ? textAction("Rename", `rename-project:${project.id}`, {
                  disabled: offlineMode || disableLifecycleActions,
                })
              : "",
            canManageProjects
              ? textAction("Delete", deleteAction, {
                  disabled: offlineMode || disableLifecycleActions || disablePermanentDelete,
                })
              : "",
          ].filter(Boolean)
    );
  const fileCount = isPendingCreate
    ? project.pendingCreateStatusText ?? "Creating..."
    : isDeleted && isTombstone
      ? "Permanently deleted"
    : localRepoSetupPending && files.length === 0
      ? "Setting up local repo..."
      : `${files.length} file${files.length === 1 ? "" : "s"}`;
  const resolutionMarkup = resolution
    ? renderInlineStateBox({
        tone: resolution.tone,
        message: resolution.message,
        help: resolution.help,
        className: "resource-state-box expandable-card__status",
        actionLabel: resolution.actionLabel,
        action: resolution.action,
      })
    : "";

  const fileRows = expanded
    ? `
      <div class="expandable-card__body">
        <div class="chapter-table">
          ${files
            .map(
              (chapter) => {
                const sourceWordCount = resolveChapterSourceWordCount(chapter);
                const sourceWordText =
                  sourceWordCount > 0 ? `${sourceWordCount} source words` : "";

                return `
                <div class="chapter-table__row chapter-table__row--file chapter-table__row--interactive" data-action="open-translate:${chapter.id}">
                  <div class="chapter-table__title-wrap">
                    <button class="chapter-table__name-button" data-action="open-translate:${chapter.id}">
                      ${escapeHtml(chapter.name)}
                    </button>
                    ${
                      sourceWordText
                        ? `<span class="chapter-table__meta">${escapeHtml(sourceWordText)}</span>`
                        : ""
                    }
                  </div>
                  <div class="chapter-table__actions">
                    ${renderChapterGlossarySelect(chapter, 1, glossaryOptions, { disabled: offlineMode || !canManageProjects })}
                    ${renderChapterGlossarySelect(chapter, 2, glossaryOptions, { disabled: offlineMode || !canManageProjects })}
                    ${textAction("Open", `open-translate:${chapter.id}`)}
                    ${canManageProjects ? textAction("Rename", `rename-file:${chapter.id}`, { disabled: offlineMode || disableContentActions }) : ""}
                    ${canManageProjects ? textAction("Delete", `delete-file:${chapter.id}`, { disabled: offlineMode || disableContentActions }) : ""}
                  </div>
                </div>
              `;
              },
            )
            .join("")}
        </div>
        ${
          deletedFiles.length > 0
            ? `
              <div class="project-files__deleted">
                ${sectionSeparator({
                  label: showDeletedFiles ? "Hide deleted files" : "Show deleted files",
                  action: `toggle-deleted-files:${project.id}`,
                  isOpen: showDeletedFiles,
                })}
                ${
                  showDeletedFiles
                    ? `
                      <div class="chapter-table chapter-table--deleted">
                        ${deletedFiles
                          .map(
                            (chapter) => `
                              <div class="chapter-table__row chapter-table__row--file chapter-table__row--deleted">
                                <div class="chapter-table__title-wrap">
                                  <span class="chapter-table__name">${escapeHtml(chapter.name)}</span>
                                </div>
                                <div class="chapter-table__actions">
                                  ${canManageProjects ? textAction("Restore", `restore-file:${chapter.id}`, { disabled: offlineMode || disableContentActions }) : ""}
                                  ${canManageProjects && canPermanentlyDeleteFiles ? textAction("Delete", `delete-deleted-file:${chapter.id}`, { disabled: offlineMode || disableContentActions }) : ""}
                                </div>
                              </div>
                            `,
                          )
                          .join("")}
                      </div>
                    `
                    : ""
                }
              </div>
            `
            : ""
        }
      </div>
    `
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

function renderDeletedProjectsToggle(state) {
  const isOpen = state.showDeletedProjects;
  return sectionSeparator({
    label: isOpen ? "Hide deleted projects" : "Show deleted projects",
    action: "toggle-deleted-projects",
    isOpen,
  });
}

function renderDeletedProjectsSection(state) {
  if (state.deletedProjects.length === 0) {
    return "";
  }

  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId) ?? state.teams[0];
  const canManageDeletedProjects = selectedTeam?.canManageProjects === true;
  const canPermanentlyDeleteProjects = shouldShowDeletedProjectPermanentDelete(selectedTeam);
  const offlineMode = state.offline?.isEnabled === true;
  const syncSnapshotsByProjectId = state.projectRepoSyncByProjectId ?? {};
  const projectCreationInFlightIds = state.projectCreationInFlightIds ?? new Set();

  const toggle = renderDeletedProjectsToggle(state);
  if (!state.showDeletedProjects) {
    return toggle;
  }

  return `
    ${toggle}
    <section class="stack stack--deleted-projects">
      <section class="stack">${state.deletedProjects
        .map((project) =>
          {
            const syncSnapshot = syncSnapshotsByProjectId[project.id] ?? null;
            const resolution = deriveProjectResolution(project, syncSnapshot);
            const disableLifecycleActions = offlineMode || resolution?.blockLifecycleActions === true;
            return renderProjectCard(project, state.expandedProjects.has(project.id), {
              canManageProjects: canManageDeletedProjects,
              isDeleted: true,
              offlineMode,
              syncSnapshot,
              disablePermanentDelete: projectCreationInFlightIds.has(project.id),
              actions:
                project?.recordState === "tombstone"
                  ? []
                  : canManageDeletedProjects
                    ? [
                        textAction("Restore", `restore-project:${project.id}`, { disabled: disableLifecycleActions }),
                        ...(canPermanentlyDeleteProjects
                          ? [textAction("Delete", `delete-deleted-project:${project.id}`, {
                              disabled: disableLifecycleActions || projectCreationInFlightIds.has(project.id),
                            })]
                          : []),
                      ]
                    : [],
            });
          },
        )
        .join("")}</section>
    </section>
  `;
}

export function renderProjectsScreen(state) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId) ?? state.teams[0];
  const canManageProjects = selectedTeam?.canManageProjects === true;
  const canCreateProjects = shouldShowNewProjectButton(selectedTeam);
  const canPermanentlyDeleteFiles = canPermanentlyDeleteProjectFiles(selectedTeam);
  const offlineMode = state.offline?.isEnabled === true;
  const importInProgress = state.projectImport?.status === "importing";
  const discovery = state.projectDiscovery ?? { status: "idle", error: "", glossaryWarning: "" };
  const syncSnapshotsByProjectId = state.projectRepoSyncByProjectId ?? {};
  const recoveryMessage =
    typeof discovery.recoveryMessage === "string" && discovery.recoveryMessage.trim()
      ? discovery.recoveryMessage.trim()
      : "";
  const projectsSyncBadgeText = getScopedSyncBadgeText("projects");
  const isProjectsSyncing = state.projectsPageSync?.status === "syncing";
  const recoveryMarkup = recoveryMessage
    ? `
      <div class="message-box message-box--warning">
        <p class="message-box__text">${escapeHtml(recoveryMessage)}</p>
      </div>
    `
    : "";
  const glossaryWarningMarkup = discovery.glossaryWarning
    ? `
      <div class="message-box message-box--warning">
        <p class="message-box__text">${escapeHtml(discovery.glossaryWarning)}</p>
      </div>
    `
    : "";
  const emptyState = renderStateCard({
    eyebrow: "NO PROJECTS FOUND",
    title: "This team doesn't have any projects yet.",
    subtitle: "Click + New Project to create one.",
  });
  const loadingState = renderStateCard({
    eyebrow: "LOADING PROJECTS",
    title: "Loading projects...",
    subtitle: recoveryMessage || "",
  });
  const errorState = renderStateCard({
    eyebrow: "PROJECT LOAD FAILED",
    title: "Could not load this team's projects.",
    subtitle: formatErrorForDisplay(discovery.error || "Unknown error."),
    tone: "error",
  });

  const projectsBody =
    discovery.status === "loading"
      ? loadingState
      : discovery.status === "error"
        ? errorState
        : state.projects.length === 0
          ? emptyState
          : `<section class="stack">${state.projects
              .map((project) =>
                renderProjectCard(project, state.expandedProjects.has(project.id), {
                  canManageProjects,
                  canPermanentlyDeleteFiles,
                  offlineMode,
                  addFilesDisabled: importInProgress,
                  showDeletedFiles: state.expandedDeletedFiles.has(project.id),
                  glossaries: state.glossaries,
                  syncSnapshot: syncSnapshotsByProjectId[project.id] ?? null,
                }),
              )
              .join("")}</section>`;

  const body = `
    <section class="stack">
      ${recoveryMarkup}
      ${glossaryWarningMarkup}
      ${projectsBody}
      ${renderDeletedProjectsSection(state)}
    </section>
  `;

  return (
    pageShell({
    title: "Projects",
    subtitle: selectedTeam?.name ?? "Team",
    titleAction: buildPageRefreshAction(state, state.projectsPageSync),
    navButtons: buildSectionNav("projects"),
    leftTools: createSearchField("Search"),
    tools: [
      canCreateProjects
        ? primaryButton("+ New Project", "open-new-project", { disabled: offlineMode })
        : "",
    ]
      .filter(Boolean)
      .join(""),
    pageSync: state.projectsPageSync,
    syncBadgeText: projectsSyncBadgeText,
    noticeText: getNoticeBadgeText(),
    offlineMode,
    offlineReconnectState: state.offline?.reconnecting === true,
    body,
    }) +
    renderChapterGlossaryConflictModal(state) +
    renderProjectCreationModal(state) +
    renderChapterPermanentDeletionModal(state) +
    renderChapterRenameModal(state) +
    renderProjectRenameModal(state) +
    renderProjectPermanentDeletionModal(state)
  );
}
