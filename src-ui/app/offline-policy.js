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
  "confirm-team-member-owner-promotion",
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
  "review-editor-text-now",
  "run-editor-ai-assistant",
  "open-editor-ai-translate-all",
  "confirm-editor-ai-translate-all",
  "open-editor-derive-glossaries",
  "confirm-editor-derive-glossaries",
  "submit-target-language-manager",
  "open-target-language-manager-picker",
  "add-target-language-manager-language",
]);

const OFFLINE_BLOCKED_PREFIXES = [
  "open-team-users:",
  "rename-team:",
  "delete-team:",
  "restore-team:",
  "delete-deleted-team:",
  "open-team-member-removal:",
  "open-team-member-owner-promotion:",
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
  "run-editor-ai-translate:",
  "remove-target-language-manager-language:",
  "move-target-language-manager-language:",
  "select-target-language-manager-picker-language:",
];

export function editorAiActionsAreOfflineBlocked() {
  return state.offline?.isEnabled === true;
}

export function editorNetworkActionsAreOfflineBlocked() {
  return state.offline?.isEnabled === true;
}

export function isOfflineBlockedAction(action) {
  if (state.offline?.isEnabled !== true) {
    return false;
  }

  if (OFFLINE_BLOCKED_EXACT_ACTIONS.has(action)) {
    return true;
  }

  return OFFLINE_BLOCKED_PREFIXES.some((prefix) => action.startsWith(prefix));
}
