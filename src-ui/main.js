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
import { initializeConnectivity } from "./app/offline-connectivity.js";
import { initializePersistentStorage } from "./app/persistent-store.js";
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
import {
  startEditorBackgroundSyncSession,
  syncEditorBackgroundNow,
} from "./app/editor-background-sync.js";
import {
  flushDirtyEditorRows,
  noteEditorBackgroundSyncScrollActivity,
  restoreEditorFieldHistory,
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
import { renderGlossariesScreen } from "./screens/glossaries.js";
import { renderGlossaryEditorScreen } from "./screens/glossary-editor.js";
import { renderNavigationLoadingModal } from "./screens/navigation-loading-modal.js";
import { renderProjectsScreen } from "./screens/projects.js";
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

const screenRenderers = {
  start: () => renderStartScreen(state),
  aiKey: () => renderAiKeyScreen(state),
  teams: () => renderTeamsScreen(state),
  projects: () => renderProjectsScreen(state),
  users: () => renderUsersScreen(state),
  glossaries: () => renderGlossariesScreen(state),
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
  glossaryEditor: "Glossary Editor - Gnosis TMS",
  translate: "Translate - Gnosis TMS",
};

let bootstrapPromise = Promise.resolve();

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

function renderTranslateBodyOnly() {
  const body = app.querySelector(".page-body.page-body--editor");
  if (!(body instanceof HTMLElement)) {
    renderWithOptions();
    return;
  }

  const focusSnapshot = captureFocusedInputState();
  const assistantTranscriptScrollTop = captureAssistantTranscriptScrollTop(app);
  const scrollSnapshot = captureRenderScrollSnapshot("translate");
  const {
    anchor: translateAnchor,
    hadPendingAnchor,
    usedVisibleFallback,
  } = resolveTranslateRenderAnchor({
    includeVisibleFallback: false,
  });
  body.innerHTML = renderTranslateEditorBody(state);
  restoreRenderScrollSnapshot("translate", "translate", scrollSnapshot);
  if (!hadPendingAnchor && translateAnchor?.rowId) {
    queueTranslateRowAnchor(translateAnchor);
  }
  initializeEditorVirtualization(app, state);
  const restoredPendingLocation = false;
  const restoredAnchor = translateAnchor?.rowId
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

function renderWithOptions(options = {}) {
  if (options?.scope === "translate-visible-rows" && state.screen === "translate") {
    return renderTranslateVisibleRowsOnly(options);
  }

  if (options?.scope === "translate-body" && state.screen === "translate") {
    renderTranslateBodyOnly();
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
  const renderScreen = screenRenderers[state.screen] ?? screenRenderers.start;
  const assistantTranscriptScrollTop =
    previousScreen === "translate" && state.screen === "translate"
      ? captureAssistantTranscriptScrollTop(app)
      : null;
  app.innerHTML =
    renderScreen()
    + renderAppUpdateModal(state)
    + renderNavigationLoadingModal(state)
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
  syncEditorAssistantDraftTextareaHeights(app);
  syncEditorCommentDraftTextareaHeights(app);
  restoreAssistantTranscriptScrollTop(assistantTranscriptScrollTop, app);
  scrollActivePreviewSearchMatchIntoView(app);
  document.title = titles[state.screen] ?? "Gnosis TMS";
}

app.addEventListener("scroll", (event) => {
  if (state.screen === "glossaryEditor") {
    noteGlossaryBackgroundSyncScrollActivity();
  }

  const container = event.target instanceof Element ? event.target.closest(".translate-main-scroll") : null;
  if (!(container instanceof HTMLElement)) {
    return;
  }

  noteEditorBackgroundSyncScrollActivity();
  scheduleEditorLocationSave(state);
}, true);

window.addEventListener("beforeunload", () => {
  persistCurrentEditorLocation(state);
});

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
