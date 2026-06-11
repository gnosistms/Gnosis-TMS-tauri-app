import {
  prepareStoredBrokerSessionRestore,
  registerBrokerAuthListener,
  registerGithubAppInstallListener,
  restoreStoredBrokerSession,
} from "./app/auth-flow.js";
import { registerAppEvents } from "./app/events.js";
import {
  initializeEditorVirtualization,
} from "./app/editor-virtualization.js";
import { loadUserTeams, setGithubAppInstallation } from "./app/team-setup-flow.js";
import { syncLanguagePickerAlphabetIndexes } from "./app/language-picker-alphabet-index.js";
import { initializeConnectivity } from "./app/offline-connectivity.js";
import { initializePersistentStorage } from "./app/persistent-store.js";
import { initTelemetry, installTelemetryCrashHandlers } from "./app/telemetry.js";
import { openTelemetryDisclosureIfNeeded } from "./app/telemetry-disclosure-flow.js";
import { app, initializeWindowPresentation } from "./app/runtime.js";
import {
  clearEditorScrollDebugEntries,
  editorScrollDebugPathHint,
  flushEditorScrollDebugLog,
  logEditorScrollDebug,
  readEditorScrollDebugEntries,
} from "./app/editor-scroll-debug.js";
import { measureEditorGlossaryAlignment } from "./app/editor-glossary-alignment-debug.js";
import {
  syncEditorAssistantDraftTextareaHeights,
  syncEditorCommentDraftTextareaHeights,
  syncEditorConflictResolutionTextareaHeights,
  syncEditorRowTextareaHeights,
  syncGlossaryVariantTextareaHeights,
} from "./app/autosize.js";
import {
  applyEditorRegressionFixture,
  applyEditorRegressionRestore,
  applyEditorRegressionSoftDelete,
  readEditorRegressionSnapshot,
} from "./app/editor-regression-fixture.js";
import { patchMountedEditorRows } from "./app/editor-row-patch.js";
import { readDevRuntimeFlags } from "./app/dev-runtime-flags.js";
import {
  captureFocusedInputState,
  restoreFocusedInputState,
  shouldRestoreFocusedInputStateForScope,
} from "./app/focused-input-state.js";
import { buildEditorFieldSelector } from "./app/editor-utils.js";
import {
  EDITOR_MODE_PREVIEW,
  normalizeEditorMode,
} from "./app/editor-preview.js";
import { getEditorOperationQueueSnapshot } from "./app/editor-operation-queue.js";
import { getRepoWriteQueueSnapshot } from "./app/repo-write-queue.js";
import { hasPendingEditorWrites } from "./app/editor-persistence-flow.js";
import {
  persistCurrentEditorLocation,
  prepareEditorLocationBeforeRender,
  queuePendingEditorLocationRestore,
  restorePendingEditorLocation,
  scheduleEditorLocationSave,
} from "./app/editor-location.js";
import { refreshCurrentScreen as refreshCurrentScreenFlow } from "./app/navigation.js";
import {
  captureRenderScrollSnapshot,
  captureVisibleTranslateLocation,
  queueTranslateRowAnchor,
  readPendingTranslateAnchor,
  resolveTranslateRowAnchor,
  restoreRenderScrollSnapshot,
  restoreTranslateRowAnchor,
} from "./app/scroll-state.js";
import {
  createEditorPendingSelectionState,
  hydratePersistentAppState,
  state,
} from "./app/state.js";
import { noteGlossaryBackgroundSyncScrollActivity } from "./app/glossary-background-sync.js";
import { noteQaListBackgroundSyncScrollActivity } from "./app/qa-background-sync.js";
import {
  startEditorBackgroundSyncSession,
  syncEditorBackgroundNow,
} from "./app/editor-background-sync.js";
import {
  flushDirtyEditorRows,
  noteEditorBackgroundSyncScrollActivity,
  captureTargetLanguageManagerPickerScrollTop,
  restoreEditorFieldHistory,
  restoreTargetLanguageManagerPickerScrollTop,
  runEditorAiTranslate,
  scheduleDirtyEditorRowScan,
  toggleEditorReplaceEnabled,
} from "./app/translate-flow.js";
import { registerTranslateEditorDomEvents } from "./app/translate-editor-dom-events.js";
import { checkForAppUpdate } from "./app/updater-flow.js";
import { renderAppUpdateModal } from "./screens/app-update-modal.js";
import { renderConnectionFailureModal } from "./screens/connection-failure-modal.js";
import { renderEditorAiTranslateAllModal } from "./screens/editor-ai-translate-all-modal.js";
import { renderEditorDeriveGlossariesModal } from "./screens/editor-derive-glossaries-modal.js";
import { renderEditorImagePreviewOverlay } from "./screens/editor-image-preview-overlay.js";
import { renderGlossariesScreen } from "./screens/glossaries.js";
import { renderGlossaryEditorScreen } from "./screens/glossary-editor.js";
import { renderNavigationLoadingModal } from "./screens/navigation-loading-modal.js";
import { renderProjectsScreen } from "./screens/projects.js";
import { renderQaListEditorScreen } from "./screens/qa-list-editor.js";
import { renderQaScreen } from "./screens/qa.js";
import { renderTeamResourceMigrationModal } from "./screens/team-resource-migration-modal.js";
import { renderTelemetryDisclosureModal } from "./screens/telemetry-disclosure-modal.js";
import { renderAiKeyScreen } from "./screens/ai-key.js";
import { renderStartScreen } from "./screens/start.js";
import { renderTeamsScreen } from "./screens/teams/index.js";
import {
  renderTranslateEditorBody,
  renderTranslateHeaderDetail,
  renderTranslateScreen,
  renderTranslateSidebar,
} from "./screens/translate.js";
import { renderUsersScreen } from "./screens/users.js";
import {
  buildPageRefreshAction,
  renderFloatingStatusSurface,
} from "./lib/ui.js";
import {
  getNoticeBadgeText,
  getScopedSyncBadgeText,
  getStatusSurfaceItems,
  showNoticeBadge,
} from "./app/status-feedback.js";
import {
  createEditorCloseGuard,
  EDITOR_CLOSE_GUARD_NOTICE_DURATION_MS,
} from "./app/editor-close-guard.js";

