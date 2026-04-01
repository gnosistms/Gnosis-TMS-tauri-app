import { escapeHtml, sectionSeparator, textAction } from "../../lib/ui.js";

function renderAccessLabel(team) {
  if (team.canDelete) {
    return "owner access";
  }

  if (team.canLeave) {
    return "translator access";
  }

  return "restricted access";
}

function renderTeamCard(team, options = {}) {
  const isDeleted = options.isDeleted === true;
  const offlineMode = options.offlineMode === true;
  const actions = options.actions ?? [
    textAction("Open", `open-team:${team.id}`),
    textAction("Members", `open-team-users:${team.id}`, { disabled: offlineMode }),
    textAction("Rename", `rename-team:${team.id}`, { disabled: offlineMode }),
    textAction(team.canDelete ? "Delete" : "Leave", `delete-team:${team.id}`, { disabled: offlineMode }),
  ];

  return `
    <article class="card card--list-row ${isDeleted ? "card--deleted" : ""}">
      <div class="card__body list-row">
        <div class="list-row__content">
          <h2 class="list-row__title">
            <button class="list-row__title-button" data-action="open-team:${team.id}">
              ${escapeHtml(team.name)}
            </button>
          </h2>
          <p class="list-row__meta">@${escapeHtml(team.githubOrg)} · ${escapeHtml(renderAccessLabel(team))}</p>
        </div>
        <div class="list-row__actions">
          ${actions.join("")}
        </div>
      </div>
    </article>
  `;
}

function renderDeletedTeamsSection(deletedTeams, isOpen, offlineMode = false) {
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
        .map((team) =>
          renderTeamCard(team, {
            isDeleted: true,
            actions: [
              textAction("Open", `open-team:${team.id}`),
              textAction("Members", `open-team-users:${team.id}`, { disabled: offlineMode }),
              ...(team.canDelete
                ? [
                    textAction("Restore", `restore-team:${team.id}`, { disabled: offlineMode }),
                    textAction("Delete", `delete-deleted-team:${team.id}`, { disabled: offlineMode }),
                  ]
                : []),
            ],
            offlineMode,
          }),
        )
        .join("")}</section>
    </section>
  `;
}

export function renderTeamsList(activeTeams, deletedTeams = [], showDeletedTeams = false, offlineMode = false) {
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
    : activeTeams.map((team) => renderTeamCard(team, { offlineMode })).join("");

  return `
    <section class="stack">${activeSection}</section>
    ${renderDeletedTeamsSection(deletedTeams, showDeletedTeams, offlineMode)}
  `;
}
