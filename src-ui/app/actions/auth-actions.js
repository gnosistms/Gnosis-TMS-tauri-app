import { startGithubLogin } from "../auth-flow.js";
import { refreshCurrentScreen } from "../navigation.js";

export function createAuthActions(render) {
  return {
    "login-with-github": () => startGithubLogin(render),
    "check-for-updates": () => refreshCurrentScreen(render),
  };
}