// Install crash handlers as early as possible so first-run crashes are captured (and
// buffered until the consent gate opens). See plans/telemetry-plan.md.
installTelemetryCrashHandlers();

const screenRenderers = {
  start: () => renderStartScreen(state),
  aiKey: () => renderAiKeyScreen(state),
  teams: () => renderTeamsScreen(state),
  projects: () => renderProjectsScreen(state),
  users: () => renderUsersScreen(state),
  glossaries: () => renderGlossariesScreen(state),
  qa: () => renderQaScreen(state),
  qaListEditor: () => renderQaListEditorScreen(state),
  glossaryEditor: () => renderGlossaryEditorScreen(state),
  translate: () => renderTranslateScreen(state),
};

const titles = {
  start: "Gnosis TMS",
  aiKey: "AI Settings - Gnosis TMS",
  teams: "Translation Teams - Gnosis TMS",
  projects: "Projects - Gnosis TMS",
  users: "Members - Gnosis TMS",
  glossaries: "Glossaries - Gnosis TMS",
  qa: "QA Lists - Gnosis TMS",
  qaListEditor: "QA List Editor - Gnosis TMS",
  glossaryEditor: "Glossary Editor - Gnosis TMS",
  translate: "Translate - Gnosis TMS",
};

let bootstrapPromise = Promise.resolve();

function currentStatusSurfaceModel() {
  const noticeText = getNoticeBadgeText();

  if (state.screen === "projects") {
    return {
      pageSync: state.projectsPageSync,
      syncBadgeText: getScopedSyncBadgeText("projects"),
      noticeText,
      statusItems: getStatusSurfaceItems("projects"),
    };
  }

  const scopedScreens = {
    teams: "teams",
    users: "members",
    glossaries: "glossaries",
    glossaryEditor: "glossaryEditor",
    qa: "qa",
    qaListEditor: "qaListEditor",
  };
  const scope = scopedScreens[state.screen] ?? null;

  return {
    pageSync: state.pageSync,
    syncBadgeText: scope ? getScopedSyncBadgeText(scope) : "",
    noticeText,
    statusItems: scope ? getStatusSurfaceItems(scope) : null,
  };
}

