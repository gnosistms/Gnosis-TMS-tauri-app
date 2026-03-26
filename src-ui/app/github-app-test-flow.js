import { invoke, listen, openExternalUrl } from "./runtime.js";
import { state } from "./state.js";

export async function loadGithubAppTestConfig(render) {
  if (!invoke) {
    state.githubAppTest.status = "error";
    state.githubAppTest.message =
      "GitHub App broker testing requires the Tauri desktop runtime.";
    render();
    return;
  }

  state.githubAppTest.configStatus = "loading";
  render();

  try {
    const config = await invoke("get_github_app_test_config");
    state.githubAppTest.configStatus = "ready";
    state.githubAppTest.config = config;
    if (!state.githubAppTest.message) {
      state.githubAppTest.message =
        "Broker configuration loaded. Start the GitHub App installation when you're ready.";
    }
    render();
  } catch (error) {
    state.githubAppTest.configStatus = "error";
    state.githubAppTest.status = "error";
    state.githubAppTest.message = error?.message ?? String(error);
    render();
  }
}

export async function registerGithubAppTestListener(render) {
  if (!listen) {
    return;
  }

  await listen("github-app-install-callback", (event) => {
    void handleGithubAppTestInstallCallback(event.payload, render);
  });
}

export async function startGithubAppTestInstall(render) {
  if (!invoke) {
    state.githubAppTest.status = "error";
    state.githubAppTest.message =
      "GitHub App broker testing requires the Tauri desktop runtime.";
    render();
    return;
  }

  state.githubAppTest.status = "launching";
  state.githubAppTest.message =
    "Opening your DigitalOcean auth broker. It should redirect you to GitHub's app installation flow.";
  render();

  try {
    const { installUrl } = await invoke("begin_github_app_test_install");
    openExternalUrl(installUrl);
    state.githubAppTest.status = "waiting";
    state.githubAppTest.message =
      "Complete the installation in your browser. The broker should send you back to the desktop app automatically.";
    render();
  } catch (error) {
    state.githubAppTest.status = "error";
    state.githubAppTest.message = error?.message ?? String(error);
    render();
  }
}

export async function refreshGithubAppTestInstallation(render) {
  const installationId = state.githubAppTest.installationId;
  if (!installationId) {
    state.githubAppTest.status = "error";
    state.githubAppTest.message =
      "Install the GitHub App first so the test app has an installation ID to inspect.";
    render();
    return;
  }

  state.githubAppTest.status = "loading";
  state.githubAppTest.message =
    "Inspecting the installation through your DigitalOcean broker...";
  render();

  try {
    const installation = await invoke("inspect_github_app_test_installation", {
      installationId,
    });
    state.githubAppTest.status = "ready";
    state.githubAppTest.installation = installation;
    state.githubAppTest.message = `Connected to @${installation.accountLogin} through the broker.`;
    render();
  } catch (error) {
    state.githubAppTest.status = "error";
    state.githubAppTest.message = error?.message ?? String(error);
    render();
  }
}

export async function loadGithubAppTestRepositories(render) {
  const installationId = state.githubAppTest.installationId;
  if (!installationId) {
    state.githubAppTest.status = "error";
    state.githubAppTest.message =
      "Install the GitHub App first so the test app has an installation ID to query.";
    render();
    return;
  }

  state.githubAppTest.status = "loadingRepos";
  state.githubAppTest.message =
    "Listing repositories available to this installation through the broker...";
  render();

  try {
    const repositories = await invoke("list_github_app_test_repositories", {
      installationId,
    });
    state.githubAppTest.status = state.githubAppTest.installation ? "ready" : "waiting";
    state.githubAppTest.repositories = repositories;
    state.githubAppTest.message = `Loaded ${repositories.length} repository${
      repositories.length === 1 ? "" : "ies"
    } from the GitHub App installation.`;
    render();
  } catch (error) {
    state.githubAppTest.status = "error";
    state.githubAppTest.message = error?.message ?? String(error);
    render();
  }
}

async function handleGithubAppTestInstallCallback(payload, render) {
  if (!payload?.installationId) {
    state.githubAppTest.status = "error";
    state.githubAppTest.message =
      payload?.message ?? "The GitHub App installation callback did not include an installation ID.";
    render();
    return;
  }

  state.githubAppTest.installationId = payload.installationId;
  state.githubAppTest.repositories = [];
  state.githubAppTest.status = "callbackReceived";
  state.githubAppTest.message =
    payload.message ??
    `Installation ${payload.installationId} received. Inspecting it through the broker now.`;
  render();
  await refreshGithubAppTestInstallation(render);
}
