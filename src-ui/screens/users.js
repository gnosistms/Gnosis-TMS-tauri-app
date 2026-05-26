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
  MEMBER_ROLE_OPTIONS,
  MIN_OWNER_COUNT_MESSAGE,
  normalizeOrganizationMemberRole,
  OWNER_SELF_ROLE_CHANGE_TOOLTIP,
} from "../app/member-shared.js";
import {
  anyMemberWriteIsActive,
  getMemberWriteIntent,
  memberRoleIntentKey,
} from "../app/member-write-coordinator.js";
import {
  canCurrentUserLeaveTeam,
  canPromoteOwners,
  countOwners,
  isOwnerRole,
} from "../app/team-member-permissions.js";
import { renderInviteUserModal } from "./invite-user-modal.js";
import { renderTeamMemberOwnerDemotionModal } from "./team-member-owner-demotion-modal.js";
import { renderTeamMemberOwnerModal } from "./team-member-owner-modal.js";
import { renderTeamMemberRemoveModal } from "./team-member-remove-modal.js";
import { renderTeamLeaveModal } from "./teams/leave-modal.js";

function renderMemberRoleOptions(selectedRole) {
  return MEMBER_ROLE_OPTIONS.map((role) =>
    `<option value="${escapeHtml(role)}"${role === selectedRole ? " selected" : ""}>${escapeHtml(role)}</option>`
  ).join("");
}

function renderMemberRoleSelect(user, options = {}) {
  const displayRole = normalizeOrganizationMemberRole(user.role);
  const disabled = options.disabled === true;
  const tooltip = typeof options.tooltip === "string" && options.tooltip.trim()
    ? options.tooltip.trim()
    : "";
  const tooltipAttributes = tooltip
    ? ` title="${escapeHtml(tooltip)}" aria-description="${escapeHtml(tooltip)}"`
    : "";
  return `
    <label class="member-role-control"${tooltipAttributes}>
      <select
        class="field__select member-role-select"
        data-member-role-select
        data-member-username="${escapeHtml(user.username)}"
        aria-label="Account type for ${escapeHtml(user.username)}"
        ${tooltip ? `title="${escapeHtml(tooltip)}"` : ""}
        ${disabled ? "disabled" : ""}
      >
        ${renderMemberRoleOptions(displayRole)}
      </select>
    </label>
  `;
}

function renderUserCard(user, options = {}) {
  const canManageMembers = options.canManageMembers === true;
  const canManageRoles = options.canManageRoles === true;
  const canLeaveTeam = options.canLeaveTeam === true;
  const selectedTeamId = options.selectedTeamId ?? "";
  const ownerCount = Number.isFinite(options.ownerCount) ? options.ownerCount : 0;
  const displayName = user.isCurrentUser ? `${user.name} (me)` : user.name;
  const pendingMutation = typeof user.pendingMutation === "string" ? user.pendingMutation : "";
  const roleWritePending =
    pendingMutation === "makeAdmin" || pendingMutation === "revokeAdmin" || pendingMutation === "updateRole";
  const roleWriteIntent = selectedTeamId
    ? getMemberWriteIntent(memberRoleIntentKey(selectedTeamId, user.username))
    : null;
  const roleWriteActive = roleWriteIntent?.status === "pending" || roleWriteIntent?.status === "running";
  const roleWriteAwaitingConfirmation = roleWriteIntent?.status === "pendingConfirmation";
  const roleSyncPending = user.roleSyncPending === true || Boolean(pendingMutation);
  const roleSelectDisabled = roleWriteActive || (roleSyncPending && !roleWritePending);
  const conflictingActionDisabled = roleSyncPending && !roleWriteAwaitingConfirmation;
  const ownerRole = isOwnerRole(user);
  const displayRole = normalizeOrganizationMemberRole(user.role);
  const pendingLabel =
    pendingMutation === "promoteOwner"
      ? "Promoting..."
      : pendingMutation === "makeAdmin" || pendingMutation === "revokeAdmin" || pendingMutation === "updateRole" || user.roleSyncPending === true
        ? "Updating..."
        : "";
  const roleMeta = pendingLabel
    ? `${displayRole} · ${pendingLabel}`
    : displayRole;
  const lastOwnerBlocked = ownerRole && ownerCount <= 1;
  const currentOwnerWithPeerOwners = user.isCurrentUser && ownerRole && ownerCount > 1 && canManageRoles;
  const roleDropdown = (!user.isCurrentUser && canManageRoles) || currentOwnerWithPeerOwners
    ? renderMemberRoleSelect(user, {
        disabled: currentOwnerWithPeerOwners || roleSelectDisabled || lastOwnerBlocked,
        tooltip: currentOwnerWithPeerOwners ? OWNER_SELF_ROLE_CHANGE_TOOLTIP : "",
      })
    : "";
  const removeDisabled = conflictingActionDisabled || lastOwnerBlocked;
  const removeTooltip = lastOwnerBlocked ? MIN_OWNER_COUNT_MESSAGE : "";
  const actions = user.isCurrentUser
    ? [
        roleDropdown,
        canLeaveTeam && selectedTeamId
          ? textAction("Leave team", `open-current-team-leave:${selectedTeamId}`)
          : "",
      ].filter(Boolean).join("")
    : (canManageMembers || canManageRoles
        ? [
            roleDropdown,
            !canManageMembers
              ? ""
              : textAction("Remove", `open-team-member-removal:${user.username}`, {
                  disabled: removeDisabled,
                  tooltip: removeTooltip,
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
  const canManageRoles = canPromoteTeamOwners;
  const ownerCount = countOwners(state.users);
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
              canManageRoles,
              canPromoteOwners: canPromoteTeamOwners,
              canLeaveTeam,
              selectedTeamId: selectedTeam?.id ?? "",
              ownerCount,
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
    }) + renderInviteUserModal(state) + renderTeamLeaveModal(state) + renderTeamMemberRemoveModal(state) + renderTeamMemberOwnerModal(state) + renderTeamMemberOwnerDemotionModal(state)
  );
}
