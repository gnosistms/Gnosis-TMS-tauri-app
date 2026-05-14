import {
  buildPageRefreshAction,
  buildSectionNav,
  escapeHtml,
  pageShell,
  primaryButton,
  renderInlineStateBox,
  renderStateCard,
  sectionSeparator,
  textAction,
  tooltipAttributes,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { getNoticeBadgeText } from "../app/status-feedback.js";
import { renderQaListCreationModal } from "./qa-list-creation-modal.js";
import { renderQaListPermanentDeletionModal } from "./qa-list-permanent-deletion-modal.js";
import { renderQaListRenameModal } from "./qa-list-rename-modal.js";
import {
  canManageQaLists,
} from "../app/qa-list-shared.js";
import {
  activeDefaultQaListIdsForTeam,
  DEFAULT_QA_LIST_TOOLTIP,
} from "../app/qa-list-default-flow.js";
import {
  canManageTeamAiSettings,
  shouldShowDeletedQaListPermanentDelete,
  shouldShowQaListCreationControls,
} from "../app/resource-capabilities.js";

const DEFAULT_QA_LIST_LABEL_TOOLTIP =
  "New files opened in the editor will automatically use this QA list for this language.";

function renderQaListCard(qaList, options = {}) {
  const canManage = options.canManage === true;
  const canPermanentlyDelete = options.canPermanentlyDelete === true;
  const isDeleted = options.isDeleted === true;
  const offlineMode = options.offlineMode === true;
  const isDefault = options.defaultQaListIdsByLanguage?.[qaList.language?.code] === qaList.id;
  const activeActions = [
    textAction("Download", `download-qa-list:${qaList.id}`, { disabled: offlineMode }),
    isDefault
      ? `<span class="text-action-label" data-tooltip="${escapeHtml(DEFAULT_QA_LIST_LABEL_TOOLTIP)}">Default</span>`
      : textAction("Make default", `make-default-qa-list:${qaList.id}`, {
          tooltip: DEFAULT_QA_LIST_TOOLTIP,
        }),
    ...(canManage
      ? [
          textAction("Rename", `rename-qa-list:${qaList.id}`, { disabled: offlineMode }),
          textAction("Delete", `delete-qa-list:${qaList.id}`, { disabled: offlineMode }),
        ]
      : []),
  ];
  const deletedActions = [
    ...(canManage ? [textAction("Restore", `restore-qa-list:${qaList.id}`, { disabled: offlineMode })] : []),
    ...(canPermanentlyDelete ? [textAction("Delete", `delete-deleted-qa-list:${qaList.id}`, { disabled: offlineMode })] : []),
  ];
  const termLabel = qaList.termCount === 1 ? "1 QA term" : `${qaList.termCount ?? 0} QA terms`;
  const languageName = qaList.language?.name ?? "Unknown";
  const stateMarkup = isDeleted
    ? renderInlineStateBox({
        tone: "warning",
        message: "This QA list is deleted.",
        className: "resource-state-box",
      })
    : "";

  return `
    <article class="card card--list-row ${isDeleted ? "card--deleted" : ""}">
      <div class="card__body list-row">
        <div class="list-row__main">
          <div class="list-row__content${isDeleted ? "" : " list-row__content--interactive"}"${isDeleted ? "" : ` data-action="open-qa-list:${qaList.id}"${tooltipAttributes("Open")}`}>
            <h2 class="list-row__title">
              ${
                isDeleted
                  ? `<span>${escapeHtml(qaList.title)}</span>`
                  : `<span class="list-row__title-button">${escapeHtml(qaList.title)}</span>`
              }
            </h2>
            <p class="list-row__meta">
              <span>${escapeHtml(languageName)}</span>
              <span>${escapeHtml(termLabel)}</span>
            </p>
            ${stateMarkup}
          </div>
          <div class="list-row__actions">
            ${(isDeleted ? deletedActions : activeActions).join("")}
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderDeletedQaListsSection(qaLists, isOpen, options = {}) {
  if (!qaLists.length) {
    return "";
  }

  const toggle = sectionSeparator({
    label: isOpen ? "Hide deleted QA lists" : "Show deleted QA lists",
    action: "toggle-deleted-qa-lists",
    isOpen,
  });

  if (!isOpen) {
    return toggle;
  }

  return `
    ${toggle}
    <section class="stack stack--deleted-projects">
      <section class="stack">
        ${qaLists
          .map((qaList) =>
            renderQaListCard(qaList, {
              ...options,
              isDeleted: true,
            }),
          )
          .join("")}
      </section>
    </section>
  `;
}

export function renderQaScreen(state) {
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId) ?? state.teams[0];
  const canCreate = shouldShowQaListCreationControls(selectedTeam);
  const canManage = canManageQaLists(selectedTeam);
  const canPermanentlyDelete = shouldShowDeletedQaListPermanentDelete(selectedTeam);
  const canManageAiSettings = canManageTeamAiSettings(selectedTeam);
  const offlineMode = state.offline?.isEnabled === true;
  const discovery = state.qaListDiscovery ?? { status: "idle", error: "", recoveryMessage: "" };
  const discoveryLoading = discovery.status === "loading";
  const refreshInProgress =
    state.qaListsPage?.isRefreshing === true
    || state.pageSync?.status === "syncing"
    || discoveryLoading;
  const visibleQaLists = state.qaLists.filter((qaList) => qaList.lifecycleState === "active");
  const deletedQaLists = state.qaLists.filter((qaList) => qaList.lifecycleState === "deleted");
  const defaultQaListIdsByLanguage = activeDefaultQaListIdsForTeam(selectedTeam);
  const emptyState = renderStateCard({
    eyebrow: "NO QA LISTS FOUND",
    title: "No QA lists are available yet.",
    subtitle: "Create or import a QA list to start building quality assurance terms.",
  });
  const loadingState = renderStateCard({
    eyebrow: "LOADING QA LISTS",
    title: "Loading QA lists...",
  });
  const errorState = renderStateCard({
    eyebrow: "QA LIST LOAD FAILED",
    title: "Could not load this team's QA lists.",
    subtitle: formatErrorForDisplay(discovery.error || "Unknown error."),
    tone: "error",
  });
  const bodyMarkup = discovery.status === "error"
    ? errorState
    : visibleQaLists.length
      ? `
        <section class="stack">
          ${visibleQaLists
            .map((qaList) =>
              renderQaListCard(qaList, {
                canManage,
                canPermanentlyDelete,
                offlineMode,
                defaultQaListIdsByLanguage,
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
      ${bodyMarkup}
      ${renderDeletedQaListsSection(deletedQaLists, state.showDeletedQaLists, {
        canManage,
        canPermanentlyDelete,
        offlineMode,
        defaultQaListIdsByLanguage,
      })}
    </section>
  `;

  return (
    pageShell({
      title: "QA Lists",
      subtitle: selectedTeam?.name ?? "Team",
      titleAction: buildPageRefreshAction(state, state.pageSync, "refresh-page", {
        backgroundRefreshing: refreshInProgress,
        backgroundRefreshStartedAt: state.qaListsPage?.refreshStartedAt,
      }),
      navButtons: buildSectionNav("qa", { includeAiSettings: canManageAiSettings }),
      tools: canCreate
        ? `${textAction("Import", "import-qa-list", { disabled: offlineMode })} ${primaryButton("+ New QA List", "open-new-qa-list", { disabled: offlineMode })}`
        : "",
      pageSync: state.pageSync,
      noticeText: getNoticeBadgeText(),
      offlineMode,
      offlineReconnectState: state.offline?.reconnecting === true,
      body,
    }) +
    renderQaListCreationModal(state) +
    renderQaListRenameModal(state) +
    renderQaListPermanentDeletionModal(state)
  );
}
