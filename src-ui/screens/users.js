import { escapeHtml, navButton, pageShell, primaryButton, textAction } from "../lib/ui.js";
import { getNoticeBadgeText } from "../app/status-feedback.js";
import { renderInviteUserModal } from "./invite-user-modal.js";
import { renderTeamLeaveModal } from "./teams/leave-modal.js";

function renderUserCard(user, options = {}) {
  const canManageMembers = options.canManageMembers === true;
  const canLeaveTeam = options.canLeaveTeam === true;
  const selectedTeamId = options.selectedTeamId ?? "";
  const displayName = user.isCurrentUser ? `${user.name} (me)` : user.name;
  const actions = user.isCurrentUser
    ? (canLeaveTeam && selectedTeamId
        ? textAction("Leave", `open-current-team-leave:${selectedTeamId}`)
        : "")
    : (canManageMembers
        ? user.role === "Translator"
          ? textAction("Make Admin", `make-admin:${user.username}`)
          : user.role === "Admin"
            ? textAction("Revoke Admin", `revoke-admin:${user.username}`)
            : ""
        : "");

  return `
    <article class="card card--list-row">
      <div class="card__body list-row">
        <div class="list-row__content">
          <h2 class="list-row__title">${escapeHtml(displayName)}</h2>
          <p class="list-row__meta">@${escapeHtml(user.username)} · ${escapeHtml(user.role)}</p>
        </div>
        <div class="list-row__actions">
          ${actions}
        </div>
      </div>
    </article>
  `;
}

export function renderUsersScreen(state) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId) ?? state.teams[0];
  const discovery = state.userDiscovery ?? { status: "idle", error: "" };
  const canInviteUsers = selectedTeam?.canManageMembers === true && !state.offline?.isEnabled;
  const canManageMembers = selectedTeam?.canManageMembers === true && !state.offline?.isEnabled;
  const canLeaveTeam = selectedTeam?.canLeave === true && selectedTeam?.canDelete !== true && !state.offline?.isEnabled;

  const emptyState = `
    <article class="card card--hero card--empty">
      <div class="card__body">
        <p class="card__eyebrow">NO MEMBERS FOUND</p>
        <h2 class="card__title card__title--small">This team doesn't have any members yet.</h2>
      </div>
    </article>
  `;
  const loadingState = `
    <article class="card card--hero card--empty">
      <div class="card__body">
        <p class="card__eyebrow">LOADING MEMBERS</p>
        <h2 class="card__title card__title--small">Loading members...</h2>
      </div>
    </article>
  `;
  const errorState = `
    <article class="card card--hero card--empty">
      <div class="card__body">
        <p class="card__eyebrow">MEMBER LOAD FAILED</p>
        <h2 class="card__title card__title--small">Could not load this team's members.</h2>
        <p class="card__subtitle">${escapeHtml(discovery.error || "Unknown error.")}</p>
      </div>
    </article>
  `;

  const body =
    discovery.status === "error"
        ? errorState
        : state.users.length === 0
          ? discovery.status === "loading"
            ? loadingState
            : emptyState
          : `<section class="stack">${state.users.map((user) => renderUserCard(user, {
              canManageMembers,
              canLeaveTeam,
              selectedTeamId: selectedTeam?.id ?? "",
            })).join("")}</section>`;

  return (
    pageShell({
      title: "Members",
      subtitle: selectedTeam?.name ?? "Team",
      navButtons: [
        navButton("Logout", "start"),
        navButton("Teams", "teams"),
        navButton("Projects", "projects"),
        navButton("Glossaries", "glossaries"),
      ],
      tools: `${primaryButton("+ Invite People", "open-invite-user", { disabled: !canInviteUsers })}`,
      pageSync: state.pageSync,
      noticeText: getNoticeBadgeText(),
      offlineMode: state.offline?.isEnabled === true,
      offlineReconnectState: state.offline?.reconnecting === true,
      body,
    }) + renderInviteUserModal(state) + renderTeamLeaveModal(state)
  );
}
