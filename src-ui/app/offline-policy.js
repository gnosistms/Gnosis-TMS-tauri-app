import { state } from "./state.js";

const OFFLINE_BLOCKED_EXACT_ACTIONS = new Set([
  "login-with-github",
  "check-for-updates",
  "open-new-team",
  "begin-team-org-setup",
  "begin-github-app-install",
  "finish-team-setup",
  "submit-team-rename",
  "confirm-team-permanent-deletion",
  "confirm-team-leave",
  "open-new-project",
  "submit-project-creation",
  "submit-project-rename",
  "confirm-project-permanent-deletion",
  "start-github-app-test-install",
  "refresh-github-app-test-installation",
  "load-github-app-test-repositories",
  "reload-github-app-test-config",
]);

const OFFLINE_BLOCKED_PREFIXES = [
  "open-team-users:",
  "rename-team:",
  "delete-team:",
  "restore-team:",
  "delete-deleted-team:",
  "rename-project:",
  "delete-project:",
  "restore-project:",
  "delete-deleted-project:",
];

export function isOfflineBlockedAction(action) {
  if (!state.offline.isEnabled) {
    return false;
  }

  if (OFFLINE_BLOCKED_EXACT_ACTIONS.has(action)) {
    return true;
  }

  return OFFLINE_BLOCKED_PREFIXES.some((prefix) => action.startsWith(prefix));
}
