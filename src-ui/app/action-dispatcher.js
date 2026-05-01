import { openExternalUrl } from "./runtime.js";
import { createAuthActions } from "./actions/auth-actions.js";
import { createUpdaterActions } from "./actions/updater-actions.js";
import { createAiActions } from "./actions/ai-actions.js";
import { createNavigationActions } from "./actions/navigation-actions.js";
import { isOfflineBlockedAction } from "./offline-policy.js";
import { showOfflineUnsupportedMessage } from "./offline-ui.js";
import { createProjectActions } from "./actions/project-actions.js";
import { createGlossaryActions } from "./actions/glossary-actions.js";
import { createTeamActions } from "./actions/team-actions.js";
import { createTranslateActions } from "./actions/translate-actions.js";
import { createUserActions } from "./user-actions.js";
import { actionSuffix } from "./action-helpers.js";
import { state } from "./state.js";

function updateRequiredAllowsAction(action) {
  return (
    action === "install-app-update"
    || action === "check-for-updates"
    || action === "dismiss-app-update"
    || action === "noop"
  );
}

export function createActionDispatcher(render) {
  const exactActionMaps = [
    createAuthActions(render),
    createUpdaterActions(render),
    createAiActions(render),
  ];

  const domainHandlers = [
    createTeamActions(render),
    createProjectActions(render),
    createGlossaryActions(render),
    createUserActions(render),
    createTranslateActions(render),
    createNavigationActions(render),
  ];

  return async function dispatchAction(action, event) {
    if (state.appUpdate.required === true && !updateRequiredAllowsAction(action)) {
      return true;
    }

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
