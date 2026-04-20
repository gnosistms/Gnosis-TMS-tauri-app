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
import {
  loadGithubAppTestConfig,
  registerGithubAppTestListener,
} from "./app/github-app-test-flow.js";
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
import {
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
import { readDevRuntimeFlags } from "./app/dev-runtime-flags.js";
import {
  captureFocusedInputState,
  restoreFocusedInputState,
} from "./app/focused-input-state.js";
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
import {
  captureRenderScrollSnapshot,
  captureVisibleTranslateLocation,
  queueTranslateRowAnchor,
  readPendingTranslateAnchor,
  resolveTranslateRowAnchor,
  restoreRenderScrollSnapshot,
  restoreTranslateRowAnchor,
} from "./app/scroll-state.js";
import { hydratePersistentAppState, state } from "./app/state.js";
import { noteGlossaryBackgroundSyncScrollActivity } from "./app/glossary-background-sync.js";
import {
  flushDirtyEditorRows,
  noteEditorBackgroundSyncScrollActivity,
  scheduleDirtyEditorRowScan,
  toggleEditorReplaceEnabled,
} from "./app/translate-flow.js";
import { registerTranslateEditorDomEvents } from "./app/translate-editor-dom-events.js";
import { checkForAppUpdate } from "./app/updater-flow.js";
import { renderGithubAppTestScreen } from "./screens/github-app-test.js";
import { renderAppUpdateModal } from "./screens/app-update-modal.js";
import { renderConnectionFailureModal } from "./screens/connection-failure-modal.js";
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
  githubAppTest: () => renderGithubAppTestScreen(state),
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
  githubAppTest: "GitHub App Auth Test - Gnosis TMS",
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
  queuePendingEditorLocationRestore(state);
  initializeEditorVirtualization(app, state);
  const restoredPendingLocation = restorePendingEditorLocation(state);
  let restoredAnchor = false;
  if (!restoredPendingLocation && translateAnchor?.rowId) {
    restoredAnchor = restoreTranslateRowAnchor(translateAnchor);
  }
  logEditorScrollDebug("translate-body-rerender", {
    focusedRowId: focusSnapshot?.rowId ?? "",
    anchorRowId: translateAnchor?.rowId ?? "",
    restoredPendingLocation,
    restoredAnchor,
    usedVisibleFallback,
  });
  const restoredFocus = restoreFocusedInputState(focusSnapshot);
  if (focusSnapshot?.kind === "editor-row-field" && !restoredFocus && focusSnapshot.rowId) {
    scheduleDirtyEditorRowScan(render, focusSnapshot.rowId);
  }
  syncEditorRowTextareaHeights(body);
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
  sidebar.innerHTML = renderTranslateSidebar(state);
  sidebar.scrollTop = scrollTop;
  syncEditorCommentDraftTextareaHeights(sidebar);
  restoreFocusedInputState(focusSnapshot);
}

function renderTranslateHeaderOnly() {
  const headerDetail = app.querySelector(".page-header__detail");
  if (!(headerDetail instanceof HTMLElement)) {
    renderWithOptions();
    return;
  }

  const focusSnapshot = captureFocusedInputState();
  headerDetail.innerHTML = renderTranslateHeaderDetail(state);
  restoreFocusedInputState(focusSnapshot);
}

function renderWithOptions(options = {}) {
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
  const restoredFocus = restoreFocusedInputState(focusSnapshot);
  if (focusSnapshot?.kind === "editor-row-field" && !restoredFocus && focusSnapshot.rowId) {
    scheduleDirtyEditorRowScan(render, focusSnapshot.rowId);
  }
  syncEditorRowTextareaHeights(app);
  syncEditorCommentDraftTextareaHeights(app);
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
  setEditorReplaceEnabled(enabled) {
    toggleEditorReplaceEnabled(render, enabled === true);
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
  void registerGithubAppTestListener(render);
  void loadGithubAppTestConfig(render);
  void checkForAppUpdate(render, { silent: true });
  render();
  void initializeConnectivity(render, () => restoreStoredBrokerSession(render, loadUserTeams, storedBrokerSession));
}

bootstrapPromise = bootstrap();
void bootstrapPromise;
