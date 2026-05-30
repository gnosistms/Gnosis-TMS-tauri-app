import { actionSuffix, runWithImmediateLoading } from "../action-helpers.js";
import { state } from "../state.js";
import { showNoticeBadge } from "../status-feedback.js";
import { getQaListWritePolicy } from "../resource-write-policy.js";
import {
  cancelQaListCreation,
  cancelQaListImportModal,
  cancelQaListPermanentDeletion,
  cancelQaListRename,
  cancelQaTermEditor,
  closeQaListOldLayoutDiscard,
  confirmQaListOldLayoutDiscard,
  confirmQaListPermanentDeletion,
  deleteQaList,
  deleteQaTerm,
  downloadQaListAsTmx,
  importQaListFromTmx,
  makeQaListDefault,
  openQaListCreation,
  openQaListOldLayoutDiscard,
  openQaListPermanentDeletion,
  openQaListRename,
  openQaTermEditor,
  restoreQaList,
  selectQaListImportFile,
  submitQaListCreation,
  submitQaListRename,
  submitQaTermEditor,
  toggleDeletedQaLists,
} from "../qa-list-flow.js";
import { toggleQaTermInlineStyle } from "../qa-term-inline-markup-flow.js";

export function createQaActions(render) {
  const exactActions = {
    "cancel-qa-list-permanent-deletion": () => cancelQaListPermanentDeletion(render),
    "cancel-qa-list-rename": () => cancelQaListRename(render),
    "cancel-qa-list-creation": () => cancelQaListCreation(render),
    "cancel-qa-list-import": () => cancelQaListImportModal(render),
    "cancel-qa-term-editor": () => cancelQaTermEditor(render),
    "open-new-qa-list": () => openQaListCreation(render),
    "close-qa-list-old-layout-discard": () => closeQaListOldLayoutDiscard(render),
    "confirm-qa-list-old-layout-discard": () => confirmQaListOldLayoutDiscard(render),
    "import-qa-list": () => importQaListFromTmx(render),
    "select-qa-list-import-file": () => selectQaListImportFile(render),
    "open-new-qa-term": () => openQaTermEditor(render),
    "toggle-deleted-qa-lists": () => toggleDeletedQaLists(render),
  };

  const prefixHandlers = [
    {
      prefix: "edit-qa-term:",
      handler: (termId) => openQaTermEditor(render, termId),
    },
    {
      prefix: "delete-qa-term:",
      handler: async (termId, event) =>
        runWithImmediateLoading(event, "Deleting...", () => deleteQaTerm(render, termId)),
    },
    {
      prefix: "rename-qa-list:",
      handler: (qaListId) => openQaListRename(render, qaListId),
    },
    {
      prefix: "open-qa-list-old-layout-discard:",
      handler: (qaListId) => openQaListOldLayoutDiscard(render, qaListId),
    },
    {
      prefix: "make-default-qa-list:",
      handler: (qaListId) => makeQaListDefault(render, qaListId),
    },
    {
      prefix: "delete-qa-list:",
      handler: async (qaListId, event) =>
        runWithImmediateLoading(event, "Deleting...", () => deleteQaList(render, qaListId)),
    },
    {
      prefix: "restore-qa-list:",
      handler: async (qaListId, event) =>
        runWithImmediateLoading(event, "Restoring...", () => restoreQaList(render, qaListId)),
    },
    {
      prefix: "delete-deleted-qa-list:",
      handler: (qaListId) => openQaListPermanentDeletion(render, qaListId),
    },
    {
      prefix: "download-qa-list:",
      handler: async (qaListId, event) =>
        runWithImmediateLoading(event, "Exporting...", () => downloadQaListAsTmx(render, qaListId)),
    },
  ];

  return async function handleQaAction(action, event) {
    const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId) ?? null;
    const selectedQaList =
      state.qaLists.find((qaList) => qaList.id === state.selectedQaListId)
      ?? state.qaLists[0]
      ?? null;
    const writeAction =
      action.startsWith("edit-qa-term:")
      || action.startsWith("delete-qa-term:")
      || action.startsWith("rename-qa-list:")
      || action.startsWith("make-default-qa-list:")
      || action.startsWith("delete-qa-list:")
      || action.startsWith("restore-qa-list:")
      || action.startsWith("delete-deleted-qa-list:")
      || action === "toggle-qa-term-inline-style:ruby"
      || action === "open-new-qa-list"
      || action === "import-qa-list"
      || action === "select-qa-list-import-file"
      || action === "open-new-qa-term"
      || action === "submit-qa-term-editor"
      || action === "submit-qa-list-creation"
      || action === "submit-qa-list-rename"
      || action === "confirm-qa-list-permanent-deletion";
    if (writeAction) {
      const localHardDeleteId = actionSuffix(action, "delete-deleted-qa-list:");
      const restoreId = actionSuffix(action, "restore-qa-list:");
      const targetId =
        localHardDeleteId
        || restoreId
        || actionSuffix(action, "rename-qa-list:")
        || actionSuffix(action, "make-default-qa-list:")
        || actionSuffix(action, "delete-qa-list:")
        || selectedQaList?.id
        || null;
      const targetQaList =
        state.qaLists.find((qaList) => qaList.id === targetId)
        ?? selectedQaList;
      const policy = getQaListWritePolicy({
        team: selectedTeam,
        qaList: targetQaList,
        actionKind: localHardDeleteId
          ? "localHardDelete"
          : restoreId
            ? "restoreQaList"
            : "sharedWrite",
      });
      if (!policy.allowed) {
        showNoticeBadge(policy.message, render, 2600);
        return true;
      }
    }

    if (action === "toggle-qa-term-inline-style:ruby") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-qa-term-inline-style-button]")
        : null;
      if (button instanceof HTMLElement) {
        toggleQaTermInlineStyle(button);
      }
      return true;
    }

    if (exactActions[action]) {
      await exactActions[action](event);
      return true;
    }

    if (action === "submit-qa-term-editor") {
      await runWithImmediateLoading(event, "Saving...", () => submitQaTermEditor(render));
      return true;
    }
    if (action === "submit-qa-list-creation") {
      await runWithImmediateLoading(event, "Creating...", () => submitQaListCreation(render));
      return true;
    }
    if (action === "submit-qa-list-rename") {
      await runWithImmediateLoading(event, "Saving...", () => submitQaListRename(render));
      return true;
    }
    if (action === "confirm-qa-list-permanent-deletion") {
      await runWithImmediateLoading(event, "Deleting...", () => confirmQaListPermanentDeletion(render));
      return true;
    }

    for (const { prefix, handler } of prefixHandlers) {
      const value = actionSuffix(action, prefix);
      if (value !== null) {
        await handler(value, event);
        return true;
      }
    }

    return false;
  };
}
