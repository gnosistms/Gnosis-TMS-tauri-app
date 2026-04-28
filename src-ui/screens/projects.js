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
import { buildProjectSearchSnippetMarkup } from "../app/project-search-highlighting.js";
import { projectsSearchModeIsActiveForState, projectsSearchResultCountLabel } from "../app/project-search-state.js";
import { renderProjectCreationModal } from "./project-creation-modal.js";
import { renderChapterPermanentDeletionModal } from "./chapter-permanent-deletion-modal.js";
import { renderChapterRenameModal } from "./chapter-rename-modal.js";
import { renderProjectPermanentDeletionModal } from "./project-permanent-deletion-modal.js";
import { renderProjectImportModal } from "./project-import-modal.js";
import { renderProjectExportModal } from "./project-export-modal.js";
import { renderProjectRenameModal } from "./project-rename-modal.js";
import {
  getNoticeBadgeText,
  getScopedSyncBadgeText,
  getStatusSurfaceItems,
} from "../app/status-feedback.js";
import { resolveChapterSourceWordCount } from "../app/translate-flow.js";
import { deriveProjectResolution } from "../app/resource-resolution.js";
import { listProjectRepoFallbackConflictEntries } from "../app/project-repo-sync-shared.js";
import {
  canPermanentlyDeleteProjectFiles,
  canManageTeamAiSettings,
  shouldShowDeletedProjectPermanentDelete,
  shouldShowNewProjectButton,
} from "../app/resource-capabilities.js";
import {
  areResourcePageWritesDisabled,
  areResourcePageWriteSubmissionsDisabled,
} from "../app/resource-page-controller.js";
import {
  anyProjectWriteIsActive,
  anyProjectMutatingWriteIsActive,
} from "../app/project-write-coordinator.js";

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
  const lifecycleActionsDisabled = options.lifecycleActionsDisabled === true;
  const pageWritesDisabled = options.pageWritesDisabled === true;
  const heavyActionsDisabled = options.heavyActionsDisabled === true || pageWritesDisabled;
  const addFilesWriteDisabled =
    options.addFilesWriteDisabled === undefined
      ? heavyActionsDisabled
      : options.addFilesWriteDisabled === true;
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
        actionDisabled: offlineMode || heavyActionsDisabled,
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
                      disabled: offlineMode || lifecycleActionsDisabled || glossaryChangesDisabled || !canManageProjects,
                    })}
                    ${textAction("Export", `export-file:${chapter.id}`, { disabled: localRepoSetupPending || disableContentActions })}
                    ${textAction("Open", `open-translate:${chapter.id}`)}
                    ${canManageProjects ? textAction("Rename", `rename-file:${chapter.id}`, { disabled: offlineMode || lifecycleActionsDisabled || disableContentActions }) : ""}
                    ${canManageProjects ? textAction("Delete", `delete-file:${chapter.id}`, { disabled: offlineMode || lifecycleActionsDisabled || disableContentActions }) : ""}
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
                                  ${canManageProjects ? textAction("Restore", `restore-file:${chapter.id}`, { disabled: offlineMode || lifecycleActionsDisabled || disableContentActions }) : ""}
                                  ${canManageProjects && canPermanentlyDeleteFiles ? textAction("Delete", `delete-deleted-file:${chapter.id}`, { disabled: offlineMode || heavyActionsDisabled || disableContentActions }) : ""}
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
  const heavyActionsDisabled = pageWritesDisabled || anyProjectWriteIsActive();
  const lifecycleActionsDisabled = areResourcePageWriteSubmissionsDisabled(state.projectsPage);
  const syncSnapshotsByProjectId = state.projectRepoSyncByProjectId ?? {};
  const glossaryChangesDisabled = state.projectImport?.status === "importing";

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
            const resolution = deriveProjectResolution(project, syncSnapshot);
            const disableLifecycleActions = offlineMode || resolution?.blockLifecycleActions === true;
            return renderProjectCard(project, state.expandedProjects.has(project.id), {
              canManageProjects: canManageDeletedProjects,
              isDeleted: true,
              offlineMode,
              pageWritesDisabled,
              heavyActionsDisabled,
              lifecycleActionsDisabled,
              glossaryChangesDisabled,
              syncSnapshot,
              actions:
                project?.recordState === "tombstone"
                  ? []
                  : canManageDeletedProjects
                    ? [
                        textAction("Restore", `restore-project:${project.id}`, { disabled: lifecycleActionsDisabled || disableLifecycleActions }),
                        ...(canPermanentlyDeleteProjects
                          ? [textAction("Delete", `delete-deleted-project:${project.id}`, {
                              disabled: heavyActionsDisabled || disableLifecycleActions,
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

function renderProjectSearchResult(result, searchQuery) {
  const matchCount = Number.isFinite(result?.matchCount) ? result.matchCount : 0;
  const snippetLanguageCode = typeof result?.languageCode === "string" ? result.languageCode.trim() : "";
  const snippetMarkup = buildProjectSearchSnippetMarkup(result?.snippet ?? "", searchQuery, snippetLanguageCode);
  const snippetSourceLabel = result?.snippetSource === "footnote" ? "Footnote:" : "";
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
      <p class="project-search-result__snippet"${snippetLanguageCode ? ` lang="${escapeHtml(snippetLanguageCode)}"` : ""} dir="auto">${snippetSourceLabel ? `<span class="project-search-result__snippet-source">${escapeHtml(snippetSourceLabel)}</span> ` : ""}${snippetMarkup}</p>
      <div class="project-search-result__footer">
        ${textAction("Open", `open-project-search-result:${result?.resultId ?? ""}`)}
      </div>
    </article>
  `;
}

function renderProjectSearchResults(state) {
  const search = state.projectsSearch ?? {};
  const header = `
    <div class="project-search-results__toolbar">
      <div class="project-search-results__summary">
        <h2 class="project-search-results__title">Search results</h2>
        <p class="project-search-results__count">${escapeHtml(projectsSearchResultCountLabel(search))}</p>
      </div>
      ${secondaryButton("Clear", "clear-project-search", { className: "project-search-results__clear-button" })}
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

  if (search.status === "too-short") {
    const minimumLength =
      Number.isFinite(search.minimumQueryLength) && search.minimumQueryLength > 0
        ? search.minimumQueryLength
        : 2;
    return (
      header +
      renderStateCard({
        eyebrow: "KEEP TYPING",
        title: `Type at least ${minimumLength} characters.`,
        subtitle: "",
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
      ${(search.results ?? []).map((result) => renderProjectSearchResult(result, search.query ?? "")).join("")}
      ${
        search.hasMore
          ? `<div class="project-search-results__more">${secondaryButton(search.loadingMore ? "Loading..." : "Load more", "load-more-project-search-results", { disabled: search.loadingMore === true })}</div>`
          : ""
      }
    </section>
  `;
}

function renderProjectRepoConflictRecovery(state, selectedTeam) {
  const recoveryState = state.projectRepoConflictRecovery ?? {};
  const entries = listProjectRepoFallbackConflictEntries(
    state.projects,
    state.deletedProjects,
    state.projectRepoSyncByProjectId,
  );
  if (entries.length === 0) {
    return "";
  }

  const isLoading =
    recoveryState.teamId === selectedTeam?.id
    && recoveryState.status === "loading";
  const recoveryDisabled =
    state.offline?.isEnabled === true
    || state.projectsPageSync?.status === "syncing"
    || anyProjectWriteIsActive();
  const errorText =
    recoveryState.teamId === selectedTeam?.id
      ? String(recoveryState.error ?? "").trim()
      : "";

  const overwriteButton = isLoading
    ? `
      <button class="button button--error button--loading project-conflict-recovery__button" disabled>
        <span class="button__spinner" aria-hidden="true"></span>
        <span>Overwriting...</span>
      </button>
    `
    : `
      <button
        class="button button--error project-conflict-recovery__button${recoveryDisabled ? " is-disabled" : ""}"
        data-action="overwrite-conflicted-project-repos"
        ${recoveryDisabled ? 'disabled aria-disabled="true" data-offline-blocked="true"' : ""}
      >Overwrite and resolve</button>
    `;

  return `
    <div class="message-box message-box--error project-conflict-recovery">
      <p class="message-box__text">Gnosis TMS found a project repo conflict that it could not resolve automatically.</p>
      <div class="project-conflict-recovery__repo-list">
        ${entries
          .map(
            (entry) => `
              <section class="project-conflict-recovery__repo">
                <p class="project-conflict-recovery__repo-title">${escapeHtml(entry.title)}</p>
                <pre class="project-conflict-recovery__git-error">${escapeHtml(
                  formatErrorForDisplay(entry.snapshot?.message || "Git reported an unresolved conflict."),
                )}</pre>
              </section>
            `,
          )
          .join("")}
      </div>
      <p class="message-box__text project-conflict-recovery__warning"><strong>We can resolve this problem by overwriting all changes on saved on this computer with the latest data from the server. Unless you have been working for many hours without an internet connection, this is usually quite safe.</strong></p>
      ${errorText ? `<p class="message-box__text project-conflict-recovery__runtime-error">${escapeHtml(formatErrorForDisplay(errorText))}</p>` : ""}
      <div class="project-conflict-recovery__actions">
        ${overwriteButton}
      </div>
    </div>
  `;
}

export function renderProjectsScreen(state) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId) ?? state.teams[0];
  const canManageProjects = selectedTeam?.canManageProjects === true;
  const canCreateProjects = shouldShowNewProjectButton(selectedTeam);
  const canPermanentlyDeleteFiles = canPermanentlyDeleteProjectFiles(selectedTeam);
  const canManageAiSettings = canManageTeamAiSettings(selectedTeam);
  const offlineMode = state.offline?.isEnabled === true;
  const pageWritesDisabled = areResourcePageWritesDisabled(state.projectsPage);
  const heavyActionsDisabled = pageWritesDisabled || anyProjectWriteIsActive();
  const mutatingWriteActionsDisabled = pageWritesDisabled || anyProjectMutatingWriteIsActive();
  const lifecycleActionsDisabled = areResourcePageWriteSubmissionsDisabled(state.projectsPage);
  const importInProgress = state.projectImport?.status === "importing";
  const discovery = state.projectDiscovery ?? { status: "idle", error: "", glossaryWarning: "" };
  const syncSnapshotsByProjectId = state.projectRepoSyncByProjectId ?? {};
  const recoveryMessage =
    typeof discovery.recoveryMessage === "string" && discovery.recoveryMessage.trim()
      ? discovery.recoveryMessage.trim()
      : "";
  const projectsSyncBadgeText = getScopedSyncBadgeText("projects");
  const searchModeActive = projectsSearchModeIsActiveForState(state);
  const glossaryChangesDisabled = importInProgress;
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
          : `<section class="stack project-card-stack">${state.projects
              .map((project) =>
                renderProjectCard(project, state.expandedProjects.has(project.id), {
                  canManageProjects,
                  canPermanentlyDeleteFiles,
                  offlineMode,
                  pageWritesDisabled,
                  heavyActionsDisabled,
                  addFilesWriteDisabled: mutatingWriteActionsDisabled,
                  lifecycleActionsDisabled,
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
      ${renderProjectRepoConflictRecovery(state, selectedTeam)}
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
  });

  return (
    pageShell({
      title: "Projects",
      subtitle: selectedTeam?.name ?? "Team",
      titleAction: buildPageRefreshAction(state, state.projectsPageSync, "refresh-page", {
        backgroundRefreshing: state.projectsPage?.isRefreshing === true || anyProjectWriteIsActive(),
      }),
      navButtons: buildSectionNav("projects", { includeAiSettings: canManageAiSettings }),
      leftTools: searchField,
      tools: [
        canCreateProjects
          ? primaryButton("+ New Project", "open-new-project", { disabled: offlineMode || mutatingWriteActionsDisabled })
          : "",
      ]
        .filter(Boolean)
        .join(""),
      pageSync: state.projectsPageSync,
      syncBadgeText: projectsSyncBadgeText,
      noticeText: getNoticeBadgeText(),
      statusItems: getStatusSurfaceItems("projects"),
      offlineMode,
      offlineReconnectState: state.offline?.reconnecting === true,
      body,
    }) +
    renderProjectCreationModal(state) +
    renderChapterPermanentDeletionModal(state) +
    renderChapterRenameModal(state) +
    renderProjectRenameModal(state) +
    renderProjectPermanentDeletionModal(state) +
    renderProjectImportModal(state) +
    renderProjectExportModal(state)
  );
}
