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
import { app } from "./app/runtime.js";
import { state } from "./app/state.js";
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
  users: "Users - Gnosis TMS",
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

function render() {
  const focusSnapshot = captureFocusedInputState();
  const renderScreen = screenRenderers[state.screen] ?? screenRenderers.start;
  app.innerHTML = renderScreen() + renderConnectionFailureModal(state);
  restoreFocusedInputState(focusSnapshot);
  document.title = titles[state.screen] ?? "Gnosis TMS";
}
registerAppEvents(render);
void registerBrokerAuthListener(render, loadUserTeams);
void registerGithubAppInstallListener(render, setGithubAppInstallation);
void registerGithubAppTestListener(render);
void loadGithubAppTestConfig(render);
render();
void initializeConnectivity(render, () => restoreStoredBrokerSession(render, loadUserTeams));
