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

export function renderTeamsScreen(state) {
  return pageShell({
    title: "Translation Teams",
    navButtons: [navButton("Logout", "start")],
    tools: [primaryButton("+ New Team", "open-new-team")].join(""),
    pageSync: state.pageSync,
    body: `<section class="stack">${renderTeamsList(
      state.teams,
      state.deletedTeams,
      state.showDeletedTeams,
    )}</section>`,
  }) +
  renderSetupModal(state) +
  renderTeamRenameModal(state) +
  renderTeamPermanentDeletionModal(state) +
  renderTeamLeaveModal(state);
}