function renderStatusSurfaceOnly() {
  const screen = app.firstElementChild;
  if (!(screen instanceof HTMLElement) || !screen.classList.contains("screen--page")) {
    return false;
  }

  const nextHtml = renderFloatingStatusSurface(currentStatusSurfaceModel()).trim();
  const currentSurface = screen.querySelector(":scope > .team-ui-debug");
  if (currentSurface instanceof HTMLElement) {
    if (nextHtml) {
      currentSurface.outerHTML = nextHtml;
    } else {
      currentSurface.remove();
    }
    return true;
  }

  if (nextHtml) {
    screen.insertAdjacentHTML("beforeend", nextHtml);
  }
  return true;
}

function renderPageTitleActionOnly() {
  if (state.screen !== "translate") {
    return false;
  }

  const titleRow = app.querySelector(".page-header__title-row");
  if (!(titleRow instanceof HTMLElement)) {
    return false;
  }

  const nextHtml = buildPageRefreshAction(state).trim();
  const currentAction = titleRow.querySelector(".title-icon-button");
  if (currentAction instanceof HTMLElement) {
    currentAction.outerHTML = nextHtml;
    return true;
  }

  if (nextHtml) {
    titleRow.insertAdjacentHTML("beforeend", nextHtml);
    return true;
  }

  return false;
}

function waitForNextAnimationFrames(count = 1) {
  const frameCount = Number.isInteger(count) && count > 0 ? count : 1;
  return new Promise((resolve) => {
    let remaining = frameCount;
    const tick = () => {
      if (remaining <= 0) {
        resolve();
        return;
      }

      remaining -= 1;
      window.requestAnimationFrame(tick);
    };
    tick();
  });
}

function patchFixtureEditorRowState(rowId, updates = {}) {
  if (!rowId || !state.editorChapter?.chapterId || !Array.isArray(state.editorChapter.rows)) {
    return false;
  }

  let rowChanged = false;
  state.editorChapter = {
    ...state.editorChapter,
    rows: state.editorChapter.rows.map((row) => {
      if (!row || row.rowId !== rowId) {
        return row;
      }

      rowChanged = true;
      const fieldUpdates =
        updates?.fields && typeof updates.fields === "object"
          ? updates.fields
          : null;
      const nextFields = fieldUpdates
        ? {
            ...(row.fields ?? {}),
            ...fieldUpdates,
          }
        : (row.fields ?? {});
      const nextPersistedFields = fieldUpdates
        ? {
            ...(row.persistedFields ?? {}),
            ...fieldUpdates,
          }
        : (row.persistedFields ?? row.fields ?? {});

      return {
        ...row,
        ...(fieldUpdates
          ? {
              fields: nextFields,
              persistedFields: nextPersistedFields,
            }
          : {}),
        ...(typeof updates?.textStyle === "string" && updates.textStyle.trim()
          ? { textStyle: updates.textStyle.trim() }
          : {}),
        ...(typeof updates?.freshness === "string" && updates.freshness.trim()
          ? { freshness: updates.freshness.trim() }
          : {}),
        ...(typeof updates?.remotelyDeleted === "boolean"
          ? { remotelyDeleted: updates.remotelyDeleted }
          : {}),
        saveStatus: "idle",
        saveError: "",
      };
    }),
  };

  return rowChanged;
}

function render(options = {}) {
  return renderWithOptions(options);
}

function currentTranslateMode() {
  return normalizeEditorMode(state.editorChapter?.mode);
}

function scrollActivePreviewSearchMatchIntoView(root = app) {
  if (state.screen !== "translate" || currentTranslateMode() !== EDITOR_MODE_PREVIEW) {
    return;
  }

  const activeMatch = root.querySelector?.(".translate-preview__search-match.is-active");
  if (!(activeMatch instanceof HTMLElement)) {
    return;
  }

  activeMatch.scrollIntoView({
    block: "center",
    inline: "nearest",
  });
}

