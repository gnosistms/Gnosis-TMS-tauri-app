import { renderGlossariesScreen } from "./screens/glossaries.js";
import { renderGlossaryEditorScreen } from "./screens/glossary-editor.js";
import { renderProjectsScreen } from "./screens/projects.js";
import { renderStartScreen } from "./screens/start.js";
import { renderTeamsScreen } from "./screens/teams.js";
import { renderTranslateScreen } from "./screens/translate.js";
import { teams as seedTeams } from "./lib/data.js";

const app = document.querySelector("#app");
const tauri = window.__TAURI__ ?? {};
const invoke = tauri.core?.invoke?.bind(tauri.core);
const listen = tauri.event?.listen?.bind(tauri.event);
let pendingFocusRestore = null;
let renderQueued = false;
const GITHUB_FREE_ORG_SETUP_URL =
  "https://github.com/account/organizations/new?plan=free&ref_cta=Create%2520a%2520free%2520organization&ref_loc=cards&ref_page=%2Forganizations%2Fplan";

const state = {
  screen: "start",
  expandedProjects: new Set(["p2"]),
  selectedTeamId: "team-1",
  selectedProjectId: "p2",
  selectedGlossaryId: "g1",
  selectedChapterId: "c2",
  teams: seedTeams.map((team) => ({
    id: team.id,
    name: team.name,
    githubOrg: team.githubOrg ?? team.name.toLowerCase().replaceAll(/\s+/g, "-"),
    ownerLogin: team.ownerLogin ?? "hans",
    memberCount: team.memberCount ?? 1,
    repoCount: team.repoCount ?? 0,
    statusLabel: team.statusLabel ?? "Connected",
  })),
  auth: {
    status: "idle",
    message: "",
    session: null,
  },
  teamSetup: {
    isOpen: false,
    step: "guide",
    error: "",
    form: {
      name: "",
      slug: "",
      contactEmail: "",
    },
  },
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

  if (pendingFocusRestore) {
    const { field, selectionStart, selectionEnd } = pendingFocusRestore;
    pendingFocusRestore = null;
    const input = document.querySelector(`[data-team-field="${field}"]`);
    if (input instanceof HTMLInputElement) {
      input.focus();
      if (
        typeof selectionStart === "number" &&
        typeof selectionEnd === "number"
      ) {
        input.setSelectionRange(selectionStart, selectionEnd);
      }
    }
  }
}

function scheduleRender() {
  if (renderQueued) {
    return;
  }

  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    render();
  });
}

function resetTeamSetup() {
  state.teamSetup = {
    isOpen: false,
    step: "guide",
    error: "",
    form: {
      name: "",
      slug: "",
      contactEmail: "",
    },
  };
}

function openTeamSetup() {
  const creatorLogin = state.auth.session?.login ?? "owner";
  state.teamSetup = {
    isOpen: true,
    step: "guide",
    error: "",
    form: {
      name: "",
      slug: "",
      contactEmail: "",
    },
    ownerLogin: creatorLogin,
  };
  render();
}

function validateTeamSetupDetails() {
  const { name, slug, contactEmail } = state.teamSetup.form;
  if (!name.trim()) {
    state.teamSetup.error = "Enter a team name before continuing.";
    render();
    return false;
  }

  if (!slug.trim()) {
    state.teamSetup.error = "Enter the GitHub organization slug you want to use.";
    render();
    return false;
  }

  if (!contactEmail.trim()) {
    state.teamSetup.error = "Enter a contact email for the GitHub organization.";
    render();
    return false;
  }

  state.teamSetup.error = "";
  return true;
}

async function persistTeamSetupDraft() {
  if (!invoke) {
    throw new Error("Saving a team setup draft requires the desktop app runtime.");
  }

  const ownerLogin = state.auth.session?.login ?? "owner";
  const draft = await invoke("create_team_setup_draft", {
    input: {
      name: state.teamSetup.form.name.trim(),
      slug: state.teamSetup.form.slug.trim(),
      contactEmail: state.teamSetup.form.contactEmail.trim(),
      ownerLogin,
    },
  });

  state.teamSetup.draft = draft;
}

