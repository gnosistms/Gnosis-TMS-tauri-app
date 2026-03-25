import { escapeHtml, textAction } from "../../lib/ui.js";

export function renderTeamsList(teams) {
  if (!teams.length) {
    return `
      <article class="card card--hero card--empty">
        <div class="card__body">
          <p class="card__eyebrow">NO TEAMS FOUND</p>
          <h2 class="card__title card__title--small">No teams found.</h2>
          <p class="card__subtitle">Click "+ New Team" to create a team.</p>
        </div>
      </article>
    `;
  }

  return teams
    .map(
      (team) => `
        <article class="card card--list-row">
          <div class="card__body list-row">
            <div class="list-row__content">
              <h2 class="list-row__title">${escapeHtml(team.name)}</h2>
              <p class="list-row__meta">@${escapeHtml(team.githubOrg)} · owner @${escapeHtml(team.ownerLogin)}${
                team.statusLabel ? ` · ${escapeHtml(team.statusLabel)}` : ""
              }</p>
            </div>
            <div class="list-row__actions">
              ${textAction("Open", `open-team:${team.id}`)}
              ${textAction("Rename", `rename-team:${team.id}`)}
              ${textAction("Delete", "noop")}
            </div>
          </div>
        </article>
      `,
    )
    .join("");
}
