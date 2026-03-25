import {
  createSearchField,
  escapeHtml,
  navButton,
  pageShell,
  primaryButton,
  textAction,
} from "../lib/ui.js";
import { renderProjectCreationModal } from "./project-creation-modal.js";
import { renderProjectDeletionModal } from "./project-deletion-modal.js";

function renderProjectCard(project, expanded) {
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
    <article class="card card--expandable ${expanded ? "is-expanded" : ""}">
      <div class="expandable-card__header">
        <button class="chevron-button" data-action="toggle-project:${project.id}">
          <span class="chevron ${expanded ? "is-open" : ""}"></span>
        </button>
        <div class="expandable-card__title-wrap">
          <h2 class="expandable-card__title">${escapeHtml(project.name)}</h2>
          <span class="expandable-card__meta">${escapeHtml(chapterCount)}</span>
        </div>
        <div class="expandable-card__actions">
          ${textAction("Rename", "noop")}
          ${textAction("Import", "noop")}
          ${textAction("Delete", `delete-project:${project.id}`)}
        </div>
      </div>
      ${chapterRows}
    </article>
  `;
}

export function renderProjectsScreen(state) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId) ?? state.teams[0];
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
        <p class="card__subtitle">${escapeHtml(discovery.error || "Unknown error.")}</p>
      </div>
    </article>
  `;

  const body =
    discovery.status === "loading"
      ? loadingState
      : discovery.status === "error"
        ? errorState
        : state.projects.length === 0
          ? emptyState
          : `<section class="stack">${state.projects
              .map((project) => renderProjectCard(project, state.expandedProjects.has(project.id)))
              .join("")}</section>`;

  return (
    pageShell({
    title: `${selectedTeam?.name ?? "Team"} - Projects`,
    navButtons: [
      navButton("Logout", "start"),
      navButton("Teams", "teams"),
      navButton("Users", "users"),
      navButton("Glossaries", "glossaries"),
    ],
    tools: `${createSearchField("Search")} ${primaryButton("+ New Project", "open-new-project")}`,
    body,
    }) + renderProjectCreationModal(state) + renderProjectDeletionModal(state)
  );
}
