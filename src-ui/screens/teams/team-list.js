import { escapeHtml, sectionSeparator, textAction } from "../../lib/ui.js";

function renderTeamCard(team, options = {}) {
  const actions = options.actions ?? [
    textAction("Open", `open-team:${team.id}`),
    textAction("Rename", `rename-team:${team.id}`),
    textAction("Delete", "noop"),
  ];

  return `
    <article class="card card--list-row">
      <div class="card__body list-row">
        <div class="list-row__content">
          <h2 class="list-row__title">${escapeHtml(team.name)}</h2>
          <p class="list-row__meta">@${escapeHtml(team.githubOrg)} · owner @${escapeHtml(team.ownerLogin)}${
            team.statusLabel ? ` · ${escapeHtml(team.statusLabel)}` : ""
          }</p>
        </div>
        <div class="list-row__actions">
          ${actions.join("")}
        </div>
      </div>
    </article>
  `;
}

function renderDeletedTeamsSection(deletedTeams, isOpen) {
  if (!deletedTeams.length) {
    return "";
  }

  const toggle = sectionSeparator({
    label: isOpen ? "Hide deleted teams" : "Show deleted teams",
    action: "toggle-deleted-teams",
    isOpen,
  });

  if (!isOpen) {
    return toggle;
  }

  return `
    ${toggle}
    <section class="stack stack--deleted-projects">
      <section class="stack">${deletedTeams
        .map((team) => renderTeamCard(team, { actions: [] }))
        .join("")}</section>
    </section>
  `;
}

export function renderTeamsList(activeTeams, deletedTeams = [], showDeletedTeams = false) {
  const activeSection = !activeTeams.length
    ? `
      <article class="card card--hero card--empty">
        <div class="card__body">
          <p class="card__eyebrow">NO TEAMS FOUND</p>
          <h2 class="card__title card__title--small">No teams found.</h2>
          <p class="card__subtitle">Click "+ New Team" to create a team.</p>
        </div>
      </article>
    `
    : activeTeams.map((team) => renderTeamCard(team)).join("");

  return `
    <section class="stack">${activeSection}</section>
    ${renderDeletedTeamsSection(deletedTeams, showDeletedTeams)}
  `;
}
