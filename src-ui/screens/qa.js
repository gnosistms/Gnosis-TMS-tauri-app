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
import {
  getNoticeBadgeText,
  getScopedSyncBadgeText,
  getStatusSurfaceItems,
} from "../app/status-feedback.js";
import { renderQaListCreationModal } from "./qa-list-creation-modal.js";
import { renderQaListImportModal } from "./qa-list-import-modal.js";
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
import {
  areResourcePageWritesDisabled,
  areResourcePageWriteSubmissionsDisabled,
} from "../app/resource-page-controller.js";
import { deriveQaListResolution } from "../app/resource-resolution.js";
import {
  anyQaListMutatingWriteIsActive,
  anyQaListWriteIsActive,
} from "../app/qa-list-write-coordinator.js";

const DEFAULT_QA_LIST_LABEL_TOOLTIP =
  "New files opened in the editor will automatically use this QA list for this language.";

function hasPendingQaListMutation(qaLists) {
  return qaLists.some((qaList) => typeof qaList?.pendingMutation === "string" && qaList.pendingMutation.trim());
}

function renderQaListCard(qaList, options = {}) {
  const canManage = options.canManage === true;
  const canPermanentlyDelete = options.canPermanentlyDelete === true;
  const isDeleted = options.isDeleted === true;
  const offlineMode = options.offlineMode === true;
  const lifecycleActionsDisabled = options.lifecycleActionsDisabled === true;
  const writeActionsDisabled = options.writeActionsDisabled === true;
  const isDefault = options.defaultQaListIdsByLanguage?.[qaList.language?.code] === qaList.id;
  const isTombstone = qaList?.recordState === "tombstone";
  const resolution = deriveQaListResolution(qaList, options.syncSnapshot, {
    suppressMissingLocalRepoRepair: options.suppressMissingLocalRepoRepair === true,
  });
  const disableLifecycleActions = resolution?.blockLifecycleActions === true;
  const activeActions = [
    textAction("Download", `download-qa-list:${qaList.id}`, {
      disabled: offlineMode || resolution?.key === "missing",
    }),
    isDefault
      ? `<span class="text-action-label" data-tooltip="${escapeHtml(DEFAULT_QA_LIST_LABEL_TOOLTIP)}">Default</span>`
      : textAction("Make default", `make-default-qa-list:${qaList.id}`, {
          disabled: disableLifecycleActions,
          tooltip: DEFAULT_QA_LIST_TOOLTIP,
        }),
    ...(canManage
      ? [
          textAction("Rename", `rename-qa-list:${qaList.id}`, {
            disabled: offlineMode || lifecycleActionsDisabled || disableLifecycleActions,
          }),
          textAction("Delete", `delete-qa-list:${qaList.id}`, {
            disabled: offlineMode || lifecycleActionsDisabled || disableLifecycleActions,
          }),
        ]
      : []),
  ];
  const deletedActions = [
    ...(!isTombstone && canManage
      ? [textAction("Restore", `restore-qa-list:${qaList.id}`, {
          disabled: offlineMode || lifecycleActionsDisabled || disableLifecycleActions,
        })]
      : []),
    ...(!isTombstone && canPermanentlyDelete
      ? [textAction("Delete", `delete-deleted-qa-list:${qaList.id}`, {
          disabled: offlineMode || writeActionsDisabled || disableLifecycleActions,
        })]
      : []),
  ];
  const languageName = qaList.language?.name ?? "Unknown";
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
              syncSnapshot: options.syncSnapshotsByRepoName?.[qaList.repoName] ?? null,
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
  const lifecycleActionsDisabled = areResourcePageWriteSubmissionsDisabled(state.qaListsPage);
  const coordinatorWriteActive = anyQaListWriteIsActive();
  const queryLifecycleWriteActive = hasPendingQaListMutation(state.qaLists);
  const writeActionsDisabled =
    areResourcePageWritesDisabled(state.qaListsPage) || discoveryLoading || anyQaListMutatingWriteIsActive();
  const refreshInProgress =
    state.qaListsPage?.isRefreshing === true
    || state.pageSync?.status === "syncing"
    || discoveryLoading
    || queryLifecycleWriteActive;
  const syncSnapshotsByRepoName = state.qaListRepoSyncByRepoName ?? {};
  const recoveryMessage =
    typeof discovery.recoveryMessage === "string" && discovery.recoveryMessage.trim()
      ? discovery.recoveryMessage.trim()
      : "";
  const visibleQaLists = state.qaLists.filter((qaList) => qaList.lifecycleState === "active");
  const deletedQaLists = state.qaLists.filter((qaList) => qaList.lifecycleState === "deleted");
  const defaultQaListIdsByLanguage = activeDefaultQaListIdsForTeam(selectedTeam);
  const emptyState = renderStateCard({
    eyebrow: "NO QA LISTS FOUND",
    title: "No QA lists are available yet.",
    subtitle: "Create or import a QA list to start building quality assurance term lists.",
  });
  const loadingState = renderStateCard({
    eyebrow: "LOADING QA LISTS",
    title: "Loading QA lists...",
    subtitle: recoveryMessage || "",
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
                lifecycleActionsDisabled,
                writeActionsDisabled,
                defaultQaListIdsByLanguage,
                syncSnapshot: syncSnapshotsByRepoName[qaList.repoName] ?? null,
                suppressMissingLocalRepoRepair: refreshInProgress,
              }),
            )
            .join("")}
        </section>
      `
      : discovery.status === "ready"
        ? emptyState
        : loadingState;
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
  const body = `
    <section class="stack">
      ${recoveryMarkup}
      ${brokerWarningMarkup}
      ${bodyMarkup}
      ${renderDeletedQaListsSection(deletedQaLists, state.showDeletedQaLists, {
        canManage,
        canPermanentlyDelete,
        offlineMode,
        lifecycleActionsDisabled,
        writeActionsDisabled,
        defaultQaListIdsByLanguage,
        syncSnapshotsByRepoName,
        suppressMissingLocalRepoRepair: refreshInProgress,
      })}
    </section>
  `;

  return (
    pageShell({
      title: "QA Lists",
      subtitle: selectedTeam?.name ?? "Team",
      titleAction: buildPageRefreshAction(state, state.pageSync, "refresh-page", {
        backgroundRefreshing: refreshInProgress || coordinatorWriteActive,
        backgroundRefreshStartedAt: state.qaListsPage?.refreshStartedAt,
      }),
      navButtons: buildSectionNav("qa", { includeAiSettings: canManageAiSettings }),
      tools: canCreate
        ? `${textAction("Import", "import-qa-list", { disabled: offlineMode || writeActionsDisabled })} ${primaryButton("+ New QA List", "open-new-qa-list", { disabled: offlineMode || writeActionsDisabled })}`
        : "",
      pageSync: state.pageSync,
      syncBadgeText: getScopedSyncBadgeText("qa"),
      noticeText: getNoticeBadgeText(),
      statusItems: getStatusSurfaceItems("qa"),
      offlineMode,
      offlineReconnectState: state.offline?.reconnecting === true,
      body,
    }) +
    renderQaListCreationModal(state) +
    renderQaListImportModal(state) +
    renderQaListRenameModal(state) +
    renderQaListPermanentDeletionModal(state)
  );
}
