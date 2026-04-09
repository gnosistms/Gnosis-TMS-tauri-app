import {
  buildPageRefreshAction,
  buildSectionNav,
  escapeHtml,
  pageShell,
  primaryButton,
  renderFlowArrowIcon,
  renderStateCard,
  sectionSeparator,
  textAction,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { getNoticeBadgeText } from "../app/status-feedback.js";
import { renderGlossaryCreationModal } from "./glossary-creation-modal.js";
import { renderGlossaryPermanentDeletionModal } from "./glossary-permanent-deletion-modal.js";
import { renderGlossaryRenameModal } from "./glossary-rename-modal.js";
import {
  canManageGlossaries,
  canPermanentlyDeleteGlossaries,
} from "../app/glossary-shared.js";
import { glossaryArchiveDownloadUrl } from "../app/glossary-repo-flow.js";

function renderGlossaryLanguageFlow(glossary) {
  return `
    <span class="glossary-card__language-flow">
      <span>${escapeHtml(glossary.sourceLanguage?.name ?? "Unknown")}</span>
      ${renderFlowArrowIcon("glossary-card__language-arrow")}
      <span>${escapeHtml(glossary.targetLanguage?.name ?? "Unknown")}</span>
    </span>
  `;
}

function renderGlossaryCard(glossary, options = {}) {
  const canManage = options.canManage === true;
  const canPermanentlyDelete = options.canPermanentlyDelete === true;
  const isDeleted = options.isDeleted === true;
  const offlineMode = options.offlineMode === true;
  const isTombstone = glossary?.recordState === "tombstone";
  const downloadUrl = glossaryArchiveDownloadUrl(glossary);
  const activeActions = [
    textAction("Open", `open-glossary:${glossary.id}`),
    downloadUrl
      ? textAction("Download", `open-external:${downloadUrl}`, { disabled: offlineMode })
      : textAction("Download", "noop", { disabled: true }),
    ...(canManage
      ? [
          textAction("Rename", `rename-glossary:${glossary.id}`, { disabled: offlineMode }),
          textAction("Delete", `delete-glossary:${glossary.id}`, { disabled: offlineMode }),
        ]
      : []),
  ];
  const deletedActions = [
    ...(!isTombstone && canManage ? [textAction("Restore", `restore-glossary:${glossary.id}`, { disabled: offlineMode })] : []),
    ...(!isTombstone && canPermanentlyDelete
      ? [textAction("Delete", `delete-deleted-glossary:${glossary.id}`, { disabled: offlineMode })]
      : []),
  ];

  return `
    <article class="card card--list-row ${isDeleted ? "card--deleted" : ""}">
      <div class="card__body list-row">
        <div class="list-row__main">
          <div class="list-row__content">
            <h2 class="list-row__title">
              ${
                isDeleted
                  ? `<span>${escapeHtml(glossary.title)}</span>`
                  : `
                    <button class="list-row__title-button" data-action="open-glossary:${glossary.id}">
                      ${escapeHtml(glossary.title)}
                    </button>
                  `
              }
            </h2>
            <p class="list-row__meta">
              ${renderGlossaryLanguageFlow(glossary)}
              ${isDeleted && isTombstone ? ` <span>Permanently deleted</span>` : ""}
            </p>
          </div>
          <div class="list-row__actions">
            ${(isDeleted ? deletedActions : activeActions).join("")}
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderDeletedGlossariesSection(glossaries, isOpen, options = {}) {
  if (!glossaries.length) {
    return "";
  }

  const toggle = sectionSeparator({
    label: isOpen ? "Hide deleted glossaries" : "Show deleted glossaries",
    action: "toggle-deleted-glossaries",
    isOpen,
  });

  if (!isOpen) {
    return toggle;
  }

  return `
    ${toggle}
    <section class="stack stack--deleted-projects">
      <section class="stack">
        ${glossaries
          .map((glossary) =>
            renderGlossaryCard(glossary, {
              ...options,
              isDeleted: true,
            }),
          )
          .join("")}
      </section>
    </section>
  `;
}

export function renderGlossariesScreen(state) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId) ?? state.teams[0];
  const canManage = canManageGlossaries(selectedTeam);
  const canPermanentlyDelete = canPermanentlyDeleteGlossaries(selectedTeam);
  const offlineMode = state.offline?.isEnabled === true;
  const discovery = state.glossaryDiscovery ?? { status: "idle", error: "", brokerWarning: "" };
  const visibleGlossaries = state.glossaries.filter((glossary) => glossary.lifecycleState === "active");
  const deletedGlossaries = state.glossaries.filter((glossary) => glossary.lifecycleState === "deleted");
  const brokerWarningMarkup = discovery.brokerWarning
    ? `
      <div class="message-box message-box--warning">
        <p class="message-box__text">${escapeHtml(discovery.brokerWarning)}</p>
      </div>
    `
    : "";
  const emptyState = renderStateCard({
    eyebrow: "NO GLOSSARIES FOUND",
    title: "No glossaries are available yet.",
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
        <section class="stack">
          ${visibleGlossaries
            .map((glossary) =>
              renderGlossaryCard(glossary, {
                canManage,
                canPermanentlyDelete,
                offlineMode,
              }),
            )
            .join("")}
        </section>
      `
      : discovery.status === "ready"
        ? emptyState
        : loadingState;
  const body = `
    <section class="stack">
      ${brokerWarningMarkup}
      ${bodyMarkup}
      ${renderDeletedGlossariesSection(deletedGlossaries, state.showDeletedGlossaries, {
        canManage,
        canPermanentlyDelete,
        offlineMode,
      })}
    </section>
  `;

  return (
    pageShell({
      title: "Glossaries",
      subtitle: selectedTeam?.name ?? "Team",
      titleAction: buildPageRefreshAction(state),
      navButtons: buildSectionNav("glossaries"),
      tools: canManage
        ? `${textAction("Import", "import-glossary", { disabled: offlineMode })} ${primaryButton("+ New Glossary", "open-new-glossary", { disabled: offlineMode })}`
        : "",
      pageSync: state.pageSync,
      noticeText: getNoticeBadgeText(),
      offlineMode,
      offlineReconnectState: state.offline?.reconnecting === true,
      body,
    }) +
    renderGlossaryCreationModal(state) +
    renderGlossaryRenameModal(state) +
    renderGlossaryPermanentDeletionModal(state)
  );
}
