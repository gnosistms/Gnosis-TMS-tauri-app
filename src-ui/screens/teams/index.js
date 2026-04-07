import {
  buildPageRefreshAction,
  buildSectionNav,
  navButton,
  pageShell,
  primaryButton,
  secondaryButton,
} from "../../lib/ui.js";
import { renderTeamLeaveModal } from "./leave-modal.js";
import { renderTeamRenameModal } from "./rename-modal.js";
import { renderTeamPermanentDeletionModal } from "./permanent-delete-modal.js";
import { renderSetupModal } from "./setup-modal.js";
import { renderTeamsList } from "./team-list.js";
import {
  getNoticeBadgeText,
  getScopedSyncBadgeText,
} from "../../app/status-feedback.js";

export function renderTeamsScreen(state) {
  const offlineMode = state.offline?.isEnabled === true;
  const session = state.auth?.session ?? null;
  const updateAction =
    state.appUpdate?.available === true
      ? secondaryButton(
          state.appUpdate.status === "installing" ? "Installing..." : "Install Update",
          "install-app-update",
          { disabled: state.appUpdate.status === "installing" || state.appUpdate.status === "restarting" },
        )
      : "";
  const subtitle =
    (typeof session?.name === "string" && session.name.trim())
    || (typeof session?.login === "string" && session.login.trim())
    || "";

  return pageShell({
    title: "Translation Teams",
    subtitle,
    titleAction: buildPageRefreshAction(state),
    navButtons: buildSectionNav("teams"),
    tools: [updateAction, primaryButton("+ New Team", "open-new-team", { disabled: offlineMode })]
      .filter(Boolean)
      .join(""),
    pageSync: state.pageSync,
    syncBadgeText: getScopedSyncBadgeText("teams"),
    noticeText: getNoticeBadgeText(),
    offlineMode,
    offlineReconnectState: state.offline?.reconnecting === true,
    body: `<section class="stack">${renderTeamsList(
      state.teams,
      state.deletedTeams,
      state.showDeletedTeams,
      offlineMode,
    )}</section>`,
  }) +
  renderSetupModal(state) +
  renderTeamRenameModal(state) +
  renderTeamPermanentDeletionModal(state) +
  renderTeamLeaveModal(state);
}
