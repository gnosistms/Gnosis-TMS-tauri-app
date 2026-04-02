import {
  registerBrokerAuthListener,
  registerGithubAppInstallListener,
  restoreStoredBrokerSession,
} from "./app/auth-flow.js";
import { registerAppEvents } from "./app/events.js";
import {
  loadGithubAppTestConfig,
  registerGithubAppTestListener,
} from "./app/github-app-test-flow.js";
import { loadUserTeams, setGithubAppInstallation } from "./app/team-setup-flow.js";
import { initializeConnectivity } from "./app/offline-connectivity.js";
import { initializePersistentStorage } from "./app/persistent-store.js";
import { app } from "./app/runtime.js";
import { hydratePersistentAppState, state } from "./app/state.js";
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

function captureFocusedInputState() {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLInputElement)) {
    return null;
  }

  const supportedSelectors = [
    "[data-team-rename-input]",
    "[data-project-rename-input]",
    "[data-project-name-input]",
    "[data-invite-user-input]",
    "[data-team-permanent-delete-input]",
    "[data-project-permanent-delete-input]",
  ];

  const selector = supportedSelectors.find((candidate) => activeElement.matches(candidate));
  if (!selector) {
    return null;
  }

  return {
    selector,
    selectionStart: activeElement.selectionStart,
    selectionEnd: activeElement.selectionEnd,
    selectionDirection: activeElement.selectionDirection,
  };
}

function restoreFocusedInputState(focusSnapshot) {
  if (!focusSnapshot) {
    return;
  }

  const nextInput = document.querySelector(focusSnapshot.selector);
  if (!(nextInput instanceof HTMLInputElement) || nextInput.disabled) {
    return;
  }

  nextInput.focus({ preventScroll: true });

  if (
    typeof focusSnapshot.selectionStart === "number"
    && typeof focusSnapshot.selectionEnd === "number"
  ) {
    nextInput.setSelectionRange(
      focusSnapshot.selectionStart,
      focusSnapshot.selectionEnd,
      focusSnapshot.selectionDirection ?? "none",
    );
  }
}

function capturePageScrollState() {
  const pageBody = app.querySelector(".page-body");
  if (!(pageBody instanceof HTMLElement)) {
    return null;
  }

  return {
    top: pageBody.scrollTop,
    left: pageBody.scrollLeft,
  };
}

function restorePageScrollState(scrollSnapshot, previousScreen, nextScreen) {
  if (!scrollSnapshot || previousScreen !== nextScreen) {
    return;
  }

  const nextPageBody = app.querySelector(".page-body");
  if (!(nextPageBody instanceof HTMLElement)) {
    return;
  }

  nextPageBody.scrollTop = scrollSnapshot.top;
  nextPageBody.scrollLeft = scrollSnapshot.left;
}

function render() {
  const previousScreen = app.firstElementChild?.getAttribute("data-screen") ?? null;
  const focusSnapshot = captureFocusedInputState();
  const scrollSnapshot = capturePageScrollState();
  const renderScreen = screenRenderers[state.screen] ?? screenRenderers.start;
  app.innerHTML = renderScreen() + renderConnectionFailureModal(state);
  if (app.firstElementChild instanceof HTMLElement) {
    app.firstElementChild.dataset.screen = state.screen;
  }
  restorePageScrollState(scrollSnapshot, previousScreen, state.screen);
  restoreFocusedInputState(focusSnapshot);
  document.title = titles[state.screen] ?? "Gnosis TMS";
}

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
