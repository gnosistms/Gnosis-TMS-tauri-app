import { projects, teams } from "../lib/data.js";
import {
  createSearchField,
  escapeHtml,
  navButton,
  pageShell,
  primaryButton,
  textAction,
} from "../lib/ui.js";

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
          ${textAction("Delete", "noop")}
        </div>
      </div>
      ${chapterRows}
    </article>
  `;
}

export function renderProjectsScreen(state) {
  const selectedTeam = teams.find((team) => team.id === state.selectedTeamId) ?? teams[0];

  return pageShell({
    title: `${selectedTeam.name} - Projects`,
    navButtons: [
      navButton("Logout", "start"),
      navButton("Teams", "teams"),
      navButton("Glossaries", "glossaries"),
    ],
    tools: `${createSearchField("Search")} ${primaryButton("+ New Project", "noop")}`,
    body: `<section class="stack">${projects
      .map((project) => renderProjectCard(project, state.expandedProjects.has(project.id)))
      .join("")}</section>`,
  });
}
