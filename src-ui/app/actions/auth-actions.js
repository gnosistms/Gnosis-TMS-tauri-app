import { restoreStoredBrokerSession, startGithubLogin } from "../auth-flow.js";
import { closeConnectionFailureModal } from "../connection-failure.js";
import { refreshCurrentScreen } from "../navigation.js";
import { enableOfflineMode, reconnectOnlineMode } from "../offline-connectivity.js";
import { loadUserTeams } from "../team-setup-flow.js";

export function createAuthActions(render) {
  return {
    "login-with-github": () => startGithubLogin(render),
    "check-for-updates": () => refreshCurrentScreen(render),
    "refresh-page": () => refreshCurrentScreen(render),
    "work-offline": () => enableOfflineMode(render),
    "dismiss-connection-failure": () => closeConnectionFailureModal(render),
    "go-offline-from-connection-failure": () => {
      closeConnectionFailureModal(render);
      enableOfflineMode(render);
    },
    "reconnect-online": () =>
      reconnectOnlineMode(render, () => restoreStoredBrokerSession(render, loadUserTeams)),
  };
}