function restorePendingEditorSelection(root = app) {
  const pendingSelection = state.editorChapter?.pendingSelection;
  const rowId =
    typeof pendingSelection?.rowId === "string" && pendingSelection.rowId.trim()
      ? pendingSelection.rowId.trim()
      : "";
  const languageCode =
    typeof pendingSelection?.languageCode === "string" && pendingSelection.languageCode.trim()
      ? pendingSelection.languageCode.trim()
      : "";
  const offset = Number.parseInt(String(pendingSelection?.offset ?? ""), 10);
  if (!rowId || !languageCode || !Number.isInteger(offset) || offset < 0) {
    return false;
  }

  const field = root.querySelector?.(buildEditorFieldSelector(rowId, languageCode));
  state.editorChapter = {
    ...state.editorChapter,
    pendingSelection: createEditorPendingSelectionState(),
  };
  if (!(field instanceof HTMLTextAreaElement)) {
    return false;
  }

  const boundedOffset = Math.max(0, Math.min(field.value.length, offset));
  field.focus({ preventScroll: true });
  field.setSelectionRange(boundedOffset, boundedOffset, "none");
  return true;
}

function resolveTranslateRenderAnchor(options = {}) {
  const includeVisibleFallback = options?.includeVisibleFallback !== false;
  const pendingAnchor = readPendingTranslateAnchor();
  if (pendingAnchor?.rowId) {
    return {
      anchor: pendingAnchor,
      hadPendingAnchor: true,
      usedVisibleFallback: false,
    };
  }

  const activeAnchor = resolveTranslateRowAnchor(document.activeElement);
  if (activeAnchor?.rowId) {
    return {
      anchor: activeAnchor,
      hadPendingAnchor: false,
      usedVisibleFallback: false,
    };
  }

  const visibleAnchor = includeVisibleFallback ? captureVisibleTranslateLocation() : null;
  return {
    anchor: visibleAnchor,
    hadPendingAnchor: false,
    usedVisibleFallback: Boolean(visibleAnchor?.rowId),
  };
}

function renderTranslateBodyOnly(options = {}) {
  const body = app.querySelector(".page-body.page-body--editor");
  if (!(body instanceof HTMLElement)) {
    renderWithOptions();
    return;
  }

  const focusSnapshot = captureFocusedInputState();
  const assistantTranscriptScrollTop = captureAssistantTranscriptScrollTop(app);
  const scrollSnapshot = captureRenderScrollSnapshot("translate");
  const skipAnchorRestore = options?.skipTranslateAnchorRestore === true;
  const {
    anchor: translateAnchor,
    hadPendingAnchor,
    usedVisibleFallback,
  } = skipAnchorRestore
    ? { anchor: null, hadPendingAnchor: false, usedVisibleFallback: false }
    : resolveTranslateRenderAnchor({
      includeVisibleFallback: false,
    });
  body.innerHTML = renderTranslateEditorBody(state);
  restoreRenderScrollSnapshot("translate", "translate", scrollSnapshot);
  if (!skipAnchorRestore && !hadPendingAnchor && translateAnchor?.rowId) {
    queueTranslateRowAnchor(translateAnchor);
  }
  initializeEditorVirtualization(app, state);
  const restoredPendingLocation = false;
  const restoredAnchor = !skipAnchorRestore && translateAnchor?.rowId
    ? restoreTranslateRowAnchor(translateAnchor)
    : false;
  logEditorScrollDebug("translate-body-rerender", {
    focusedRowId: focusSnapshot?.rowId ?? "",
    anchorRowId: translateAnchor?.rowId ?? "",
    restoredPendingLocation,
    restoredAnchor,
    usedVisibleFallback,
  });
  const restoredFocus = shouldRestoreFocusedInputStateForScope(focusSnapshot, "translate-body")
    ? restoreFocusedInputState(focusSnapshot)
    : false;
  if (focusSnapshot?.kind === "editor-row-field" && !restoredFocus && focusSnapshot.rowId) {
    scheduleDirtyEditorRowScan(render, focusSnapshot.rowId);
  }
  syncEditorRowTextareaHeights(body);
  restorePendingEditorSelection(body);
  restoreAssistantTranscriptScrollTop(assistantTranscriptScrollTop, app);
  scrollActivePreviewSearchMatchIntoView(body);
}

