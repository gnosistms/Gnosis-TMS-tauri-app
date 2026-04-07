import {
  createSearchField,
  escapeHtml,
  navButton,
  pageShell,
  primaryButton,
  sectionSeparator,
  textAction,
  titleRefreshButton,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
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

function renderProjectCard(project, expanded, options = {}) {
  const canManageProjects = options.canManageProjects !== false;
  const canPermanentlyDeleteFiles = options.canPermanentlyDeleteFiles === true;
  const isDeleted = options.isDeleted === true;
  const offlineMode = options.offlineMode === true;
  const deleteAction = options.deleteAction ?? `delete-project:${project.id}`;
  const addFilesDisabled = options.addFilesDisabled === true;
  const allFiles = Array.isArray(project.chapters) ? project.chapters : [];
  const files = allFiles.filter((chapter) => chapter?.status !== "deleted").sort(compareFilesByName);
  const deletedFiles = allFiles.filter((chapter) => chapter?.status === "deleted").sort(compareFilesByName);
  const showDeletedFiles = options.showDeletedFiles === true;
  const actions =
    options.actions ??
    [
      textAction("Add files", `add-project-files:${project.id}`, {
        disabled: offlineMode || addFilesDisabled,
      }),
      canManageProjects
        ? textAction("Rename", `rename-project:${project.id}`, { disabled: offlineMode })
        : "",
      canManageProjects ? textAction("Delete", deleteAction, { disabled: offlineMode }) : "",
    ].filter(Boolean);
  const fileCount = `${files.length} file${
    files.length === 1 ? "" : "s"
  }`;

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
                <div class="chapter-table__row chapter-table__row--file">
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
                    ${textAction("Open", `open-translate:${chapter.id}`)}
                    ${textAction("Rename", `rename-file:${chapter.id}`)}
                    ${textAction("Delete", `delete-file:${chapter.id}`)}
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
                                  ${textAction("Restore", `restore-file:${chapter.id}`, { disabled: offlineMode })}
                                  ${canPermanentlyDeleteFiles ? textAction("Delete", `delete-deleted-file:${chapter.id}`, { disabled: offlineMode }) : ""}
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
          class="expandable-card__summary-button"
          data-action="toggle-project:${project.id}"
          aria-expanded="${expanded ? "true" : "false"}"
        >
          <span class="chevron ${expanded ? "is-open" : ""}"></span>
          <span class="expandable-card__title-wrap">
            <span class="expandable-card__title">${escapeHtml(project.title ?? project.name)}</span>
            <span class="expandable-card__meta">${escapeHtml(fileCount)}</span>
          </span>
        </button>
        <div class="expandable-card__actions">
          ${actions.join("")}
        </div>
      </div>
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
  const canPermanentlyDeleteProjects = selectedTeam?.canDelete === true;
  const offlineMode = state.offline?.isEnabled === true;

  const toggle = renderDeletedProjectsToggle(state);
  if (!state.showDeletedProjects) {
    return toggle;
  }

  return `
    ${toggle}
    <section class="stack stack--deleted-projects">
      <section class="stack">${state.deletedProjects
        .map((project) =>
          renderProjectCard(project, state.expandedProjects.has(project.id), {
            canManageProjects: canManageDeletedProjects,
            isDeleted: true,
            offlineMode,
            actions: canManageDeletedProjects
              ? [
                  textAction("Restore", `restore-project:${project.id}`, { disabled: offlineMode }),
                  ...(canPermanentlyDeleteProjects
                    ? [textAction("Delete", `delete-deleted-project:${project.id}`, { disabled: offlineMode })]
                    : []),
                ]
              : [],
          }),
        )
        .join("")}</section>
    </section>
  `;
}

export function renderProjectsScreen(state) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId) ?? state.teams[0];
  const canManageProjects = selectedTeam?.canManageProjects === true;
  const canPermanentlyDeleteFiles = selectedTeam?.canDelete === true;
  const offlineMode = state.offline?.isEnabled === true;
  const importInProgress = state.projectImport?.status === "importing";
  const discovery = state.projectDiscovery ?? { status: "idle", error: "" };
  const projectsSyncBadgeText = getScopedSyncBadgeText("projects");
  const isProjectsSyncing = state.projectsPageSync?.status === "syncing";
  const emptyState = `
    <article class="card card--hero card--empty">
      <div class="card__body">
        <p class="card__eyebrow">NO PROJECTS FOUND</p>
        <h2 class="card__title card__title--small">This team doesn't have any projects yet.</h2>
        <p class="card__subtitle">Click + New Project to create one.</p>
      </div>
    </article>
  `;
  const loadingState = `
    <article class="card card--hero card--empty">
      <div class="card__body">
        <p class="card__eyebrow">LOADING PROJECTS</p>
        <h2 class="card__title card__title--small">Loading projects...</h2>
      </div>
    </article>
  `;
  const errorState = `
    <article class="card card--hero card--empty">
      <div class="card__body">
        <p class="card__eyebrow">PROJECT LOAD FAILED</p>
        <h2 class="card__title card__title--small">Could not load this team's projects.</h2>
        <p class="card__subtitle">${escapeHtml(formatErrorForDisplay(discovery.error || "Unknown error."))}</p>
      </div>
    </article>
  `;

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
                }),
              )
              .join("")}</section>`;

  const body = `
    <section class="stack">
      ${projectsBody}
      ${renderDeletedProjectsSection(state)}
    </section>
  `;

  return (
    pageShell({
    title: "Projects",
    subtitle: selectedTeam?.name ?? "Team",
    titleAction: titleRefreshButton("refresh-page", {
      spinning: isProjectsSyncing,
      disabled: offlineMode || isProjectsSyncing,
    }),
    navButtons: [
      navButton("Logout", "start"),
      navButton("Teams", "teams"),
      navButton("Members", "users"),
      navButton("Glossaries", "glossaries"),
    ],
    leftTools: createSearchField("Search"),
    tools: [
      canManageProjects
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
    renderProjectCreationModal(state) +
    renderChapterPermanentDeletionModal(state) +
    renderChapterRenameModal(state) +
    renderProjectRenameModal(state) +
    renderProjectPermanentDeletionModal(state)
  );
}
