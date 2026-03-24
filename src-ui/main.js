import { renderGlossariesScreen } from "./screens/glossaries.js";
import { renderGlossaryEditorScreen } from "./screens/glossary-editor.js";
import { renderProjectsScreen } from "./screens/projects.js";
import { renderStartScreen } from "./screens/start.js";
import { renderTeamsScreen } from "./screens/teams.js";
import { renderTranslateScreen } from "./screens/translate.js";

const app = document.querySelector("#app");

const state = {
  screen: "start",
  expandedProjects: new Set(["p2"]),
  selectedTeamId: "team-1",
  selectedProjectId: "p2",
  selectedGlossaryId: "g1",
  selectedChapterId: "c2",
};

const screenRenderers = {
  start: () => renderStartScreen(state),
  teams: () => renderTeamsScreen(state),
  projects: () => renderProjectsScreen(state),
  glossaries: () => renderGlossariesScreen(state),
  glossaryEditor: () => renderGlossaryEditorScreen(state),
  translate: () => renderTranslateScreen(state),
};

const titles = {
  start: "Gnosis TMS",
  teams: "Translation Teams - Gnosis TMS",
  projects: "Projects - Gnosis TMS",
  glossaries: "Glossaries - Gnosis TMS",
  glossaryEditor: "Glossary Editor - Gnosis TMS",
  translate: "Translate - Gnosis TMS",
};

function openExternalUrl(url) {
  const opener = window.__TAURI__?.opener;
  if (opener?.openUrl) {
    opener.openUrl(url);
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

function render() {
  const renderScreen = screenRenderers[state.screen] ?? screenRenderers.start;
  app.innerHTML = renderScreen();
  document.title = titles[state.screen] ?? "Gnosis TMS";
}

document.addEventListener("click", (event) => {
  const navTarget = event.target.closest("[data-nav-target]")?.dataset.navTarget;
  if (navTarget) {
    state.screen = navTarget;
    render();
    return;
  }

  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) {
    return;
  }

  if (action === "login-with-github") {
    state.screen = "teams";
    render();
    return;
  }

  if (action === "open-github-signup") {
    openExternalUrl("https://github.com/signup");
    return;
  }

  if (action.startsWith("open-team:")) {
    state.selectedTeamId = action.split(":")[1];
    state.screen = "projects";
    render();
    return;
  }

  if (action.startsWith("toggle-project:")) {
    const projectId = action.split(":")[1];
    if (state.expandedProjects.has(projectId)) {
      state.expandedProjects.delete(projectId);
    } else {
      state.expandedProjects.add(projectId);
    }
    render();
    return;
  }

  if (action.startsWith("open-glossary:")) {
    state.selectedGlossaryId = action.split(":")[1];
    state.screen = "glossaryEditor";
    render();
    return;
  }

  if (action === "open-glossaries") {
    state.screen = "glossaries";
    render();
    return;
  }

  if (action.startsWith("open-translate:")) {
    state.selectedChapterId = action.split(":")[1];
    state.screen = "translate";
    render();
  }
});

render();