function renderTranslateSidebarOnly() {
  if (currentTranslateMode() === EDITOR_MODE_PREVIEW) {
    return;
  }

  const sidebar = app.querySelector(".translate-sidebar-scroll");
  if (!(sidebar instanceof HTMLElement)) {
    renderWithOptions();
    return;
  }

  const focusSnapshot = captureFocusedInputState();
  const scrollTop = sidebar.scrollTop;
  const assistantTranscriptScrollTop = captureAssistantTranscriptScrollTop(sidebar);
  sidebar.innerHTML = renderTranslateSidebar(state);
  sidebar.scrollTop = scrollTop;
  syncEditorAssistantDraftTextareaHeights(sidebar);
  syncEditorCommentDraftTextareaHeights(sidebar);
  restoreAssistantTranscriptScrollTop(assistantTranscriptScrollTop, sidebar);
  if (shouldRestoreFocusedInputStateForScope(focusSnapshot, "translate-sidebar")) {
    restoreFocusedInputState(focusSnapshot);
  }
}

function captureAssistantTranscriptScrollTop(root = app) {
  const transcript = root?.querySelector?.(".assistant-transcript");
  return transcript instanceof HTMLElement ? transcript.scrollTop : null;
}

function restoreAssistantTranscriptScrollTop(scrollTop, root = app) {
  if (!Number.isFinite(scrollTop)) {
    return;
  }

  const transcript = root?.querySelector?.(".assistant-transcript");
  if (transcript instanceof HTMLElement) {
    transcript.scrollTop = scrollTop;
    requestAnimationFrame(() => {
      const nextTranscript = root?.querySelector?.(".assistant-transcript");
      if (nextTranscript instanceof HTMLElement) {
        nextTranscript.scrollTop = scrollTop;
      }
    });
  }
}

function renderTranslateHeaderOnly() {
  const headerDetail = app.querySelector(".page-header__detail");
  if (!(headerDetail instanceof HTMLElement)) {
    renderWithOptions();
    return;
  }

  const focusSnapshot = captureFocusedInputState();
  headerDetail.innerHTML = renderTranslateHeaderDetail(state);
  if (shouldRestoreFocusedInputStateForScope(focusSnapshot, "translate-header")) {
    restoreFocusedInputState(focusSnapshot);
  }
}

function renderTranslateVisibleRowsOnly(options = {}) {
  return patchMountedEditorRows(app, state, options?.rowIds, {
    reason: options?.reason,
  });
}

function renderTranslateAiTranslateAllModalOnly() {
  const html = renderEditorAiTranslateAllModal(state);
  const modalCard = app.querySelector(".modal-card--ai-translate-all");
  const backdrop = modalCard?.closest?.(".modal-backdrop");
  if (backdrop instanceof HTMLElement) {
    if (html) {
      backdrop.outerHTML = html;
    } else {
      backdrop.remove();
    }
    return;
  }

  if (html) {
    app.insertAdjacentHTML("beforeend", html);
  }
}

function renderTranslateDeriveGlossariesModalOnly() {
  const html = renderEditorDeriveGlossariesModal(state);
  const modalCard = app.querySelector(".modal-card--derive-glossaries");
  const backdrop = modalCard?.closest?.(".modal-backdrop");
  if (backdrop instanceof HTMLElement) {
    if (html) {
      backdrop.outerHTML = html;
    } else {
      backdrop.remove();
    }
    return;
  }

  if (html) {
    app.insertAdjacentHTML("beforeend", html);
  }
}

function renderTranslateImagePreviewOverlayOnly() {
  const html = renderEditorImagePreviewOverlay(state);
  const overlay = app.querySelector(".editor-image-preview-overlay");
  if (overlay instanceof HTMLElement) {
    if (html) {
      overlay.outerHTML = html;
    } else {
      overlay.remove();
    }
    return;
  }

  if (html) {
    app.insertAdjacentHTML("beforeend", html);
  }
}

