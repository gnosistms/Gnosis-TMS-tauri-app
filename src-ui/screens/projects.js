import {
  buildPageRefreshAction,
  buildSectionNav,
  createSearchField,
  escapeHtml,
  loadingButton,
  pageShell,
  primaryButton,
  renderStateCard,
  secondaryButton,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { buildProjectSearchSnippetMarkup } from "../app/project-search-highlighting.js";
import {
  buildProjectSearchTree,
  projectSearchVisibleResults,
  projectSearchWeakerToggleLabel,
  projectsSearchModeIsActiveForState,
  projectsSearchResultCountLabel,
} from "../app/project-search-state.js";
import { renderProjectCreationModal } from "./project-creation-modal.js";
import { renderChapterPermanentDeletionModal } from "./chapter-permanent-deletion-modal.js";
import { renderChapterRenameModal } from "./chapter-rename-modal.js";
import { renderProjectClearDeletedFilesModal } from "./project-clear-deleted-files-modal.js";
import { renderProjectPermanentDeletionModal } from "./project-permanent-deletion-modal.js";
import { renderProjectImportModal } from "./project-import-modal.js";
import { renderEditorExportModal } from "./editor-export-modal.js";
import { renderProjectAddTranslationModal } from "./project-add-translation-modal.js";
import { renderProjectRenameModal } from "./project-rename-modal.js";
import { renderProjectTransferModal } from "./project-transfer-modal.js";
import { renderProjectOldLayoutDiscardModal } from "./project-old-layout-discard-modal.js";
import {
  getNoticeBadgeText,
  getScopedSyncBadgeText,
  getStatusSurfaceItems,
} from "../app/status-feedback.js";
import { listProjectRepoFallbackConflictEntries } from "../app/project-repo-sync-shared.js";
import {
  canPermanentlyDeleteProjectFiles,
  canDownloadProjectFiles,
  canManageTeamAiSettings,
  canMutateProjectFiles,
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
import { getRepoWriteQueueSnapshot } from "../app/repo-write-queue.js";
import { renderDeletedProjectsSection } from "./project-deleted-section.js";
import { buildProjectsListItems } from "../app/projects-list-model.js";
import { resolveProjectsInitialWindowState } from "../app/projects-virtual-list.js";
import {
  createProjectsListRenderContext,
  renderProjectsVirtualList,
} from "./project-list-flat-render.js";

function projectSearchExcerptSourceLabel(source) {
  if (source === "footnote") {
    return "Footnote";
  }
  if (source === "image-caption") {
    return "Image caption";
  }
  return "Text";
}

function renderProjectSearchRow(row, searchQuery) {
  return `
    <article class="project-search-tree__row" data-project-search-row>
      ${(Array.isArray(row?.excerpts) ? row.excerpts : []).map((excerpt) => {
        const languageCode = typeof excerpt?.languageCode === "string" ? excerpt.languageCode.trim() : "";
        const languageName = excerpt?.languageName ?? languageCode;
        const snippetMarkup = buildProjectSearchSnippetMarkup(excerpt?.snippet ?? "", searchQuery, languageCode);
        return `
          <div class="project-search-tree__excerpt">
            <p class="project-search-tree__excerpt-meta">${escapeHtml(languageName)} · ${escapeHtml(projectSearchExcerptSourceLabel(excerpt?.snippetSource))}</p>
            <p class="project-search-result__snippet"${languageCode ? ` lang="${escapeHtml(languageCode)}"` : ""} dir="auto">${snippetMarkup}</p>
          </div>
        `;
      }).join("")}
    </article>
  `;
}

function renderProjectSearchChapter(chapter, search, projectIndex, chapterIndex) {
  const expanded = search.expandedChapterIds instanceof Set
    && search.expandedChapterIds.has(chapter.id);
  const panelId = `project-search-chapter-${projectIndex}-${chapterIndex}`;
  return `
    <section class="project-search-tree__chapter">
      <div class="project-search-tree__chapter-header">
        <button
          type="button"
          class="project-search-tree__disclosure project-search-tree__disclosure--chapter"
          data-action="toggle-project-search-chapter:${escapeHtml(chapter.id)}"
          aria-expanded="${expanded ? "true" : "false"}"
          aria-controls="${panelId}"
        >
          <span class="project-search-tree__chevron" aria-hidden="true">›</span>
          <span>${escapeHtml(chapter.title)}</span>
          <span class="project-search-tree__count">${escapeHtml(`${chapter.rowCount} row${chapter.rowCount === 1 ? "" : "s"}`)}</span>
        </button>
        <button
          type="button"
          class="text-action project-search-tree__open"
          data-action="open-project-search-chapter:${escapeHtml(chapter.id)}"
          aria-label="${escapeHtml(`Open ${chapter.title} and search for ${search.query ?? ""}`)}"
        >Open</button>
      </div>
      <div class="project-search-tree__rows" id="${panelId}"${expanded ? "" : " hidden"}>${expanded ? chapter.rows.map((row) => renderProjectSearchRow(row, search.query ?? "")).join("") : ""}</div>
    </section>
  `;
}

function renderProjectSearchProject(project, search, projectIndex) {
  const expanded = search.expandedProjectIds instanceof Set
    && search.expandedProjectIds.has(project.id);
  const panelId = `project-search-project-${projectIndex}`;
  return `
    <section class="card project-search-tree__project">
      <button
        type="button"
        class="project-search-tree__disclosure project-search-tree__disclosure--project"
        data-action="toggle-project-search-project:${escapeHtml(project.id)}"
        aria-expanded="${expanded ? "true" : "false"}"
        aria-controls="${panelId}"
      >
        <span class="project-search-tree__chevron" aria-hidden="true">›</span>
        <span>${escapeHtml(project.title)}</span>
        <span class="project-search-tree__count">${escapeHtml(`${project.rowCount} row${project.rowCount === 1 ? "" : "s"}`)}</span>
      </button>
      <div class="project-search-tree__chapters" id="${panelId}"${expanded ? "" : " hidden"}>${expanded ? project.chapters.map((chapter, chapterIndex) => renderProjectSearchChapter(chapter, search, projectIndex, chapterIndex)).join("") : ""}</div>
    </section>
  `;
}

function renderProjectSearchResults(state) {
  const search = state.projectsSearch ?? {};
  const visibleResults = projectSearchVisibleResults(search);
  const weakerToggle = Number(search.weakerTotal ?? 0) > 0
    ? secondaryButton(projectSearchWeakerToggleLabel(search), "toggle-project-search-weaker", {
      className: "project-search-results__weaker-button",
    })
    : "";
  const header = `
    <div class="project-search-results__toolbar">
      <div class="project-search-results__summary">
        <h2 class="project-search-results__title">Search results</h2>
        <p class="project-search-results__count">${escapeHtml(projectsSearchResultCountLabel(search))}</p>
      </div>
      ${weakerToggle}
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

  if (visibleResults.length === 0) {
    return (
      header +
      renderStateCard({
        eyebrow: "NO RESULTS",
        title: "No matches found.",
        subtitle: "",
      })
    );
  }

  const tree = buildProjectSearchTree(visibleResults);
  return `
    ${header}
    <section class="project-search-tree">
      ${tree.map((project, projectIndex) => renderProjectSearchProject(project, search, projectIndex)).join("")}
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
    ? loadingButton({
      label: "Overwrite and resolve",
      loadingLabel: "Overwriting...",
      action: "overwrite-conflicted-project-repos",
      isLoading: true,
      variant: "error",
      className: "project-conflict-recovery__button",
    })
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

function computeProjectsScreenFlags(state) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId) ?? state.teams[0];
  const canManageProjects = canMutateProjectFiles(selectedTeam);
  const canDownloadFiles = canDownloadProjectFiles(selectedTeam);
  const canCreateProjects = shouldShowNewProjectButton(selectedTeam);
  const canPermanentlyDeleteFiles = canPermanentlyDeleteProjectFiles(selectedTeam);
  const canManageAiSettings = canManageTeamAiSettings(selectedTeam);
  const offlineMode = state.offline?.isEnabled === true;
  const discovery = state.projectDiscovery ?? { status: "idle", error: "", glossaryWarning: "" };
  const discoveryLoading = discovery.status === "loading";
  const projectRepoQueueOperations = getRepoWriteQueueSnapshot().operations.filter(
    (operation) => !String(operation.kind ?? "").startsWith("editor:"),
  );
  const projectRepoQueueActive = projectRepoQueueOperations.length > 0;
  const projectMutatingRepoQueueActive = projectRepoQueueOperations.some(
    (operation) => operation.kind !== "projectRepoSync",
  );
  const pageWritesDisabled = areResourcePageWritesDisabled(state.projectsPage) || discoveryLoading;
  const heavyActionsDisabled = pageWritesDisabled || anyProjectWriteIsActive() || projectRepoQueueActive;
  const mutatingWriteActionsDisabled =
    pageWritesDisabled || anyProjectMutatingWriteIsActive() || projectMutatingRepoQueueActive;
  const lifecycleActionsDisabled = areResourcePageWriteSubmissionsDisabled(state.projectsPage);
  // Local hard-delete (clear/remove deleted files) is a local-only action; like Restore
  // it must stay available during a background refresh. Gate it on write submissions
  // (writeState), not on the broader pageWritesDisabled which also blocks while refreshing.
  const localHardDeleteActionsDisabled = lifecycleActionsDisabled;
  const importInProgress = state.projectImport?.status === "importing";
  const refreshInProgress =
    state.projectsPage?.isRefreshing === true
    || state.projectsPageSync?.status === "syncing"
    || discoveryLoading;
  const glossaryChangesDisabled = importInProgress;

  return {
    selectedTeam,
    canManageProjects,
    canDownloadFiles,
    canCreateProjects,
    canPermanentlyDeleteFiles,
    canManageAiSettings,
    offlineMode,
    discovery,
    discoveryLoading,
    pageWritesDisabled,
    heavyActionsDisabled,
    mutatingWriteActionsDisabled,
    lifecycleActionsDisabled,
    localHardDeleteActionsDisabled,
    importInProgress,
    refreshInProgress,
    glossaryChangesDisabled,
  };
}

/**
 * Flat item list + render context for the active projects stack. Shared by
 * the full screen render and the virtual list controller so scroll-driven
 * window renders produce identical markup.
 */
export function buildProjectsScreenListState(state) {
  const flags = computeProjectsScreenFlags(state);
  const items = buildProjectsListItems(state, {
    canPermanentlyDeleteFiles: flags.canPermanentlyDeleteFiles,
  });
  const context = createProjectsListRenderContext(state, {
    canManageProjects: flags.canManageProjects,
    canDownloadFiles: flags.canDownloadFiles,
    canPermanentlyDeleteFiles: flags.canPermanentlyDeleteFiles,
    offlineMode: flags.offlineMode,
    pageWritesDisabled: flags.pageWritesDisabled,
    heavyActionsDisabled: flags.heavyActionsDisabled,
    localHardDeleteActionsDisabled: flags.localHardDeleteActionsDisabled,
    addFilesWriteDisabled: flags.lifecycleActionsDisabled,
    lifecycleActionsDisabled: flags.lifecycleActionsDisabled,
    addFilesDisabled: flags.importInProgress,
    glossaryChangesDisabled: flags.glossaryChangesDisabled,
    glossaries: state.glossaries,
    suppressMissingLocalRepoRepair: flags.refreshInProgress,
  });

  return { items, context };
}

export function renderProjectsScreen(state) {
  const {
    selectedTeam,
    canCreateProjects,
    canManageAiSettings,
    offlineMode,
    discovery,
    discoveryLoading,
    mutatingWriteActionsDisabled,
    refreshInProgress,
  } = computeProjectsScreenFlags(state);
  const recoveryMessage =
    typeof discovery.recoveryMessage === "string" && discovery.recoveryMessage.trim()
      ? discovery.recoveryMessage.trim()
      : "";
  const projectsSyncBadgeText = getScopedSyncBadgeText("projects");
  const searchModeActive = projectsSearchModeIsActiveForState(state);
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
  const shouldShowLoadingState =
    discovery.status === "loading"
    || (
      state.projects.length === 0
      && refreshInProgress
      && discovery.status !== "error"
    );

  const { items: listItems, context: listRenderContext } = buildProjectsScreenListState(state);
  const projectsBody =
    shouldShowLoadingState
      ? loadingState
      : discovery.status === "error"
        ? errorState
        : state.projects.length === 0
          ? emptyState
          : renderProjectsVirtualList(
              listItems,
              listRenderContext,
              resolveProjectsInitialWindowState(state, listItems),
            );

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
        backgroundRefreshing:
          state.projectsPage?.isRefreshing === true
          || discoveryLoading,
        backgroundRefreshStartedAt: state.projectsPage?.refreshStartedAt,
        disableWhileSpinning: false,
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
    renderProjectTransferModal(state) +
    renderProjectPermanentDeletionModal(state) +
    renderProjectOldLayoutDiscardModal(state) +
    renderProjectClearDeletedFilesModal(state) +
    renderProjectImportModal(state) +
    renderProjectAddTranslationModal(state) +
    renderEditorExportModal(state)
  );
}
