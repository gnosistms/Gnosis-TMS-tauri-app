import { errorButton, escapeHtml, sectionSeparator, textAction } from "../../lib/ui.js";

function renderAccessLabel(team) {
  if (team.canDelete) {
    return "owner access";
  }

  if (team.canManageMembers || team.canManageProjects) {
    return "admin access";
  }

  if (team.canLeave) {
    return "translator access";
  }

  return "restricted access";
}

function renderTeamCard(team, options = {}) {
  const isDeleted = options.isDeleted === true;
  const offlineMode = options.offlineMode === true;
  const missingPermissions = Array.isArray(team.missingAppPermissions)
    ? team.missingAppPermissions.join(", ")
    : "";
  const approvalWarning =
    team.needsAppApproval === true
      ? `
        <div class="message-box message-box--error list-row__warning-box">
          <p class="list-row__warning message-box__text">${escapeHtml(
            missingPermissions
              ? `GitHub App update required. Missing: ${missingPermissions}`
              : "GitHub App update required for this team.",
          )}</p>
          ${
            team.canDelete
              ? team.appApprovalUrl
                ? errorButton("Update GitHub Permissions", `open-external:${team.appApprovalUrl}`)
                : ""
              : `<p class="list-row__warning-help message-box__text">${escapeHtml(
                  "Contact the owner of this team. Ask them to run Gnosis TMS and update GitHub permissions for this team on the Teams page.",
                )}</p>`
          }
        </div>
      `
      : "";
  const actions = options.actions ?? [
    textAction("Projects", `open-team:${team.id}`),
    textAction("Glossaries", `open-team-glossaries:${team.id}`),
    textAction("Members", `open-team-users:${team.id}`, { disabled: offlineMode }),
    ...(team.canDelete ? [textAction("Rename", `rename-team:${team.id}`, { disabled: offlineMode })] : []),
    textAction(
      team.canDelete ? "Delete" : "Leave",
      `${team.canDelete ? "delete-team" : "leave-team"}:${team.id}`,
      { disabled: offlineMode },
    ),
  ];

  return `
    <article class="card card--list-row ${isDeleted ? "card--deleted" : ""}">
      <div class="card__body list-row">
        <div class="list-row__main">
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
        ${approvalWarning}
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
              textAction("Projects", `open-team:${team.id}`),
              textAction("Glossaries", `open-team-glossaries:${team.id}`),
              textAction("Members", `open-team-users:${team.id}`, { disabled: offlineMode }),
              ...(team.canDelete === true
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
          <p class="card__eyebrow">TEAMS LIST</p>
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