function renderWithOptions(options = {}) {
  if (options?.scope === "status-surface") {
    if (!renderStatusSurfaceOnly()) {
      renderWithOptions();
    }
    renderPageTitleActionOnly();
    return;
  }

  if (options?.scope === "translate-visible-rows" && state.screen === "translate") {
    return renderTranslateVisibleRowsOnly(options);
  }

  if (options?.scope === "translate-body" && state.screen === "translate") {
    renderTranslateBodyOnly(options);
    return;
  }

  if (options?.scope === "translate-header" && state.screen === "translate") {
    renderTranslateHeaderOnly();
    return;
  }

  if (options?.scope === "translate-sidebar" && state.screen === "translate") {
    renderTranslateSidebarOnly();
    return;
  }

  if (options?.scope === "translate-ai-translate-all-modal" && state.screen === "translate") {
    renderTranslateAiTranslateAllModalOnly();
    return;
  }

  if (options?.scope === "translate-derive-glossaries-modal" && state.screen === "translate") {
    renderTranslateDeriveGlossariesModalOnly();
    return;
  }

  if (options?.scope === "translate-image-preview-overlay" && state.screen === "translate") {
    renderTranslateImagePreviewOverlayOnly();
    return;
  }

  const previousScreen = app.firstElementChild?.getAttribute("data-screen") ?? null;
  prepareEditorLocationBeforeRender(previousScreen, state);
  const focusSnapshot = captureFocusedInputState();
  const {
    anchor: translateAnchor,
    hadPendingAnchor,
    usedVisibleFallback,
  } =
    previousScreen === "translate" && state.screen === "translate"
      ? resolveTranslateRenderAnchor({ includeVisibleFallback: false })
      : { anchor: null, hadPendingAnchor: false, usedVisibleFallback: false };
  const scrollSnapshot = captureRenderScrollSnapshot(previousScreen);
  const targetLanguageManagerPickerScrollTop = captureTargetLanguageManagerPickerScrollTop();
  const renderScreen = screenRenderers[state.screen] ?? screenRenderers.start;
  const assistantTranscriptScrollTop =
    previousScreen === "translate" && state.screen === "translate"
      ? captureAssistantTranscriptScrollTop(app)
      : null;
  app.innerHTML =
    renderScreen()
    + renderAppUpdateModal(state)
    + renderNavigationLoadingModal(state)
    + renderTeamResourceMigrationModal(state)
    + renderTelemetryDisclosureModal(state)
    + renderConnectionFailureModal(state);
  syncGlossaryVariantTextareaHeights(app);
  if (app.firstElementChild instanceof HTMLElement) {
    app.firstElementChild.dataset.screen = state.screen;
  }
  restoreRenderScrollSnapshot(previousScreen, state.screen, scrollSnapshot);
  if (!hadPendingAnchor && translateAnchor?.rowId) {
    queueTranslateRowAnchor(translateAnchor);
  }
  queuePendingEditorLocationRestore(state);
  initializeEditorVirtualization(app, state);
  const restoredPendingLocation = restorePendingEditorLocation(state);
  let restoredAnchor = false;
  if (!restoredPendingLocation && translateAnchor?.rowId) {
    restoredAnchor = restoreTranslateRowAnchor(translateAnchor);
  }
  if (previousScreen === "translate" && state.screen === "translate") {
    logEditorScrollDebug("translate-full-rerender", {
      focusedRowId: focusSnapshot?.rowId ?? "",
      anchorRowId: translateAnchor?.rowId ?? "",
      restoredPendingLocation,
      restoredAnchor,
      usedVisibleFallback,
    });
  }
  const restoredFocus = shouldRestoreFocusedInputStateForScope(focusSnapshot, "full")
    ? restoreFocusedInputState(focusSnapshot)
    : false;
  if (focusSnapshot?.kind === "editor-row-field" && !restoredFocus && focusSnapshot.rowId) {
    scheduleDirtyEditorRowScan(render, focusSnapshot.rowId);
  }
  syncEditorRowTextareaHeights(app);
  restorePendingEditorSelection(app);
  syncEditorConflictResolutionTextareaHeights(app);
  syncEditorAssistantDraftTextareaHeights(app);
  syncEditorCommentDraftTextareaHeights(app);
  restoreAssistantTranscriptScrollTop(assistantTranscriptScrollTop, app);
  scrollActivePreviewSearchMatchIntoView(app);
  syncLanguagePickerAlphabetIndexes(app);
  restoreTargetLanguageManagerPickerScrollTop(targetLanguageManagerPickerScrollTop);
  document.title = titles[state.screen] ?? "Gnosis TMS";
}

