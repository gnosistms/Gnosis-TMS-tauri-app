import { renderGlossariesScreen } from "./screens/glossaries.js";
import { renderGlossaryEditorScreen } from "./screens/glossary-editor.js";
import { renderProjectsScreen } from "./screens/projects.js";
import { renderStartScreen } from "./screens/start.js";
import { renderTeamsScreen } from "./screens/teams.js";
import { renderTranslateScreen } from "./screens/translate.js";

const app = document.querySelector("#app");
const tauri = window.__TAURI__ ?? {};
const invoke = tauri.core?.invoke?.bind(tauri.core);
const listen = tauri.event?.listen?.bind(tauri.event);
const GITHUB_FREE_ORG_SETUP_URL =
  "https://github.com/account/organizations/new?plan=free&ref_cta=Create%2520a%2520free%2520organization&ref_loc=cards&ref_page=%2Forganizations%2Fplan";
const GNOSIS_TMS_ORG_DESCRIPTION = "[Gnosis TMS Translation Team]";

const state = {
  screen: "start",
  expandedProjects: new Set(["p2"]),
  selectedTeamId: null,
  selectedProjectId: "p2",
  selectedGlossaryId: "g1",
  selectedChapterId: "c2",
  teams: [],
  auth: {
    status: "idle",
    message: "",
    session: null,
  },
  orgDiscovery: {
    status: "idle",
    error: "",
  },
  teamSetup: {
    isOpen: false,
    step: "guide",
    error: "",
    orgsBefore: [],
    orgsAfter: [],
    selectedOrganizations: new Set(),
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
}

function resetTeamSetup() {
  state.teamSetup = {
    isOpen: false,
    step: "guide",
    error: "",
    orgsBefore: [],
    orgsAfter: [],
    selectedOrganizations: new Set(),
  };
}

function openTeamSetup() {
  state.teamSetup = {
    isOpen: true,
    step: "guide",
    error: "",
    orgsBefore: [],
    orgsAfter: [],
    selectedOrganizations: new Set(),
  };
  render();
}

async function beginTeamOrgSetup() {
  if (!state.auth.session?.accessToken) {
    state.teamSetup.error = "Sign in with GitHub before creating a team.";
    render();
    return;
  }

  try {
    state.teamSetup.orgsBefore = await invoke("list_user_organizations", {
      accessToken: state.auth.session.accessToken,
    });
  } catch (error) {
    state.teamSetup.error = error?.message ?? String(error);
    render();
    return;
  }

  state.teamSetup.step = "confirm";
  state.teamSetup.error = "";
  render();
  openExternalUrl(GITHUB_FREE_ORG_SETUP_URL);
}

async function finishTeamSetup() {
  if (!state.auth.session?.accessToken) {
    state.teamSetup.error = "Sign in with GitHub before finishing organization setup.";
    render();
    return;
  }

  try {
    const organizationsAfter = await invoke("list_user_organizations", {
      accessToken: state.auth.session.accessToken,
    });
    const orgsBefore = new Set(state.teamSetup.orgsBefore.map((organization) => organization.login));
    const orgsAfter = organizationsAfter.filter(
      (organization) => !orgsBefore.has(organization.login),
    );

    if (orgsAfter.length === 0) {
      state.teamSetup.error =
        "Error: no new organizations found on your GitHub account.";
      render();
      return;
    }

    if (orgsAfter.length === 1) {
      await markOrganizationsAsGnosis([orgsAfter[0].login]);
      resetTeamSetup();
      await loadUserTeams();
      return;
    }

    state.teamSetup.step = "select";
    state.teamSetup.error = "";
    state.teamSetup.orgsAfter = orgsAfter;
    state.teamSetup.selectedOrganizations = new Set();
    render();
  } catch (error) {
    state.teamSetup.error = error?.message ?? String(error);
    render();
  }
}

async function markOrganizationsAsGnosis(organizationLogins) {
  for (const organizationLogin of organizationLogins) {
    await invoke("mark_gnosis_tms_organization", {
      accessToken: state.auth.session.accessToken,
      orgLogin: organizationLogin,
      description: GNOSIS_TMS_ORG_DESCRIPTION,
    });
  }
}

async function continueSelectedOrganizations() {
  const selectedOrganizations = [...state.teamSetup.selectedOrganizations];
  if (selectedOrganizations.length === 0) {
    state.teamSetup.error = "Select at least one organization to continue.";
    render();
    return;
  }

  try {
    await markOrganizationsAsGnosis(selectedOrganizations);
    resetTeamSetup();
    await loadUserTeams();
  } catch (error) {
    state.teamSetup.error = error?.message ?? String(error);
    render();
  }
}

async function loadUserTeams() {
  if (!state.auth.session?.accessToken) {
    state.teams = [];
    state.orgDiscovery = { status: "idle", error: "" };
    render();
    return;
  }

  state.orgDiscovery = { status: "loading", error: "" };
  render();

  try {
    const organizations = await invoke("list_user_organizations", {
      accessToken: state.auth.session.accessToken,
    });
    state.teams = organizations
      .filter(
        (organization) =>
          organization.description === GNOSIS_TMS_ORG_DESCRIPTION,
      )
      .map((organization) => ({
        id: organization.login,
        name: organization.name || organization.login,
        githubOrg: organization.login,
        ownerLogin: state.auth.session.login,
        statusLabel: "Connected",
      }));
    state.selectedTeamId = state.teams[0]?.id ?? null;
    state.orgDiscovery = { status: "ready", error: "" };
    render();
  } catch (error) {
    state.teams = [];
    state.orgDiscovery = {
      status: "error",
      error: error?.message ?? String(error),
    };
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
    void loadUserTeams();
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
      state.teams = [];
      state.orgDiscovery = { status: "idle", error: "" };
      resetTeamSetup();
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

  if (action === "continue-selected-organizations") {
    void continueSelectedOrganizations();
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

document.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-org-selection]");
  if (!(checkbox instanceof HTMLInputElement)) {
    return;
  }

  const organizationLogin = checkbox.dataset.orgSelection;
  if (!organizationLogin) {
    return;
  }

  if (checkbox.checked) {
    state.teamSetup.selectedOrganizations.add(organizationLogin);
  } else {
    state.teamSetup.selectedOrganizations.delete(organizationLogin);
  }
});

void registerGithubAuthListener();
render();
