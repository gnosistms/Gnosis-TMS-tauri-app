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
import { renderProjectPermanentDeletionModal } from "./project-permanent-deletion-modal.js";
import { renderProjectRenameModal } from "./project-rename-modal.js";
import {
  getNoticeBadgeText,
  getScopedSyncBadgeText,
} from "../app/status-feedback.js";

function renderProjectCard(project, expanded, options = {}) {
  const canManageProjects = options.canManageProjects !== false;
  const isDeleted = options.isDeleted === true;
  const offlineMode = options.offlineMode === true;
  const deleteAction = options.deleteAction ?? `delete-project:${project.id}`;
  const actions =
    options.actions ??
    [
      textAction("Add files", "noop", { disabled: offlineMode }),
      canManageProjects
        ? textAction("Rename", `rename-project:${project.id}`, { disabled: offlineMode })
        : "",
      canManageProjects ? textAction("Delete", deleteAction, { disabled: offlineMode }) : "",
    ].filter(Boolean);
  const chapterCount = `${project.chapters.length} chapter${
    project.chapters.length === 1 ? "" : "s"
  }`;

  const chapterRows = expanded
    ? `
      <div class="expandable-card__body">
        <div class="chapter-table">
          ${project.chapters
            .map(
              (chapter) => `
                <div class="chapter-table__row">
                  <div class="chapter-table__name">${escapeHtml(chapter.name)}</div>
                  <div class="chapter-table__glossary">
                    <button class="glossary-pill" data-action="open-glossaries">${escapeHtml(
                      chapter.glossary,
                    )} <span>⌄</span></button>
                  </div>
                  <div class="chapter-table__actions">
                    ${textAction("Open", `open-translate:${chapter.id}`)}
                    ${textAction("Download", "noop")}
                    ${textAction("Rename", "noop")}
                    ${textAction("Delete", "noop")}
                  </div>
                </div>
              `,
            )
            .join("")}
        </div>
      </div>
    `
    : "";

  return `
    <article class="card card--expandable ${expanded ? "is-expanded" : ""} ${
      isDeleted ? "card--deleted" : ""
    }">
      <div class="expandable-card__header">
        <button class="chevron-button" data-action="toggle-project:${project.id}">
          <span class="chevron ${expanded ? "is-open" : ""}"></span>
        </button>
        <div class="expandable-card__title-wrap">
          <h2 class="expandable-card__title">${escapeHtml(project.title ?? project.name)}</h2>
          <span class="expandable-card__meta">${escapeHtml(chapterCount)}</span>
        </div>
        <div class="expandable-card__actions">
          ${actions.join("")}
        </div>
      </div>
      ${chapterRows}
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
  const offlineMode = state.offline?.isEnabled === true;
  const discovery = state.projectDiscovery ?? { status: "idle", error: "" };
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
                  offlineMode,
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
      spinning: state.pageSync?.status === "syncing",
      disabled: offlineMode || state.pageSync?.status === "syncing",
    }),
    navButtons: [
      navButton("Logout", "start"),
      navButton("Teams", "teams"),
      navButton("Members", "users"),
      navButton("Glossaries", "glossaries"),
    ],
    leftTools: createSearchField("Search"),
    tools:
      canManageProjects
        ? primaryButton("+ New Project", "open-new-project", { disabled: offlineMode })
        : "",
    pageSync: state.pageSync,
    syncBadgeText: getScopedSyncBadgeText("projects"),
    noticeText: getNoticeBadgeText(),
    offlineMode,
    offlineReconnectState: state.offline?.reconnecting === true,
    body,
    }) +
    renderProjectCreationModal(state) +
    renderProjectRenameModal(state) +
    renderProjectPermanentDeletionModal(state)
  );
}
