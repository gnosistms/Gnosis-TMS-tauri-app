import { state } from "./state.js";

const OFFLINE_BLOCKED_EXACT_ACTIONS = new Set([
  "login-with-github",
  "check-for-updates",
  "refresh-page",
  "open-new-team",
  "begin-team-org-setup",
  "begin-github-app-install",
  "finish-team-setup",
  "submit-team-rename",
  "confirm-team-permanent-deletion",
  "confirm-team-leave",
  "confirm-team-member-removal",
  "open-new-project",
  "submit-project-creation",
  "submit-project-rename",
  "confirm-project-permanent-deletion",
  "open-new-glossary",
  "import-glossary",
  "submit-glossary-creation",
  "submit-glossary-rename",
  "confirm-glossary-permanent-deletion",
  "submit-glossary-term-editor",
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
  "open-team-member-removal:",
  "rename-project:",
  "delete-project:",
  "restore-project:",
  "delete-deleted-project:",
  "delete-deleted-file:",
  "rename-glossary:",
  "delete-glossary:",
  "restore-glossary:",
  "delete-deleted-glossary:",
  "delete-glossary-term:",
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
