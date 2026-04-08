import {
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
import { syncEditorRowTextareaHeight, syncEditorRowTextareaHeights, syncGlossaryVariantTextareaHeights } from "./app/autosize.js";
import {
  captureRenderScrollSnapshot,
  captureVisibleTranslateLocation,
  queueTranslateRowAnchor,
  restoreRenderScrollSnapshot,
  restoreTranslateRowAnchor,
} from "./app/scroll-state.js";
import {
  clearStoredEditorLocation,
  loadStoredEditorLocation,
  saveStoredEditorLocation,
} from "./app/editor-preferences.js";
import { hydratePersistentAppState, state } from "./app/state.js";
import { setActiveEditorField } from "./app/translate-flow.js";
import { checkForAppUpdate } from "./app/updater-flow.js";
import { renderGithubAppTestScreen } from "./screens/github-app-test.js";
import { renderConnectionFailureModal } from "./screens/connection-failure-modal.js";
import { renderGlossariesScreen } from "./screens/glossaries.js";
import { renderGlossaryEditorScreen } from "./screens/glossary-editor.js";
import { renderProjectsScreen } from "./screens/projects.js";
import { renderStartScreen } from "./screens/start.js";
import { renderTeamsScreen } from "./screens/teams/index.js";
import { renderTranslateScreen } from "./screens/translate.js";
import { renderUsersScreen } from "./screens/users.js";

const screenRenderers = {
  githubAppTest: () => renderGithubAppTestScreen(state),
  start: () => renderStartScreen(state),
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
  teams: "Translation Teams - Gnosis TMS",
  projects: "Projects - Gnosis TMS",
  users: "Members - Gnosis TMS",
  glossaries: "Glossaries - Gnosis TMS",
  glossaryEditor: "Glossary Editor - Gnosis TMS",
  translate: "Translate - Gnosis TMS",
};

let editorLocationRestoreChapterId = null;
let pendingEditorLocationRestore = null;
let editorLocationSaveTimer = null;

function loadedEditorChapterId() {
  if (
    state.editorChapter?.status !== "ready"
    || typeof state.editorChapter?.chapterId !== "string"
    || !state.editorChapter.chapterId
    || !Array.isArray(state.editorChapter.rows)
    || state.editorChapter.rows.length === 0
  ) {
    return null;
  }

  return state.editorChapter.chapterId;
}

function currentEditorLocationChapterId() {
  if (state.screen !== "translate") {
    return null;
  }

  return loadedEditorChapterId();
}

function canRestoreEditorLocation() {
  return state.screen === "translate" && state.editorChapter?.status === "ready";
}

function persistEditorLocationForChapter(chapterId, { requireRestored = true } = {}) {
  if (!chapterId) {
    return;
  }

  if (requireRestored && editorLocationRestoreChapterId !== chapterId) {
    return;
  }

  const location = captureVisibleTranslateLocation();
  if (!location?.rowId) {
    return;
  }

  saveStoredEditorLocation(chapterId, location);
}

function persistCurrentEditorLocation() {
  persistEditorLocationForChapter(currentEditorLocationChapterId());
}

function persistLoadedEditorLocation() {
  persistEditorLocationForChapter(loadedEditorChapterId());
}

function scheduleEditorLocationSave() {
  const scheduledChapterId = currentEditorLocationChapterId();
  if (!scheduledChapterId || editorLocationRestoreChapterId !== scheduledChapterId) {
    return;
  }

  if (editorLocationSaveTimer !== null) {
    window.clearTimeout(editorLocationSaveTimer);
  }

  editorLocationSaveTimer = window.setTimeout(() => {
    editorLocationSaveTimer = null;
    if (currentEditorLocationChapterId() !== scheduledChapterId) {
      return;
    }

    persistCurrentEditorLocation();
  }, 180);
}

function updatePendingEditorLocationRestore() {
  if (!canRestoreEditorLocation()) {
    pendingEditorLocationRestore = null;
    if (state.screen !== "translate") {
      editorLocationRestoreChapterId = null;
    }
    return;
  }

  const chapterId = currentEditorLocationChapterId();
  if (!chapterId) {
    pendingEditorLocationRestore = null;
    if (state.screen !== "translate") {
      editorLocationRestoreChapterId = null;
    }
    return;
  }

  if (editorLocationRestoreChapterId === chapterId) {
    pendingEditorLocationRestore = null;
    return;
  }

  const savedLocation = loadStoredEditorLocation(chapterId);
  if (!savedLocation?.rowId) {
    editorLocationRestoreChapterId = chapterId;
    pendingEditorLocationRestore = null;
    return;
  }

  pendingEditorLocationRestore = {
    chapterId,
    ...savedLocation,
  };
}

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
    "[data-glossary-term-search-input]",
  ];

  const selector =
    activeElement instanceof HTMLTextAreaElement && activeElement.matches("[data-editor-row-field]")
      ? `[data-editor-row-field][data-row-id="${activeElement.dataset.rowId}"][data-language-code="${activeElement.dataset.languageCode}"]`
      : activeElement instanceof HTMLSelectElement && activeElement.matches("[data-chapter-glossary-select]")
        ? `[data-chapter-glossary-select][data-chapter-id="${activeElement.dataset.chapterId}"][data-glossary-slot="${activeElement.dataset.glossarySlot}"]`
      : supportedSelectors.find((candidate) => activeElement.matches(candidate));
  if (!selector) {
    return null;
  }

  return {
    selector,
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
    return;
  }

  const nextInput = document.querySelector(focusSnapshot.selector);
  if (
    (!(nextInput instanceof HTMLInputElement)
      && !(nextInput instanceof HTMLSelectElement)
      && !(nextInput instanceof HTMLTextAreaElement))
    || nextInput.disabled
  ) {
    return;
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
}

