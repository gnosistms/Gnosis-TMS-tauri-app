import { escapeHtml, navButton, pageShell, primaryButton, textAction, titleRefreshButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { getNoticeBadgeText } from "../app/status-feedback.js";
import { renderGlossaryCreationModal } from "./glossary-creation-modal.js";

export function renderGlossariesScreen(state) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId) ?? state.teams[0];
  const discovery = state.glossaryDiscovery ?? { status: "idle", error: "" };
  const visibleGlossaries = state.glossaries.filter((glossary) => glossary.lifecycleState === "active");
  const emptyState = `
    <article class="card card--hero card--empty">
      <div class="card__body">
        <p class="card__eyebrow">NO GLOSSARIES FOUND</p>
        <h2 class="card__title card__title--small">No glossaries are available locally yet.</h2>
        <p class="card__subtitle">Create or import a glossary to start building term lists for the editor.</p>
      </div>
    </article>
  `;
  const loadingState = `
    <article class="card card--hero card--empty">
      <div class="card__body">
        <p class="card__eyebrow">LOADING GLOSSARIES</p>
        <h2 class="card__title card__title--small">Loading glossaries...</h2>
      </div>
    </article>
  `;
  const errorState = `
    <article class="card card--hero card--empty">
      <div class="card__body">
        <p class="card__eyebrow">GLOSSARY LOAD FAILED</p>
        <h2 class="card__title card__title--small">Could not load this team's glossaries.</h2>
        <p class="card__subtitle">${escapeHtml(formatErrorForDisplay(discovery.error || "Unknown error."))}</p>
      </div>
    </article>
  `;
  const bodyMarkup = discovery.status === "error"
    ? errorState
    : visibleGlossaries.length
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
                  ${textAction("Open", `open-glossary:${glossary.id}`)}
                  ${textAction("Download", `download-glossary:${glossary.id}`)}
                  ${textAction("Rename", `rename-glossary:${glossary.id}`)}
                  ${textAction("Delete", `delete-glossary:${glossary.id}`)}
                </div>
              </div>
            `,
          )
          .join("")}
      </section>
      `
      : discovery.status === "ready"
        ? emptyState
        : loadingState;
  const body = `
    <section class="stack">
      ${bodyMarkup}
    </section>
  `;

  return (
    pageShell({
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
      body,
    }) +
    renderGlossaryCreationModal(state)
  );
}
