import {
  navButton,
  pageShell,
  primaryButton,
} from "../../lib/ui.js";
import { renderSetupModal } from "./setup-modal.js";
import { renderTeamsList } from "./team-list.js";

export function renderTeamsScreen(state) {
  return pageShell({
    title: "Translation Teams",
    navButtons: [navButton("Logout", "start")],
    tools: [primaryButton("+ New Team", "open-new-team")].join(""),
    body: `<section class="stack">${renderTeamsList(state.teams)}</section>${renderSetupModal(state)}`,
  });
}
