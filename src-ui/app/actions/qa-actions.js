import { actionSuffix, runWithImmediateLoading } from "../action-helpers.js";
import {
  cancelQaListCreation,
  cancelQaListPermanentDeletion,
  cancelQaListRename,
  cancelQaTermEditor,
  confirmQaListPermanentDeletion,
  deleteQaList,
  deleteQaTerm,
  downloadQaListAsTmx,
  importQaListFromTmx,
  makeQaListDefault,
  openQaListCreation,
  openQaListPermanentDeletion,
  openQaListRename,
  openQaTermEditor,
  restoreQaList,
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
    "cancel-qa-term-editor": () => cancelQaTermEditor(render),
    "open-new-qa-list": () => openQaListCreation(render),
    "import-qa-list": () => importQaListFromTmx(render),
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
