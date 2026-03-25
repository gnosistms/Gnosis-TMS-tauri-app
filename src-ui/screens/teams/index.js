import {
  navButton,
  pageShell,
  primaryButton,
} from "../../lib/ui.js";
import { renderTeamRenameModal } from "./rename-modal.js";
import { renderSetupModal } from "./setup-modal.js";
import { renderTeamsList } from "./team-list.js";

export function renderTeamsScreen(state) {
  return pageShell({
    title: "Translation Teams",
    navButtons: [navButton("Logout", "start")],
    tools: [primaryButton("+ New Team", "open-new-team")].join(""),
    body: `<section class="stack">${renderTeamsList(
      state.teams,
      state.deletedTeams,
      state.showDeletedTeams,
    )}</section>`,
    syncing: state.sync?.teams === "syncing",
  }) + renderSetupModal(state) + renderTeamRenameModal(state);
}