app.addEventListener("scroll", (event) => {
  if (state.screen === "glossaryEditor") {
    noteGlossaryBackgroundSyncScrollActivity();
  }
  if (state.screen === "qaListEditor") {
    noteQaListBackgroundSyncScrollActivity();
  }

  const container = event.target instanceof Element ? event.target.closest(".translate-main-scroll") : null;
  if (!(container instanceof HTMLElement)) {
    return;
  }

  noteEditorBackgroundSyncScrollActivity();
  scheduleEditorLocationSave(state);
}, true);

function editorHasPendingDurableWrites() {
  const repoWriteSnapshot = getRepoWriteQueueSnapshot();
  return (
    state.screen === "translate"
    && (
      hasPendingEditorWrites(state.editorChapter)
      || getEditorOperationQueueSnapshot().hasActiveOperations
      || repoWriteSnapshot.hasActiveLocalWrites
      || repoWriteSnapshot.hasRunningRemoteSync
    )
  );
}

// Set when the user force-closes past pending writes so beforeunload does not
// re-block a close the user already approved.
let editorCloseForceApproved = false;

const editorCloseGuard = createEditorCloseGuard({
  hasPendingDurableWrites: editorHasPendingDurableWrites,
  showBlockedNotice: (message) => showNoticeBadge(message, render, EDITOR_CLOSE_GUARD_NOTICE_DURATION_MS),
});

window.addEventListener("beforeunload", (event) => {
  persistCurrentEditorLocation(state);
  if (editorCloseForceApproved || !editorHasPendingDurableWrites()) {
    return;
  }

  event.preventDefault();
  event.returnValue = "Editor changes are still saving. Leave after saving finishes.";
});

function registerTauriEditorCloseGuard() {
  const getCurrentWindow = window.__TAURI__?.window?.getCurrentWindow;
  if (typeof getCurrentWindow !== "function") {
    return;
  }

  try {
    const currentWindow = getCurrentWindow();
    if (typeof currentWindow?.onCloseRequested !== "function") {
      return;
    }

    void currentWindow.onCloseRequested((event) => {
      persistCurrentEditorLocation(state);
      const { allowClose, forced } = editorCloseGuard.handleCloseRequest();
      if (allowClose) {
        if (forced) {
          editorCloseForceApproved = true;
        }
        return;
      }

      event?.preventDefault?.();
    });
  } catch {}
}

registerTauriEditorCloseGuard();

