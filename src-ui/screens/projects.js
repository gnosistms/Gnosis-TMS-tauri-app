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
  secondaryButton,
  sectionSeparator,
  textAction,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { projectsSearchModeIsActive } from "../app/project-search-state.js";
import { renderProjectCreationModal } from "./project-creation-modal.js";
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
import { areResourcePageWritesDisabled } from "../app/resource-page-controller.js";

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

function renderChapterGlossarySelect(chapter, glossaries, options = {}) {
  const linkedGlossary = chapter.linkedGlossary;
  const selectedGlossary = findGlossaryOptionById(glossaries, linkedGlossary?.glossaryId);
  const tooltipText = "Select a glossary";
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
  const isTombstone = project?.recordState === "tombstone";
  const syncSnapshot = options.syncSnapshot ?? null;
  const syncStatus = typeof syncSnapshot?.status === "string" ? syncSnapshot.status.trim() : "";
  const localRepoSetupPending = (
    syncStatus === "syncing"
    || syncStatus === "notCloned"
  );
  const resolution = deriveProjectResolution(project, syncSnapshot);
  const disableLifecycleActions = resolution?.blockLifecycleActions === true;
  const disableContentActions = resolution?.blockContentActions === true;
  const pageWritesDisabled = options.pageWritesDisabled === true;
  const glossaryChangesDisabled = options.glossaryChangesDisabled === true;
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
                  disabled: offlineMode || pageWritesDisabled || addFilesDisabled || localRepoSetupPending || disableContentActions,
                })
              : "",
            canManageProjects
              ? textAction("Rename", `rename-project:${project.id}`, {
                  disabled: offlineMode || pageWritesDisabled || disableLifecycleActions,
                })
              : "",
            canManageProjects
              ? textAction("Delete", deleteAction, {
                  disabled: offlineMode || pageWritesDisabled || disableLifecycleActions || disablePermanentDelete,
                })
              : "",
          ].filter(Boolean)
    );
  const fileCount = isDeleted && isTombstone
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
                    ${renderChapterGlossarySelect(chapter, glossaryOptions, {
                      disabled: offlineMode || pageWritesDisabled || glossaryChangesDisabled || !canManageProjects,
                    })}
                    ${textAction("Open", `open-translate:${chapter.id}`)}
                    ${canManageProjects ? textAction("Rename", `rename-file:${chapter.id}`, { disabled: offlineMode || pageWritesDisabled || disableContentActions }) : ""}
                    ${canManageProjects ? textAction("Delete", `delete-file:${chapter.id}`, { disabled: offlineMode || pageWritesDisabled || disableContentActions }) : ""}
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
                                  ${canManageProjects ? textAction("Restore", `restore-file:${chapter.id}`, { disabled: offlineMode || pageWritesDisabled || disableContentActions }) : ""}
                                  ${canManageProjects && canPermanentlyDeleteFiles ? textAction("Delete", `delete-deleted-file:${chapter.id}`, { disabled: offlineMode || pageWritesDisabled || disableContentActions }) : ""}
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
  const pageWritesDisabled = areResourcePageWritesDisabled(state.projectsPage);
  const syncSnapshotsByProjectId = state.projectRepoSyncByProjectId ?? {};
  const glossaryChangesDisabled =
    pageWritesDisabled
    || state.projectDiscovery?.status === "loading"
    || state.projectsPageSync?.status === "syncing"
    || state.projectImport?.status === "importing";

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
              pageWritesDisabled,
              glossaryChangesDisabled,
              syncSnapshot,
              actions:
                project?.recordState === "tombstone"
                  ? []
                  : canManageDeletedProjects
                    ? [
                        textAction("Restore", `restore-project:${project.id}`, { disabled: pageWritesDisabled || disableLifecycleActions }),
                        ...(canPermanentlyDeleteProjects
                          ? [textAction("Delete", `delete-deleted-project:${project.id}`, {
                              disabled: pageWritesDisabled || disableLifecycleActions,
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

function renderProjectSearchResult(result) {
  const matchCount = Number.isFinite(result?.matchCount) ? result.matchCount : 0;
  return `
    <article class="card project-search-result">
      <div class="project-search-result__header">
        <p class="project-search-result__path">
          ${escapeHtml(result?.projectTitle ?? "Project")}
          <span class="project-search-result__separator">›</span>
          ${escapeHtml(result?.chapterTitle ?? "File")}
          <span class="project-search-result__separator">›</span>
          ${escapeHtml(result?.languageName ?? result?.languageCode ?? "")}
        </p>
        ${matchCount > 0 ? `<span class="project-search-result__meta">${escapeHtml(`${matchCount} match${matchCount === 1 ? "" : "es"}`)}</span>` : ""}
      </div>
      <p class="project-search-result__snippet">${escapeHtml(result?.snippet ?? "")}</p>
      <div class="project-search-result__footer">
        ${textAction("Open", `open-project-search-result:${result?.resultId ?? ""}`)}
      </div>
    </article>
  `;
}

function renderProjectSearchResults(state) {
  const search = state.projectsSearch ?? {};
  const resultCount = Number.isFinite(search.total) ? search.total : 0;
  const header = `
    <div class="project-search-results__toolbar">
      <div class="project-search-results__summary">
        <h2 class="project-search-results__title">Search results</h2>
        <p class="project-search-results__count">${escapeHtml(`${resultCount} result${resultCount === 1 ? "" : "s"}`)}</p>
      </div>
      ${secondaryButton("Clear", "clear-project-search", { compact: true })}
    </div>
  `;

  if (search.status === "searching") {
    return (
      header +
      renderStateCard({
        eyebrow: "SEARCHING",
        title: "Searching projects...",
        subtitle: "",
      })
    );
  }

  if (search.status === "error") {
    return (
      header +
      renderStateCard({
        eyebrow: "SEARCH FAILED",
        title: "Could not search local project files.",
        subtitle: formatErrorForDisplay(search.error || "Unknown error."),
        tone: "error",
      })
    );
  }

  if ((search.results ?? []).length === 0) {
    return (
      header +
      renderStateCard({
        eyebrow: "NO RESULTS",
        title: "No matches found.",
        subtitle: "",
      })
    );
  }

  return `
    ${header}
    <section class="stack project-search-results">
      ${(search.results ?? []).map((result) => renderProjectSearchResult(result)).join("")}
      ${
        search.hasMore
          ? `<div class="project-search-results__more">${secondaryButton(search.loadingMore ? "Loading..." : "Load more", "load-more-project-search-results", { disabled: search.loadingMore === true })}</div>`
          : ""
      }
    </section>
  `;
}

export function renderProjectsScreen(state) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId) ?? state.teams[0];
  const canManageProjects = selectedTeam?.canManageProjects === true;
  const canCreateProjects = shouldShowNewProjectButton(selectedTeam);
  const canPermanentlyDeleteFiles = canPermanentlyDeleteProjectFiles(selectedTeam);
  const offlineMode = state.offline?.isEnabled === true;
  const pageWritesDisabled = areResourcePageWritesDisabled(state.projectsPage);
  const importInProgress = state.projectImport?.status === "importing";
  const discovery = state.projectDiscovery ?? { status: "idle", error: "", glossaryWarning: "" };
  const syncSnapshotsByProjectId = state.projectRepoSyncByProjectId ?? {};
  const recoveryMessage =
    typeof discovery.recoveryMessage === "string" && discovery.recoveryMessage.trim()
      ? discovery.recoveryMessage.trim()
      : "";
  const projectsSyncBadgeText = getScopedSyncBadgeText("projects");
  const isProjectsSyncing = state.projectsPageSync?.status === "syncing";
  const searchModeActive = projectsSearchModeIsActive(state);
  const glossaryChangesDisabled =
    pageWritesDisabled
    || discovery.status === "loading"
    || isProjectsSyncing
    || importInProgress;
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
                  pageWritesDisabled,
                  addFilesDisabled: importInProgress,
                  glossaryChangesDisabled,
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
      ${searchModeActive ? renderProjectSearchResults(state) : projectsBody}
      ${searchModeActive ? "" : renderDeletedProjectsSection(state)}
    </section>
  `;

  const searchQuery = state.projectsSearch?.query ?? "";
  const searchField = createSearchField({
    placeholder: "Search",
    value: searchQuery,
    inputAttributes: {
      "data-project-search-input": true,
      "aria-label": "Search all project files",
    },
    endAdornment:
      String(searchQuery).trim().length > 0
        ? secondaryButton("Clear", "clear-project-search", { compact: true })
        : "",
  });

  return (
    pageShell({
    title: "Projects",
    subtitle: selectedTeam?.name ?? "Team",
    titleAction: buildPageRefreshAction(state, state.projectsPageSync),
    navButtons: buildSectionNav("projects"),
    leftTools: searchField,
    tools: [
      canCreateProjects
        ? primaryButton("+ New Project", "open-new-project", { disabled: offlineMode || pageWritesDisabled })
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
    renderProjectCreationModal(state) +
    renderChapterPermanentDeletionModal(state) +
    renderChapterRenameModal(state) +
    renderProjectRenameModal(state) +
    renderProjectPermanentDeletionModal(state)
  );
}
