import {
  loadGithubAppTestConfig,
  loadGithubAppTestRepositories,
  refreshGithubAppTestInstallation,
  startGithubAppTestInstall,
} from "../github-app-test-flow.js";

export function createGithubAppTestActions(render) {
  return {
    "reload-github-app-test-config": () => loadGithubAppTestConfig(render),
    "start-github-app-test-install": () => startGithubAppTestInstall(render),
    "refresh-github-app-test-installation": () =>
      refreshGithubAppTestInstallation(render),
    "load-github-app-test-repositories": () =>
      loadGithubAppTestRepositories(render),
  };
}
