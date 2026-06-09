import {
  buildPageRefreshAction,
  buildSectionNav,
  createSearchField,
  escapeHtml,
  pageShell,
  primaryButton,
  renderStateCard,
  secondaryButton,
  textAction,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { buildProjectSearchSnippetMarkup } from "../app/project-search-highlighting.js";
import { projectsSearchModeIsActiveForState, projectsSearchResultCountLabel } from "../app/project-search-state.js";
import { renderProjectCreationModal } from "./project-creation-modal.js";
import { renderChapterPermanentDeletionModal } from "./chapter-permanent-deletion-modal.js";
import { renderChapterRenameModal } from "./chapter-rename-modal.js";
import { renderProjectClearDeletedFilesModal } from "./project-clear-deleted-files-modal.js";
import { renderProjectPermanentDeletionModal } from "./project-permanent-deletion-modal.js";
import { renderProjectImportModal } from "./project-import-modal.js";
import { renderProjectExportModal } from "./project-export-modal.js";
import { renderProjectAddTranslationModal } from "./project-add-translation-modal.js";
import { renderProjectRenameModal } from "./project-rename-modal.js";
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
import { renderProjectCard } from "./project-list-render.js";

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
  const shouldShowLoadingState =
    discovery.status === "loading"
    || (
      state.projects.length === 0
      && refreshInProgress
      && discovery.status !== "error"
    );

  const projectsBody =
    shouldShowLoadingState
      ? loadingState
      : discovery.status === "error"
        ? errorState
        : state.projects.length === 0
          ? emptyState
          : `<section class="stack project-card-stack">${state.projects
              .map((project) =>
                renderProjectCard(project, state.expandedProjects.has(project.id), {
                  canManageProjects,
                  canDownloadFiles,
                  canPermanentlyDeleteFiles,
                  offlineMode,
                  pageWritesDisabled,
                  heavyActionsDisabled,
                  localHardDeleteActionsDisabled,
                  addFilesWriteDisabled: lifecycleActionsDisabled,
                  lifecycleActionsDisabled,
                  addFilesDisabled: importInProgress,
                  glossaryChangesDisabled,
                  showDeletedFiles: state.expandedDeletedFiles.has(project.id),
                  glossaries: state.glossaries,
                  syncSnapshot: syncSnapshotsByProjectId[project.id] ?? null,
                  suppressMissingLocalRepoRepair: refreshInProgress,
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
    renderProjectPermanentDeletionModal(state) +
    renderProjectOldLayoutDiscardModal(state) +
    renderProjectClearDeletedFilesModal(state) +
    renderProjectImportModal(state) +
    renderProjectAddTranslationModal(state) +
    renderProjectExportModal(state)
  );
}