window.__gnosisDebug = {
  waitForBootstrap() {
    return bootstrapPromise.catch(() => undefined);
  },
  showStartAuthMessage(message, status = "expired") {
    state.screen = "start";
    state.auth.status = status;
    state.auth.message = message;
    render();
  },
  clearStartAuthMessage() {
    state.screen = "start";
    state.auth.status = "idle";
    state.auth.message = "";
    render();
  },
  editorScrollDebugPathHint() {
    return editorScrollDebugPathHint();
  },
  flushEditorScrollDebugLog() {
    return flushEditorScrollDebugLog();
  },
  readEditorScrollDebugEntries() {
    return readEditorScrollDebugEntries();
  },
  clearEditorScrollDebugEntries() {
    clearEditorScrollDebugEntries();
    return [];
  },
  async measureEditorGlossaryAlignment(options = {}) {
    await bootstrapPromise.catch(() => undefined);
    return measureEditorGlossaryAlignment(options);
  },
  async mountEditorFixture(options = {}) {
    await bootstrapPromise.catch(() => undefined);
    const summary = applyEditorRegressionFixture(state, options);
    render();
    return {
      ...summary,
      state: readEditorRegressionSnapshot(state),
    };
  },
  async flushDirtyRows() {
    await flushDirtyEditorRows(render);
    return readEditorRegressionSnapshot(state);
  },
  async runEditorBackgroundSync(options = {}) {
    await bootstrapPromise.catch(() => undefined);
    startEditorBackgroundSyncSession(render);
    const payload = await syncEditorBackgroundNow(render, {
      skipDirtyFlush: options?.skipDirtyFlush === true,
      afterLocalCommit: options?.afterLocalCommit === true,
    });
    await waitForNextAnimationFrames(2);
    return {
      payload,
      state: readEditorRegressionSnapshot(state),
    };
  },
  async refreshCurrentScreen() {
    await bootstrapPromise.catch(() => undefined);
    await refreshCurrentScreenFlow(render);
    await waitForNextAnimationFrames(2);
    return readEditorRegressionSnapshot(state);
  },
  softDeleteFixtureRow(rowId) {
    const summary = applyEditorRegressionSoftDelete(state, rowId);
    if (summary) {
      render();
    }
    return summary;
  },
  restoreFixtureRow(rowId) {
    const summary = applyEditorRegressionRestore(state, rowId);
    if (summary) {
      render();
    }
    return summary;
  },
  readEditorState() {
    return readEditorRegressionSnapshot(state);
  },
  readQueueState() {
    return {
      editorOperations: getEditorOperationQueueSnapshot(),
      repoWrites: getRepoWriteQueueSnapshot(),
    };
  },
  async patchFixtureRow(rowId, updates = {}) {
    const rowChanged = patchFixtureEditorRowState(rowId, updates);
    if (!rowChanged) {
      return {
        patchedVisible: false,
        state: readEditorRegressionSnapshot(state),
      };
    }

    const patchSummary = render({
      scope: "translate-visible-rows",
      rowIds: [rowId],
      reason: "debug-row-patch",
    });
    await waitForNextAnimationFrames(2);
    return {
      ...patchSummary,
      state: readEditorRegressionSnapshot(state),
    };
  },
  setEditorReplaceEnabled(enabled) {
    toggleEditorReplaceEnabled(render, enabled === true);
    return readEditorRegressionSnapshot(state);
  },
  async runEditorAiTranslate(actionId = "translate1") {
    await runEditorAiTranslate(render, actionId);
    return readEditorRegressionSnapshot(state);
  },
  async restoreEditorFieldHistory(commitSha) {
    await restoreEditorFieldHistory(render, commitSha);
    return readEditorRegressionSnapshot(state);
  },
  setEditorRowSyncState(rowId, updates = {}) {
    if (!rowId || !state.editorChapter?.chapterId || !Array.isArray(state.editorChapter.rows)) {
      return readEditorRegressionSnapshot(state);
    }

    state.editorChapter = {
      ...state.editorChapter,
      rows: state.editorChapter.rows.map((row) => {
        if (!row || row.rowId !== rowId) {
          return row;
        }

        return {
          ...row,
          ...(typeof updates?.freshness === "string" ? { freshness: updates.freshness } : {}),
          ...(typeof updates?.remotelyDeleted === "boolean" ? { remotelyDeleted: updates.remotelyDeleted } : {}),
        };
      }),
    };
    return readEditorRegressionSnapshot(state);
  },
};

async function bootstrap() {
  render();
  await initializePersistentStorage();
  const needsTelemetryDisclosure = openTelemetryDisclosureIfNeeded(render);
  if (!needsTelemetryDisclosure) {
    // Telemetry needs the persistent store (consent + install id); fire-and-forget so it
    // never delays startup. No-ops until a DSN is configured.
    void initTelemetry();
  }
  hydratePersistentAppState();
  await initializeWindowPresentation();
  registerAppEvents(render);
  registerTranslateEditorDomEvents(app, render);
  const devRuntimeFlags = readDevRuntimeFlags();
  if (devRuntimeFlags.editorFixture) {
    applyEditorRegressionFixture(state, devRuntimeFlags.editorFixture);
    render();
    return;
  }

  const storedBrokerSession = await prepareStoredBrokerSessionRestore();
  void registerBrokerAuthListener(render, loadUserTeams);
  void registerGithubAppInstallListener(render, setGithubAppInstallation);
  void checkForAppUpdate(render, { silent: true });
  render();
  void initializeConnectivity(render, () => restoreStoredBrokerSession(render, loadUserTeams, storedBrokerSession));
}

bootstrapPromise = bootstrap();
void bootstrapPromise;
