import {
  registerGithubAppInstallListener,
  registerGithubAuthListener,
  restoreStoredGithubSession,
} from "./app/auth-flow.js";
import { registerAppEvents } from "./app/events.js";
import { loadUserTeams, setGithubAppInstallation } from "./app/team-setup-flow.js";
import { app } from "./app/runtime.js";
import { state } from "./app/state.js";
import { renderGlossariesScreen } from "./screens/glossaries.js";
import { renderGlossaryEditorScreen } from "./screens/glossary-editor.js";
import { renderProjectsScreen } from "./screens/projects.js";
import { renderStartScreen } from "./screens/start.js";
import { renderTeamsScreen } from "./screens/teams/index.js";
import { renderTranslateScreen } from "./screens/translate.js";
import { renderUsersScreen } from "./screens/users.js";

const screenRenderers = {
  start: () => renderStartScreen(state),
  teams: () => renderTeamsScreen(state),
  projects: () => renderProjectsScreen(state),
  users: () => renderUsersScreen(state),
  glossaries: () => renderGlossariesScreen(state),
  glossaryEditor: () => renderGlossaryEditorScreen(state),
  translate: () => renderTranslateScreen(state),
};

const titles = {
  start: "Gnosis TMS",
  teams: "Translation Teams - Gnosis TMS",
  projects: "Projects - Gnosis TMS",
  users: "Users - Gnosis TMS",
  glossaries: "Glossaries - Gnosis TMS",
  glossaryEditor: "Glossary Editor - Gnosis TMS",
  translate: "Translate - Gnosis TMS",
};

function render() {
  const renderScreen = screenRenderers[state.screen] ?? screenRenderers.start;
  app.innerHTML = renderScreen();
  document.title = titles[state.screen] ?? "Gnosis TMS";
}
registerAppEvents(render);
void registerGithubAuthListener(render, loadUserTeams);
void registerGithubAppInstallListener(render, setGithubAppInstallation);
restoreStoredGithubSession(render, loadUserTeams);
render();