async function beginTeamOrgSetup() {
  state.teamSetup.step = "confirm";
  state.teamSetup.error = "";
  render();
  openExternalUrl(GITHUB_FREE_ORG_SETUP_URL);
}

async function finishTeamSetup() {
  if (!validateTeamSetupDetails()) {
    return;
  }

  try {
    await persistTeamSetupDraft();
    const { name, slug, contactEmail } = state.teamSetup.form;
    const ownerLogin = state.auth.session?.login ?? "owner";
    const nextTeam = {
      id: `team-${Date.now()}`,
      name: name.trim(),
      githubOrg: slug.trim(),
      ownerLogin,
      memberCount: 1,
      repoCount: 1,
      statusLabel: "Draft Saved",
      contactEmail: contactEmail.trim(),
    };

    state.teams = [nextTeam, ...state.teams];
    state.selectedTeamId = nextTeam.id;
    resetTeamSetup();
    render();
  } catch (error) {
    state.teamSetup.error = error?.message ?? String(error);
    render();
  }
}

function setAuthState(nextAuth) {
  state.auth = {
    ...state.auth,
    ...nextAuth,
  };
  render();
}

function applyGithubAuthResult(payload) {
  if (payload?.status === "success") {
    state.auth = {
      status: "success",
      message: payload.message ?? "Signed in with GitHub.",
      session: payload.session ?? null,
    };
    state.screen = "teams";
    render();
    return;
  }

  setAuthState({
    status: "error",
    message: payload?.message ?? "GitHub sign-in did not complete.",
    session: null,
  });
}

async function registerGithubAuthListener() {
  if (!listen) {
    return;
  }

  await listen("github-oauth-callback", (event) => {
    applyGithubAuthResult(event.payload);
  });
}

async function startGithubLogin() {
  if (!invoke) {
    setAuthState({
      status: "error",
      message: "GitHub sign-in requires the desktop app runtime.",
    });
    return;
  }

  setAuthState({
    status: "launching",
    message: "Opening GitHub in your browser...",
    session: null,
  });

  try {
    const { authUrl } = await invoke("begin_github_oauth");
    openExternalUrl(authUrl);
    setAuthState({
      status: "waiting",
      message: "Finish signing in with GitHub in your browser. We will bring you back here automatically.",
    });
  } catch (error) {
    const message = error?.message ?? String(error);
    setAuthState({
      status: "error",
      message,
      session: null,
    });
  }
}

document.addEventListener("click", (event) => {
  const navTarget = event.target.closest("[data-nav-target]")?.dataset.navTarget;
  if (navTarget) {
    if (navTarget === "start") {
      state.auth = {
        status: "idle",
        message: "",
        session: null,
      };
    }
    state.screen = navTarget;
    render();
    return;
  }

  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) {
    return;
  }

  if (action === "login-with-github") {
    void startGithubLogin();
    return;
  }

  if (action === "open-new-team") {
    openTeamSetup();
    return;
  }

  if (action === "cancel-team-setup") {
    resetTeamSetup();
    render();
    return;
  }

  if (action === "begin-team-org-setup") {
    void beginTeamOrgSetup();
    return;
  }

  if (action === "finish-team-setup") {
    void finishTeamSetup();
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

document.addEventListener("input", (event) => {
  const field = event.target.closest("[data-team-field]")?.dataset.teamField;
  if (!field || !state.teamSetup.isOpen) {
    return;
  }

  if (event.target instanceof HTMLInputElement) {
    pendingFocusRestore = {
      field,
      selectionStart: event.target.selectionStart,
      selectionEnd: event.target.selectionEnd,
    };
  }

  const value = event.target.value;
  state.teamSetup.form[field] = value;
  state.teamSetup.error = "";

  scheduleRender();
});

void registerGithubAuthListener();
render();