function render() {
  if (editorLocationSaveTimer !== null) {
    window.clearTimeout(editorLocationSaveTimer);
    editorLocationSaveTimer = null;
  }

  const previousScreen = app.firstElementChild?.getAttribute("data-screen") ?? null;
  if (previousScreen === "translate") {
    persistLoadedEditorLocation();
  }
  const focusSnapshot = captureFocusedInputState();
  const scrollSnapshot = captureRenderScrollSnapshot(previousScreen);
  const renderScreen = screenRenderers[state.screen] ?? screenRenderers.start;
  app.innerHTML = renderScreen() + renderConnectionFailureModal(state);
  syncGlossaryVariantTextareaHeights(app);
  if (app.firstElementChild instanceof HTMLElement) {
    app.firstElementChild.dataset.screen = state.screen;
  }
  restoreRenderScrollSnapshot(previousScreen, state.screen, scrollSnapshot);
  updatePendingEditorLocationRestore();
  if (pendingEditorLocationRestore?.chapterId === currentEditorLocationChapterId()) {
    queueTranslateRowAnchor(pendingEditorLocationRestore);
  }
  initializeEditorVirtualization(app, state);
  if (pendingEditorLocationRestore?.chapterId === currentEditorLocationChapterId()) {
    const restored = restoreTranslateRowAnchor(pendingEditorLocationRestore);
    if (!restored) {
      clearStoredEditorLocation(pendingEditorLocationRestore.chapterId);
    }
    editorLocationRestoreChapterId = pendingEditorLocationRestore.chapterId;
    pendingEditorLocationRestore = null;
  }
  restoreFocusedInputState(focusSnapshot);
  syncEditorRowTextareaHeights(app);
  document.title = titles[state.screen] ?? "Gnosis TMS";
}

app.addEventListener("focusin", (event) => {
  const input = event.target.closest?.("[data-editor-row-field]");
  if (!(input instanceof HTMLTextAreaElement)) {
    return;
  }

  setActiveEditorField(render, input.dataset.rowId, input.dataset.languageCode);
  syncEditorRowTextareaHeight(input);
});

app.addEventListener("focusout", (event) => {
  const input = event.target.closest?.("[data-editor-row-field]");
  if (!(input instanceof HTMLTextAreaElement)) {
    return;
  }

  requestAnimationFrame(() => syncEditorRowTextareaHeight(input));
});

app.addEventListener("scroll", (event) => {
  const container = event.target instanceof Element ? event.target.closest(".translate-main-scroll") : null;
  if (!(container instanceof HTMLElement)) {
    return;
  }

  scheduleEditorLocationSave();
}, true);

window.addEventListener("beforeunload", () => {
  persistCurrentEditorLocation();
});

window.__gnosisDebug = {
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
};

async function bootstrap() {
  await initializePersistentStorage();
  hydratePersistentAppState();
  await initializeWindowPresentation();

  registerAppEvents(render);
  void registerBrokerAuthListener(render, loadUserTeams);
  void registerGithubAppInstallListener(render, setGithubAppInstallation);
  void registerGithubAppTestListener(render);
  void loadGithubAppTestConfig(render);
  void checkForAppUpdate(render, { silent: true });
  render();
  void initializeConnectivity(render, () => restoreStoredBrokerSession(render, loadUserTeams));
}

void bootstrap();
