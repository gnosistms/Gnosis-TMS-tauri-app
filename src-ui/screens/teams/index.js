import {
  navButton,
  pageShell,
  primaryButton,
  secondaryButton,
} from "../../lib/ui.js";
import { renderSetupModal } from "./setup-modal.js";
import { renderTeamsList } from "./team-list.js";

export function renderTeamsScreen(state) {
  return pageShell({
    title: "Translation Teams",
    navButtons: [navButton("Logout", "start")],
    tools: [
      secondaryButton("Refresh Organizations", "refresh-organizations"),
      secondaryButton("Reconnect GitHub", "reconnect-github"),
      primaryButton("+ New Team", "open-new-team"),
    ].join(""),
    body: `<section class="stack">${renderTeamsList(state.teams)}</section>${renderSetupModal({
      ...state,
      debugOrgDiscovery: window.__GNOSIS_DEBUG__?.DEBUG_ORG_DISCOVERY === true,
    })}`,
  });
}
