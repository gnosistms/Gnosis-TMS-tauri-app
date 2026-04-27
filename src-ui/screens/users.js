import {
  buildPageRefreshAction,
  buildSectionNav,
  escapeHtml,
  pageShell,
  primaryButton,
  renderStateCard,
  textAction,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { canManageTeamAiSettings } from "../app/resource-capabilities.js";
import { getNoticeBadgeText, getStatusSurfaceItems } from "../app/status-feedback.js";
import {
  anyMemberWriteIsActive,
  getMemberWriteIntent,
  memberRoleIntentKey,
} from "../app/member-write-coordinator.js";
import {
  canCurrentUserLeaveTeam,
  canPromoteOwners,
  isOwnerRole,
} from "../app/team-member-permissions.js";
import { renderInviteUserModal } from "./invite-user-modal.js";
import { renderTeamMemberOwnerModal } from "./team-member-owner-modal.js";
import { renderTeamMemberRemoveModal } from "./team-member-remove-modal.js";
import { renderTeamLeaveModal } from "./teams/leave-modal.js";

function renderUserCard(user, options = {}) {
  const canManageMembers = options.canManageMembers === true;
  const canPromoteOwner = options.canPromoteOwners === true;
  const canLeaveTeam = options.canLeaveTeam === true;
  const selectedTeamId = options.selectedTeamId ?? "";
  const displayName = user.isCurrentUser ? `${user.name} (me)` : user.name;
  const pendingMutation = typeof user.pendingMutation === "string" ? user.pendingMutation : "";
  const roleWritePending = pendingMutation === "makeAdmin" || pendingMutation === "revokeAdmin";
  const roleWriteIntent = roleWritePending && selectedTeamId
    ? getMemberWriteIntent(memberRoleIntentKey(selectedTeamId, user.username))
    : null;
  const roleWriteAwaitingConfirmation = roleWriteIntent?.status === "pendingConfirmation";
  const roleSyncPending = user.roleSyncPending === true || Boolean(pendingMutation);
  const roleToggleDisabled = roleSyncPending && !roleWritePending;
  const conflictingActionDisabled = roleSyncPending && !roleWriteAwaitingConfirmation;
  const ownerRole = isOwnerRole(user);
  const displayRole = ownerRole ? "Owner" : user.role === "Admin" ? "Admin" : "Translator";
  const pendingLabel =
    pendingMutation === "promoteOwner"
      ? "Promoting..."
      : pendingMutation === "makeAdmin" || pendingMutation === "revokeAdmin" || user.roleSyncPending === true
        ? "Updating..."
        : "";
  const roleMeta = pendingLabel
    ? `${displayRole} · ${pendingLabel}`
    : displayRole;
  const actions = user.isCurrentUser
    ? (canLeaveTeam && selectedTeamId
        ? textAction("Leave", `open-current-team-leave:${selectedTeamId}`)
        : "")
    : (canManageMembers || canPromoteOwner
        ? [
            canManageMembers && displayRole === "Translator"
              ? textAction("Make Admin", `make-admin:${user.username}`, { disabled: roleToggleDisabled })
              : canManageMembers && displayRole === "Admin"
                ? textAction("Revoke Admin", `revoke-admin:${user.username}`, { disabled: roleToggleDisabled })
                : "",
            canPromoteOwner && !ownerRole
              ? textAction("Make owner", `open-team-member-owner-promotion:${user.username}`, {
                  disabled: conflictingActionDisabled,
                })
              : "",
            ownerRole || !canManageMembers
              ? ""
              : textAction("Remove", `open-team-member-removal:${user.username}`, {
                  disabled: conflictingActionDisabled,
                }),
          ].filter(Boolean).join("")
        : "")
    ;

  return `
    <article class="card card--list-row">
      <div class="card__body list-row">
        <div class="list-row__main">
          <div class="list-row__content">
            <h2 class="list-row__title">${escapeHtml(displayName)}</h2>
            <p class="list-row__meta">@${escapeHtml(user.username)} · ${escapeHtml(roleMeta)}</p>
          </div>
          <div class="list-row__actions">
            ${actions}
          </div>
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
  const canPromoteTeamOwners = canPromoteOwners(selectedTeam, { offline: state.offline?.isEnabled === true });
  const canLeaveTeam = canCurrentUserLeaveTeam(selectedTeam, state.users, {
    offline: state.offline?.isEnabled === true,
  });
  const canManageAiSettings = canManageTeamAiSettings(selectedTeam);

  const emptyState = renderStateCard({
    eyebrow: "NO MEMBERS FOUND",
    title: "This team doesn't have any members yet.",
  });
  const loadingState = renderStateCard({
    eyebrow: "LOADING MEMBERS",
    title: "Loading members...",
  });
  const errorState = renderStateCard({
    eyebrow: "MEMBER LOAD FAILED",
    title: "Could not load this team's members.",
    subtitle: formatErrorForDisplay(discovery.error || "Unknown error."),
    tone: "error",
  });

  const body =
    discovery.status === "error"
        ? errorState
        : state.users.length === 0
          ? discovery.status === "loading"
            ? loadingState
            : emptyState
          : `<section class="stack">${state.users.map((user) => renderUserCard(user, {
              canManageMembers,
              canPromoteOwners: canPromoteTeamOwners,
              canLeaveTeam,
              selectedTeamId: selectedTeam?.id ?? "",
            })).join("")}</section>`;

  return (
    pageShell({
      title: "Members",
      subtitle: selectedTeam?.name ?? "Team",
      titleAction: buildPageRefreshAction(state, state.pageSync, "refresh-page", {
        backgroundRefreshing: state.membersPage?.isRefreshing === true || anyMemberWriteIsActive(),
      }),
      navButtons: buildSectionNav("users", { includeAiSettings: canManageAiSettings }),
      tools: `${primaryButton("+ Invite People", "open-invite-user", { disabled: !canInviteUsers })}`,
      pageSync: state.pageSync,
      noticeText: getNoticeBadgeText(),
      statusItems: getStatusSurfaceItems("members"),
      offlineMode: state.offline?.isEnabled === true,
      offlineReconnectState: state.offline?.reconnecting === true,
      body,
    }) + renderInviteUserModal(state) + renderTeamLeaveModal(state) + renderTeamMemberRemoveModal(state) + renderTeamMemberOwnerModal(state)
  );
}
