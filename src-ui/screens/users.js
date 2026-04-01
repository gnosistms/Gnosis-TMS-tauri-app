import { escapeHtml, navButton, pageShell, primaryButton, textAction } from "../lib/ui.js";
import { getNoticeBadgeText } from "../app/status-feedback.js";

function renderUserCard(user) {
  return `
    <article class="card card--list-row">
      <div class="card__body list-row">
        <div class="list-row__content">
          <h2 class="list-row__title">${escapeHtml(user.name)}</h2>
          <p class="list-row__meta">@${escapeHtml(user.username)} · ${escapeHtml(user.role)}</p>
        </div>
        <div class="list-row__actions">
          ${textAction("Remove", "noop", { disabled: user.role === "Owner" })}
        </div>
      </div>
    </article>
  `;
}

export function renderUsersScreen(state) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId) ?? state.teams[0];
  const discovery = state.userDiscovery ?? { status: "idle", error: "" };

  const emptyState = `
    <article class="card card--hero card--empty">
      <div class="card__body">
        <p class="card__eyebrow">NO USERS FOUND</p>
        <h2 class="card__title card__title--small">This team doesn't have any users yet.</h2>
      </div>
    </article>
  `;
  const loadingState = `
    <article class="card card--hero card--empty">
      <div class="card__body">
        <p class="card__eyebrow">LOADING USERS</p>
        <h2 class="card__title card__title--small">Loading users...</h2>
      </div>
    </article>
  `;
  const errorState = `
    <article class="card card--hero card--empty">
      <div class="card__body">
        <p class="card__eyebrow">USER LOAD FAILED</p>
        <h2 class="card__title card__title--small">Could not load this team's users.</h2>
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
          : `<section class="stack">${state.users.map((user) => renderUserCard(user)).join("")}</section>`;

  return pageShell({
    title: "Users",
    subtitle: selectedTeam?.name ?? "Team",
    navButtons: [
      navButton("Logout", "start"),
      navButton("Teams", "teams"),
      navButton("Projects", "projects"),
      navButton("Glossaries", "glossaries"),
    ],
    tools: `${primaryButton("+ Invite User", "noop")}`,
    pageSync: state.pageSync,
    noticeText: getNoticeBadgeText(),
    offlineMode: state.offline?.isEnabled === true,
    offlineReconnectState: state.offline?.reconnecting === true,
    body,
  });
}
