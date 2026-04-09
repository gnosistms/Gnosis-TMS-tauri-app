import {
  buildPageRefreshAction,
  buildSectionNav,
  escapeHtml,
  pageShell,
  primaryButton,
  renderStateCard,
  textAction,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { getNoticeBadgeText } from "../app/status-feedback.js";
import { renderGlossaryCreationModal } from "./glossary-creation-modal.js";
import { canManageGlossaries } from "../app/glossary-shared.js";

export function renderGlossariesScreen(state) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId) ?? state.teams[0];
  const canManage = canManageGlossaries(selectedTeam);
  const discovery = state.glossaryDiscovery ?? { status: "idle", error: "" };
  const visibleGlossaries = state.glossaries.filter((glossary) => glossary.lifecycleState === "active");
  const emptyState = renderStateCard({
    eyebrow: "NO GLOSSARIES FOUND",
    title: "No glossaries are available locally yet.",
    subtitle: "Create or import a glossary to start building term lists for the editor.",
  });
  const loadingState = renderStateCard({
    eyebrow: "LOADING GLOSSARIES",
    title: "Loading glossaries...",
  });
  const errorState = renderStateCard({
    eyebrow: "GLOSSARY LOAD FAILED",
    title: "Could not load this team's glossaries.",
    subtitle: formatErrorForDisplay(discovery.error || "Unknown error."),
    tone: "error",
  });
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
                  ${canManage ? textAction("Download", `download-glossary:${glossary.id}`) : ""}
                  ${canManage ? textAction("Rename", `rename-glossary:${glossary.id}`) : ""}
                  ${canManage ? textAction("Delete", `delete-glossary:${glossary.id}`) : ""}
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
      titleAction: buildPageRefreshAction(state),
      navButtons: buildSectionNav("glossaries"),
      tools: canManage
        ? `${textAction("Import", "import-glossary")} ${primaryButton("+ New Glossary", "open-new-glossary")}`
        : "",
      pageSync: state.pageSync,
      noticeText: getNoticeBadgeText(),
      offlineMode: state.offline?.isEnabled === true,
      offlineReconnectState: state.offline?.reconnecting === true,
      body,
    }) +
    renderGlossaryCreationModal(state)
  );
}
