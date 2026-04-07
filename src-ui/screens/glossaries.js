import { escapeHtml, navButton, pageShell, primaryButton, textAction, titleRefreshButton } from "../lib/ui.js";
import { getNoticeBadgeText } from "../app/status-feedback.js";
import { renderGlossaryCreationModal } from "./glossary-creation-modal.js";

export function renderGlossariesScreen(state) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId) ?? state.teams[0];
  const visibleGlossaries = state.glossaries.filter((glossary) => glossary.lifecycleState === "active");
  const emptyState = "No glossaries are available locally yet.";
  const bodyMarkup = visibleGlossaries.length
    ? `
      <section class="table-card">
        <div class="table-card__header glossary-list glossary-list--head">
          <div>Name</div>
          <div>Source Language</div>
          <div>Target Language</div>
          <div></div>
        </div>
        ${visibleGlossaries
          .map(
            (glossary) => `
              <div class="glossary-list glossary-list--row">
                <div class="glossary-list__name">
                  <button class="text-link" data-action="open-glossary:${glossary.id}">${escapeHtml(glossary.title)}</button>
                </div>
                <div>${escapeHtml(glossary.sourceLanguage?.name ?? "Unknown")}</div>
                <div>${escapeHtml(glossary.targetLanguage?.name ?? "Unknown")}</div>
                <div class="glossary-list__actions">
                  ${textAction("Rename", `rename-glossary:${glossary.id}`)}
                  ${textAction("Open", `open-glossary:${glossary.id}`)}
                  ${textAction("Download", `download-glossary:${glossary.id}`)}
                  ${textAction("Delete", `delete-glossary:${glossary.id}`)}
                </div>
              </div>
            `,
          )
          .join("")}
      </section>
    `
    : `
      <section class="card">
        <div class="card__body card__body--stacked">
          <p class="card__eyebrow">GLOSSARIES</p>
          <h2 class="card__section-title">${escapeHtml(emptyState)}</h2>
          <p class="list-row__meta">Creating and importing glossary repos is the next step. This page already reads any local glossary repos that match the GTMS glossary format.</p>
        </div>
      </section>
    `;

  return pageShell({
    title: "Glossaries",
    subtitle: selectedTeam?.name ?? "Team",
    titleAction: titleRefreshButton("refresh-page", {
      spinning: state.pageSync?.status === "syncing",
      spinStartedAt: state.pageSync?.startedAt,
      disabled: state.offline?.isEnabled === true || state.pageSync?.status === "syncing",
    }),
    navButtons: [
      navButton("Logout", "start"),
      navButton("Teams", "teams"),
      navButton("Members", "users"),
      navButton("Projects", "projects"),
    ],
    tools: `${textAction("Upload", "upload-glossary")} ${primaryButton("+ New Glossary", "open-new-glossary")}`,
    pageSync: state.pageSync,
    noticeText: getNoticeBadgeText(),
    offlineMode: state.offline?.isEnabled === true,
    offlineReconnectState: state.offline?.reconnecting === true,
    body: `${bodyMarkup}${renderGlossaryCreationModal(state)}`,
  });
}
