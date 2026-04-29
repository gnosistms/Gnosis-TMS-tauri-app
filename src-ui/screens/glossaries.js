import {
  buildPageRefreshAction,
  buildSectionNav,
  escapeHtml,
  pageShell,
  primaryButton,
  renderFlowArrowIcon,
  renderInlineStateBox,
  renderStateCard,
  sectionSeparator,
  textAction,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { getNoticeBadgeText } from "../app/status-feedback.js";
import { renderGlossaryCreationModal } from "./glossary-creation-modal.js";
import { renderGlossaryImportModal } from "./glossary-import-modal.js";
import { renderGlossaryPermanentDeletionModal } from "./glossary-permanent-deletion-modal.js";
import { renderGlossaryRenameModal } from "./glossary-rename-modal.js";
import {
  canManageGlossaries,
} from "../app/glossary-shared.js";
import {
  DEFAULT_GLOSSARY_TOOLTIP,
  activeDefaultGlossaryIdForTeam,
} from "../app/glossary-default-flow.js";
import {
  shouldShowDeletedGlossaryPermanentDelete,
  shouldShowGlossaryCreationControls,
  canManageTeamAiSettings,
} from "../app/resource-capabilities.js";
import {
  areResourcePageWritesDisabled,
  areResourcePageWriteSubmissionsDisabled,
} from "../app/resource-page-controller.js";
import { deriveGlossaryResolution } from "../app/resource-resolution.js";
import {
  anyGlossaryMutatingWriteIsActive,
  anyGlossaryWriteIsActive,
} from "../app/glossary-write-coordinator.js";

const DEFAULT_GLOSSARY_LABEL_TOOLTIP =
  "New files uploaded to projects will automatically be assigned to use this glossary.";

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
  const lifecycleActionsDisabled = options.lifecycleActionsDisabled === true;
  const writeActionsDisabled = options.writeActionsDisabled === true;
  const isDefaultGlossary = options.defaultGlossaryId === glossary.id;
  const isTombstone = glossary?.recordState === "tombstone";
  const resolution = deriveGlossaryResolution(glossary, options.syncSnapshot);
  const disableLifecycleActions = resolution?.blockLifecycleActions === true;
  const activeActions = [
    textAction("Open", `open-glossary:${glossary.id}`),
    textAction("Download", `download-glossary:${glossary.id}`, {
      disabled: offlineMode || resolution?.key === "missing",
    }),
    isDefaultGlossary
      ? `<span class="text-action-label" data-tooltip="${escapeHtml(DEFAULT_GLOSSARY_LABEL_TOOLTIP)}">Default</span>`
      : textAction("Make default", `make-default-glossary:${glossary.id}`, {
          disabled: disableLifecycleActions,
          tooltip: DEFAULT_GLOSSARY_TOOLTIP,
        }),
    ...(canManage
        ? [
          textAction("Rename", `rename-glossary:${glossary.id}`, {
            disabled: offlineMode || lifecycleActionsDisabled || disableLifecycleActions,
          }),
          textAction("Delete", `delete-glossary:${glossary.id}`, {
            disabled: offlineMode || lifecycleActionsDisabled || disableLifecycleActions,
          }),
        ]
      : []),
  ];
  const deletedActions = [
    ...(!isTombstone && canManage ? [textAction("Restore", `restore-glossary:${glossary.id}`, { disabled: offlineMode || lifecycleActionsDisabled || disableLifecycleActions })] : []),
    ...(!isTombstone && canPermanentlyDelete
      ? [textAction("Delete", `delete-deleted-glossary:${glossary.id}`, { disabled: offlineMode || writeActionsDisabled || disableLifecycleActions })]
      : []),
  ];
  const resolutionMarkup = resolution
    ? renderInlineStateBox({
        tone: resolution.tone,
        message: resolution.message,
        help: resolution.help,
        className: "resource-state-box",
        actionLabel: resolution.actionLabel,
        action: resolution.action,
        actionDisabled: offlineMode || writeActionsDisabled,
      })
    : "";

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
            ${resolutionMarkup}
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
              syncSnapshot: options.syncSnapshotsByRepoName?.[glossary.repoName] ?? null,
            }),
          )
          .join("")}
      </section>
    </section>
  `;
}

export function renderGlossariesScreen(state) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId) ?? state.teams[0];
  const canCreate = shouldShowGlossaryCreationControls(selectedTeam);
  const canManage = canManageGlossaries(selectedTeam);
  const canPermanentlyDelete = shouldShowDeletedGlossaryPermanentDelete(selectedTeam);
  const canManageAiSettings = canManageTeamAiSettings(selectedTeam);
  const offlineMode = state.offline?.isEnabled === true;
  const lifecycleActionsDisabled = areResourcePageWriteSubmissionsDisabled(state.glossariesPage);
  const coordinatorWriteActive = anyGlossaryWriteIsActive();
  const writeActionsDisabled =
    areResourcePageWritesDisabled(state.glossariesPage) || anyGlossaryMutatingWriteIsActive();
  const discovery = state.glossaryDiscovery ?? { status: "idle", error: "", brokerWarning: "" };
  const syncSnapshotsByRepoName = state.glossaryRepoSyncByRepoName ?? {};
  const defaultGlossaryId = activeDefaultGlossaryIdForTeam(selectedTeam);
  const recoveryMessage =
    typeof discovery.recoveryMessage === "string" && discovery.recoveryMessage.trim()
      ? discovery.recoveryMessage.trim()
      : "";
  const visibleGlossaries = state.glossaries.filter((glossary) => glossary.lifecycleState === "active");
  const deletedGlossaries = state.glossaries.filter((glossary) => glossary.lifecycleState === "deleted");
  const recoveryMarkup = recoveryMessage
    ? `
      <div class="message-box message-box--warning">
        <p class="message-box__text">${escapeHtml(recoveryMessage)}</p>
      </div>
    `
    : "";
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
    subtitle: recoveryMessage || "",
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
                lifecycleActionsDisabled,
                writeActionsDisabled,
                defaultGlossaryId,
                syncSnapshot: syncSnapshotsByRepoName[glossary.repoName] ?? null,
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
      ${recoveryMarkup}
      ${brokerWarningMarkup}
      ${bodyMarkup}
      ${renderDeletedGlossariesSection(deletedGlossaries, state.showDeletedGlossaries, {
        canManage,
        canPermanentlyDelete,
        offlineMode,
        lifecycleActionsDisabled,
        writeActionsDisabled,
        defaultGlossaryId,
        syncSnapshotsByRepoName,
      })}
    </section>
  `;

  return (
    pageShell({
      title: "Glossaries",
      subtitle: selectedTeam?.name ?? "Team",
      titleAction: buildPageRefreshAction(state, state.pageSync, "refresh-page", {
        backgroundRefreshing: state.glossariesPage?.isRefreshing === true || coordinatorWriteActive,
      }),
      navButtons: buildSectionNav("glossaries", { includeAiSettings: canManageAiSettings }),
      tools: canCreate
        ? `${textAction("Import", "import-glossary", { disabled: offlineMode || writeActionsDisabled })} ${primaryButton("+ New Glossary", "open-new-glossary", { disabled: offlineMode || writeActionsDisabled })}`
        : "",
      pageSync: state.pageSync,
      noticeText: getNoticeBadgeText(),
      offlineMode,
      offlineReconnectState: state.offline?.reconnecting === true,
      body,
    }) +
    renderGlossaryCreationModal(state) +
    renderGlossaryImportModal(state) +
    renderGlossaryRenameModal(state) +
    renderGlossaryPermanentDeletionModal(state)
  );
}
