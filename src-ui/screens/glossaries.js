import { glossaries } from "../lib/data.js";
import { navButton, pageShell, primaryButton, textAction } from "../lib/ui.js";
import { getNoticeBadgeText } from "../app/status-feedback.js";

export function renderGlossariesScreen(state) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId) ?? state.teams[0];

  return pageShell({
    title: "Glossaries",
    subtitle: selectedTeam?.name ?? "Team",
    navButtons: [
      navButton("Logout", "start"),
      navButton("Teams", "teams"),
      navButton("Users", "users"),
      navButton("Projects", "projects"),
    ],
    tools: `${textAction("Upload", "noop")} ${primaryButton("+ New Glossary", "noop")}`,
    pageSync: state.pageSync,
    noticeText: getNoticeBadgeText(),
    offlineMode: state.offline?.isEnabled === true,
    offlineReconnectState: state.offline?.reconnecting === true,
    body: `
      <section class="table-card">
        <div class="table-card__header glossary-list glossary-list--head">
          <div>Name</div>
          <div>Source Language</div>
          <div>Target Language</div>
          <div></div>
        </div>
        ${glossaries
          .map(
            (glossary) => `
              <div class="glossary-list glossary-list--row">
                <div class="glossary-list__name">
                  <button class="text-link" data-action="open-glossary:${glossary.id}">${glossary.name}</button>
                </div>
                <div>${glossary.sourceLanguage}</div>
                <div>${glossary.targetLanguage}</div>
                <div class="glossary-list__actions">
                  ${textAction("Rename", "noop")}
                  ${textAction("Open", `open-glossary:${glossary.id}`)}
                  ${textAction("Download", "noop")}
                  ${textAction("Delete", "noop")}
                </div>
              </div>
            `,
          )
          .join("")}
      </section>
    `,
  });
}
