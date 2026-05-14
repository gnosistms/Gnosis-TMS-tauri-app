import {
  buildSectionNav,
  pageShell,
  renderStateCard,
} from "../lib/ui.js";
import { canManageTeamAiSettings } from "../app/resource-capabilities.js";
import { getNoticeBadgeText, getStatusSurfaceItems } from "../app/status-feedback.js";

export function renderQaScreen(state) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId) ?? state.teams[0];
  const canManageAiSettings = canManageTeamAiSettings(selectedTeam);

  return pageShell({
    title: "QA",
    subtitle: selectedTeam?.name ?? "Team",
    navButtons: buildSectionNav("qa", { includeAiSettings: canManageAiSettings }),
    noticeText: getNoticeBadgeText(),
    statusItems: getStatusSurfaceItems("qa"),
    offlineMode: state.offline?.isEnabled === true,
    offlineReconnectState: state.offline?.reconnecting === true,
    body: `
      <section class="stack">
        ${renderStateCard({
          title: "No QA checks yet.",
        })}
      </section>
    `,
  });
}
