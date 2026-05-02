import { restoreStoredBrokerSession, startGithubLogin } from "../auth-flow.js";
import { closeConnectionFailureModal, reconnectFromConnectionFailure } from "../connection-failure.js";
import { refreshCurrentScreen } from "../navigation.js";
import { enableOfflineMode, reconnectOnlineMode } from "../offline-connectivity.js";
import { state } from "../state.js";
import { loadUserTeams } from "../team-setup-flow.js";
import { checkForAppUpdate } from "../updater-flow.js";

export function createAuthActions(render) {
  return {
    "login-with-github": () => startGithubLogin(render),
    "check-for-updates": () => checkForAppUpdate(render, { silent: false }),
    "refresh-page": () => refreshCurrentScreen(render),
    "work-offline": () => enableOfflineMode(render),
    "reconnect-from-connection-failure": () =>
      reconnectFromConnectionFailure(render, () => refreshCurrentScreen(render)),
    "go-offline-from-connection-failure": () => {
      if (state.connectionFailure?.reconnecting === true) {
        return;
      }
      closeConnectionFailureModal(render);
      enableOfflineMode(render);
    },
    "reconnect-online": () =>
      reconnectOnlineMode(
        render,
        (options) => restoreStoredBrokerSession(render, loadUserTeams, null, options),
      ),
  };
}
