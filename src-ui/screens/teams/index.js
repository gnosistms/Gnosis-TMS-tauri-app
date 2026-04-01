import {
  navButton,
  pageShell,
  primaryButton,
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
  const subtitle =
    (typeof session?.name === "string" && session.name.trim())
    || (typeof session?.login === "string" && session.login.trim())
    || "";

  return pageShell({
    title: "Translation Teams",
    subtitle,
    navButtons: [navButton("Logout", "start")],
    tools: [primaryButton("+ New Team", "open-new-team", { disabled: offlineMode })].join(""),
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
