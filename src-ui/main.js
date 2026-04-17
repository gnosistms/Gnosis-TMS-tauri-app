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
import { buildEditorFieldSelector } from "./app/editor-utils.js";
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

function captureFocusedInputState() {
  const activeElement = document.activeElement;
  if (
    !(activeElement instanceof HTMLInputElement)
    && !(activeElement instanceof HTMLSelectElement)
    && !(activeElement instanceof HTMLTextAreaElement)
  ) {
    return null;
  }

  const supportedSelectors = [
    "[data-team-rename-input]",
    "[data-project-rename-input]",
    "[data-project-name-input]",
    "[data-invite-user-input]",
    "[data-team-permanent-delete-input]",
    "[data-project-permanent-delete-input]",
    "[data-glossary-title-input]",
    "[data-glossary-source-language-select]",
    "[data-glossary-target-language-select]",
    "[data-glossary-rename-input]",
    "[data-glossary-permanent-delete-input]",
    "[data-glossary-term-search-input]",
    "[data-project-search-input]",
    "[data-editor-search-input]",
    "[data-editor-replace-input]",
    "[data-editor-comment-draft]",
    "[data-ai-key-input]",
    "[data-ai-settings-detailed-toggle]",
    "[data-ai-settings-provider-select]",
    "[data-ai-settings-model-select]",
  ];

  const selector =
    activeElement instanceof HTMLTextAreaElement && activeElement.matches("[data-editor-row-field]")
      ? buildEditorFieldSelector(
        activeElement.dataset.rowId ?? "",
        activeElement.dataset.languageCode ?? "",
        activeElement.dataset.contentKind === "footnote" ? "footnote" : "field",
      )
      : activeElement instanceof HTMLInputElement && activeElement.matches("[data-editor-replace-row-select]")
        ? `[data-editor-replace-row-select][data-row-id="${activeElement.dataset.rowId}"]`
        : activeElement instanceof HTMLSelectElement && activeElement.matches("[data-chapter-glossary-select]")
        ? `[data-chapter-glossary-select][data-chapter-id="${activeElement.dataset.chapterId}"]`
        : supportedSelectors.find((candidate) => activeElement.matches(candidate));
  if (!selector) {
    return null;
  }

  return {
    kind:
      activeElement instanceof HTMLTextAreaElement && activeElement.matches("[data-editor-row-field]")
        ? "editor-row-field"
        : "generic",
    selector,
    rowId:
      activeElement instanceof HTMLTextAreaElement && activeElement.matches("[data-editor-row-field]")
        ? activeElement.dataset.rowId ?? ""
        : "",
    languageCode:
      activeElement instanceof HTMLTextAreaElement && activeElement.matches("[data-editor-row-field]")
        ? activeElement.dataset.languageCode ?? ""
        : "",
    contentKind:
      activeElement instanceof HTMLTextAreaElement && activeElement.matches("[data-editor-row-field]")
        ? (activeElement.dataset.contentKind === "footnote" ? "footnote" : "field")
        : "field",
    selectionStart:
      activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement
        ? activeElement.selectionStart
        : null,
    selectionEnd:
      activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement
        ? activeElement.selectionEnd
        : null,
    selectionDirection:
      activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement
        ? activeElement.selectionDirection
        : null,
  };
}

function restoreFocusedInputState(focusSnapshot) {
  if (!focusSnapshot) {
    return false;
  }

  const nextInput = document.querySelector(focusSnapshot.selector);
  if (
    (!(nextInput instanceof HTMLInputElement)
      && !(nextInput instanceof HTMLSelectElement)
      && !(nextInput instanceof HTMLTextAreaElement))
    || nextInput.disabled
  ) {
    return false;
  }

  nextInput.focus({ preventScroll: true });

  if (
    (nextInput instanceof HTMLInputElement || nextInput instanceof HTMLTextAreaElement)
    && typeof focusSnapshot.selectionStart === "number"
    && typeof focusSnapshot.selectionEnd === "number"
  ) {
    nextInput.setSelectionRange(
      focusSnapshot.selectionStart,
      focusSnapshot.selectionEnd,
      focusSnapshot.selectionDirection ?? "none",
    );
  }

  return true;
}

function render(options = {}) {
  return renderWithOptions(options);
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
}

function renderTranslateSidebarOnly() {
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
