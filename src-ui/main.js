import {
  prepareStoredBrokerSessionRestore,
  registerBrokerAuthListener,
  registerGithubAppInstallListener,
  restoreStoredBrokerSession,
} from "./app/auth-flow.js";
import { registerAppEvents } from "./app/events.js";
import { initializeEditorVirtualization } from "./app/editor-virtualization.js";
import {
  loadGithubAppTestConfig,
  registerGithubAppTestListener,
} from "./app/github-app-test-flow.js";
import { loadUserTeams, setGithubAppInstallation } from "./app/team-setup-flow.js";
import { initializeConnectivity } from "./app/offline-connectivity.js";
import { initializePersistentStorage } from "./app/persistent-store.js";
import { app, initializeWindowPresentation } from "./app/runtime.js";
import {
  syncEditorCommentDraftTextareaHeights,
  syncEditorRowTextareaHeight,
  syncEditorRowTextareaHeights,
  syncGlossaryVariantTextareaHeights,
} from "./app/autosize.js";
import {
  applyEditorRegressionFixture,
  applyEditorRegressionRestore,
  applyEditorRegressionSoftDelete,
  readEditorRegressionSnapshot,
} from "./app/editor-regression-fixture.js";
import {
  persistCurrentEditorLocation,
  prepareEditorLocationBeforeRender,
  queuePendingEditorLocationRestore,
  restorePendingEditorLocation,
  scheduleEditorLocationSave,
} from "./app/editor-location.js";
import { captureRenderScrollSnapshot, restoreRenderScrollSnapshot } from "./app/scroll-state.js";
import { hydratePersistentAppState, state } from "./app/state.js";
import { noteGlossaryBackgroundSyncScrollActivity } from "./app/glossary-background-sync.js";
import {
  flushDirtyEditorRows,
  noteEditorBackgroundSyncScrollActivity,
  scheduleDirtyEditorRowScan,
  setActiveEditorField,
  toggleEditorReplaceEnabled,
} from "./app/translate-flow.js";
import { checkForAppUpdate } from "./app/updater-flow.js";
import { renderGithubAppTestScreen } from "./screens/github-app-test.js";
import { renderConnectionFailureModal } from "./screens/connection-failure-modal.js";
import { renderGlossariesScreen } from "./screens/glossaries.js";
import { renderGlossaryEditorScreen } from "./screens/glossary-editor.js";
import { renderNavigationLoadingModal } from "./screens/navigation-loading-modal.js";
import { renderProjectsScreen } from "./screens/projects.js";
import { renderAiKeyScreen } from "./screens/ai-key.js";
import { renderStartScreen } from "./screens/start.js";
import { renderTeamsScreen } from "./screens/teams/index.js";
import { renderTranslateEditorBody, renderTranslateScreen, renderTranslateSidebar } from "./screens/translate.js";
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
  aiKey: "AI Key - Gnosis TMS",
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
  ];

  const selector =
    activeElement instanceof HTMLTextAreaElement && activeElement.matches("[data-editor-row-field]")
      ? `[data-editor-row-field][data-row-id="${activeElement.dataset.rowId}"][data-language-code="${activeElement.dataset.languageCode}"]`
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

function renderTranslateBodyOnly() {
  const body = app.querySelector(".page-body.page-body--editor");
  if (!(body instanceof HTMLElement)) {
    renderWithOptions();
    return;
  }

  const focusSnapshot = captureFocusedInputState();
  const scrollSnapshot = captureRenderScrollSnapshot("translate");
  body.innerHTML = renderTranslateEditorBody(state);
  restoreRenderScrollSnapshot("translate", "translate", scrollSnapshot);
  queuePendingEditorLocationRestore(state);
  initializeEditorVirtualization(app, state);
  restorePendingEditorLocation(state);
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

function renderWithOptions(options = {}) {
  if (options?.scope === "translate-body" && state.screen === "translate") {
    renderTranslateBodyOnly();
    return;
  }

  if (options?.scope === "translate-sidebar" && state.screen === "translate") {
    renderTranslateSidebarOnly();
    return;
  }

  const previousScreen = app.firstElementChild?.getAttribute("data-screen") ?? null;
  prepareEditorLocationBeforeRender(previousScreen, state);
  const focusSnapshot = captureFocusedInputState();
  const scrollSnapshot = captureRenderScrollSnapshot(previousScreen);
  const renderScreen = screenRenderers[state.screen] ?? screenRenderers.start;
  app.innerHTML = renderScreen() + renderNavigationLoadingModal(state) + renderConnectionFailureModal(state);
  syncGlossaryVariantTextareaHeights(app);
  if (app.firstElementChild instanceof HTMLElement) {
    app.firstElementChild.dataset.screen = state.screen;
  }
  restoreRenderScrollSnapshot(previousScreen, state.screen, scrollSnapshot);
  queuePendingEditorLocationRestore(state);
  initializeEditorVirtualization(app, state);
  restorePendingEditorLocation(state);
  const restoredFocus = restoreFocusedInputState(focusSnapshot);
  if (focusSnapshot?.kind === "editor-row-field" && !restoredFocus && focusSnapshot.rowId) {
    scheduleDirtyEditorRowScan(render, focusSnapshot.rowId);
  }
  syncEditorRowTextareaHeights(app);
  syncEditorCommentDraftTextareaHeights(app);
  document.title = titles[state.screen] ?? "Gnosis TMS";
}

app.addEventListener("focusin", (event) => {
  const input = event.target.closest?.("[data-editor-row-field]");
  if (!(input instanceof HTMLTextAreaElement)) {
    return;
  }

  const rowId = input.dataset.rowId ?? "";
  const languageCode = input.dataset.languageCode ?? "";
  void setActiveEditorField(render, rowId, languageCode, { input });
  syncEditorRowTextareaHeight(input);
  requestAnimationFrame(() => {
    const activeElement = document.activeElement;
    if (
      !(activeElement instanceof HTMLTextAreaElement)
      || !activeElement.matches("[data-editor-row-field]")
      || activeElement.dataset.rowId !== rowId
      || activeElement.dataset.languageCode !== languageCode
    ) {
      return;
    }

    void flushDirtyEditorRows(render, { excludeRowId: rowId });
  });
});

app.addEventListener("focusout", (event) => {
  const input = event.target.closest?.("[data-editor-row-field]");
  if (!(input instanceof HTMLTextAreaElement)) {
    return;
  }

  requestAnimationFrame(() => syncEditorRowTextareaHeight(input));
  scheduleDirtyEditorRowScan(render, input.dataset.rowId);
});

app.addEventListener("beforeinput", (event) => {
  const input = event.target.closest?.("[data-editor-row-field]");
  if (!(input instanceof HTMLTextAreaElement)) {
    return;
  }

  const row = state.editorChapter?.rows?.find?.((candidate) => candidate?.rowId === input.dataset.rowId) ?? null;
  if (!row || (row.freshness !== "stale" && row.remotelyDeleted !== true)) {
    return;
  }

  event.preventDefault();
  void setActiveEditorField(render, input.dataset.rowId ?? "", input.dataset.languageCode ?? "", {
    input,
    suppressNotice: true,
  });
}, true);

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
};

async function bootstrap() {
  await initializePersistentStorage();
  hydratePersistentAppState();
  await initializeWindowPresentation();
  const storedBrokerSession = await prepareStoredBrokerSessionRestore();

  registerAppEvents(render);
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
