import { state } from "../state.js";
import {
  addGlossaryTermEmptyTargetVariant,
  addGlossaryTermVariant,
  cancelGlossaryImportModal,
  cancelGlossaryPermanentDeletion,
  cancelGlossaryRename,
  cancelGlossaryCreation,
  cancelGlossaryTermEditor,
  confirmGlossaryPermanentDeletion,
  deleteGlossary,
  deleteGlossaryTerm,
  downloadGlossaryAsTmx,
  importGlossaryFromTmx,
  moveGlossaryTermVariantToIndex,
  openGlossaryCreation,
  openGlossaryPermanentDeletion,
  openGlossaryRename,
  openGlossaryTermEditor,
  repairGlossaryRepoBinding,
  rebuildGlossaryLocalRepo,
  removeGlossaryTermVariant,
  restoreGlossary,
  submitGlossaryCreation,
  submitGlossaryRename,
  submitGlossaryTermEditor,
  selectGlossaryImportFile,
  toggleGlossaryTermInlineStyle,
  toggleDeletedGlossaries,
} from "../glossary-flow.js";
import { actionSuffix, runWithImmediateLoading } from "../action-helpers.js";

function parseVariantAction(action) {
  const moveMatch = /^move-glossary-term-variant:(source|target):(\d+):(\d+)$/.exec(action);
  if (moveMatch) {
    const [, side, rawFromIndex, rawToIndex] = moveMatch;
    return {
      type: "move",
      side,
      index: Number.parseInt(rawFromIndex, 10),
      toIndex: Number.parseInt(rawToIndex, 10),
    };
  }

  const match = /^(add|remove)-glossary-term-variant:(source|target)(?::(\d+))?$/.exec(action);
  if (!match) {
    return null;
  }

  const [, type, side, rawIndex] = match;
  return {
    type,
    side,
    index: rawIndex === undefined ? null : Number.parseInt(rawIndex, 10),
    toIndex: null,
  };
}

export function createGlossaryActions(render) {
  const exactActions = {
    "cancel-glossary-permanent-deletion": () => cancelGlossaryPermanentDeletion(render),
    "cancel-glossary-import": () => cancelGlossaryImportModal(render),
    "cancel-glossary-rename": () => cancelGlossaryRename(render),
    "cancel-glossary-term-editor": () => cancelGlossaryTermEditor(render),
    "cancel-glossary-creation": () => cancelGlossaryCreation(render),
    "open-new-glossary": () => openGlossaryCreation(render),
    "import-glossary": () => importGlossaryFromTmx(render),
    "select-glossary-import-file": () => selectGlossaryImportFile(render),
    "open-new-term": () => openGlossaryTermEditor(render),
    "toggle-deleted-glossaries": () => toggleDeletedGlossaries(render),
  };

  const prefixHandlers = [
    {
      prefix: "edit-glossary-term:",
      handler: (termId) => openGlossaryTermEditor(render, termId),
    },
    {
      prefix: "delete-glossary-term:",
      handler: async (termId, event) =>
        runWithImmediateLoading(event, "Deleting...", () => deleteGlossaryTerm(render, termId)),
    },
    {
      prefix: "rename-glossary:",
      handler: (glossaryId) => openGlossaryRename(render, glossaryId),
    },
    {
      prefix: "delete-glossary:",
      handler: async (glossaryId, event) =>
        runWithImmediateLoading(event, "Deleting...", () => deleteGlossary(render, glossaryId)),
    },
    {
      prefix: "repair-glossary:",
      handler: async (glossaryId, event) =>
        runWithImmediateLoading(event, "Repairing...", () => repairGlossaryRepoBinding(render, state.teams.find((team) => team.id === state.selectedTeamId), glossaryId)),
    },
    {
      prefix: "rebuild-glossary-repo:",
      handler: async (glossaryId, event) =>
        runWithImmediateLoading(event, "Rebuilding...", () => rebuildGlossaryLocalRepo(render, state.teams.find((team) => team.id === state.selectedTeamId), glossaryId)),
    },
    {
      prefix: "restore-glossary:",
      handler: async (glossaryId, event) =>
        runWithImmediateLoading(event, "Restoring...", () => restoreGlossary(render, glossaryId)),
    },
    {
      prefix: "delete-deleted-glossary:",
      handler: (glossaryId) => openGlossaryPermanentDeletion(render, glossaryId),
    },
    {
      prefix: "download-glossary:",
      handler: async (glossaryId, event) =>
        runWithImmediateLoading(event, "Exporting...", () => downloadGlossaryAsTmx(render, glossaryId)),
    },
  ];

  return async function handleGlossaryAction(action, event) {
    const inlineStyleMatch = /^toggle-glossary-term-inline-style:([a-z-]+):(source|target)$/.exec(action);
    if (inlineStyleMatch) {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-glossary-inline-style-button]")
        : null;
      if (button instanceof HTMLElement) {
        toggleGlossaryTermInlineStyle(button);
      }
      return true;
    }

    const variantAction = parseVariantAction(action);
    if (variantAction) {
      if (variantAction.type === "add") {
        addGlossaryTermVariant(variantAction.side);
      } else if (variantAction.type === "remove" && Number.isInteger(variantAction.index)) {
        removeGlossaryTermVariant(variantAction.side, variantAction.index);
      } else if (
        variantAction.type === "move"
        && Number.isInteger(variantAction.index)
        && Number.isInteger(variantAction.toIndex)
      ) {
        moveGlossaryTermVariantToIndex(variantAction.side, variantAction.index, variantAction.toIndex);
      }
      render();
      return true;
    }

    if (action === "add-glossary-term-empty-variant:target") {
      addGlossaryTermEmptyTargetVariant();
      render();
      return true;
    }

    if (exactActions[action]) {
      await exactActions[action](event);
      return true;
    }

    if (action === "submit-glossary-term-editor") {
      await runWithImmediateLoading(event, "Saving...", () => submitGlossaryTermEditor(render));
      return true;
    }
    if (action === "submit-glossary-creation") {
      await runWithImmediateLoading(event, "Creating...", () => submitGlossaryCreation(render));
      return true;
    }
    if (action === "submit-glossary-rename") {
      await runWithImmediateLoading(event, "Saving...", () => submitGlossaryRename(render));
      return true;
    }
    if (action === "confirm-glossary-permanent-deletion") {
      await runWithImmediateLoading(event, "Deleting...", () =>
        confirmGlossaryPermanentDeletion(render),
      );
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
