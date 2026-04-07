import { openExternalUrl } from "./runtime.js";
import { createAuthActions } from "./actions/auth-actions.js";
import { createGithubAppTestActions } from "./actions/github-app-test-actions.js";
import { createUpdaterActions } from "./actions/updater-actions.js";
import { createNavigationActions } from "./actions/navigation-actions.js";
import { isOfflineBlockedAction } from "./offline-policy.js";
import { showOfflineUnsupportedMessage } from "./offline-ui.js";
import { createProjectActions } from "./actions/project-actions.js";
import { createGlossaryActions } from "./actions/glossary-actions.js";
import { createTeamActions } from "./actions/team-actions.js";
import { createUserActions } from "./user-actions.js";
import { actionSuffix } from "./action-helpers.js";

export function createActionDispatcher(render) {
  const exactActionMaps = [
    createAuthActions(render),
    createGithubAppTestActions(render),
    createUpdaterActions(render),
  ];

  const domainHandlers = [
    createTeamActions(render),
    createProjectActions(render),
    createGlossaryActions(render),
    createUserActions(render),
    createNavigationActions(render),
  ];

  return async function dispatchAction(action, event) {
    if (isOfflineBlockedAction(action)) {
      showOfflineUnsupportedMessage(render);
      return true;
    }

    for (const actionMap of exactActionMaps) {
      const handler = actionMap[action];
      if (handler) {
        await handler(event);
        return true;
      }
    }

    const externalUrl = actionSuffix(action, "open-external:");
    if (externalUrl !== null) {
      openExternalUrl(externalUrl);
      return true;
    }

    for (const handler of domainHandlers) {
      if (await handler(action, event)) {
        return true;
      }
    }

    return false;
  };
}
