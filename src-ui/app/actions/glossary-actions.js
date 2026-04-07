import {
  addGlossaryTermVariant,
  cancelGlossaryCreation,
  cancelGlossaryTermEditor,
  deleteGlossaryTerm,
  moveGlossaryTermVariant,
  openGlossaryCreation,
  openGlossaryTermEditor,
  removeGlossaryTermVariant,
  showGlossaryFeatureNotReady,
  submitGlossaryCreation,
  submitGlossaryTermEditor,
} from "../glossary-flow.js";
import { actionSuffix, runWithImmediateLoading } from "../action-helpers.js";

function parseVariantAction(action) {
  const match = /^(add|remove|move-up|move-down)-glossary-term-variant:(source|target)(?::(\d+))?$/.exec(
    action,
  );
  if (!match) {
    return null;
  }

  const [, type, side, rawIndex] = match;
  return {
    type,
    side,
    index: rawIndex === undefined ? null : Number.parseInt(rawIndex, 10),
  };
}

export function createGlossaryActions(render) {
  const exactActions = {
    "cancel-glossary-term-editor": () => cancelGlossaryTermEditor(render),
    "cancel-glossary-creation": () => cancelGlossaryCreation(render),
    "open-new-glossary": () => openGlossaryCreation(render),
    "upload-glossary": () => showGlossaryFeatureNotReady(render, "Glossary upload"),
    "open-new-term": () => openGlossaryTermEditor(render),
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
      handler: () => showGlossaryFeatureNotReady(render, "Glossary rename"),
    },
    {
      prefix: "delete-glossary:",
      handler: () => showGlossaryFeatureNotReady(render, "Glossary delete"),
    },
    {
      prefix: "download-glossary:",
      handler: () => showGlossaryFeatureNotReady(render, "Glossary download"),
    },
  ];

  return async function handleGlossaryAction(action, event) {
    const variantAction = parseVariantAction(action);
    if (variantAction) {
      if (variantAction.type === "add") {
        addGlossaryTermVariant(variantAction.side);
      } else if (variantAction.type === "remove" && Number.isInteger(variantAction.index)) {
        removeGlossaryTermVariant(variantAction.side, variantAction.index);
      } else if (variantAction.type === "move-up" && Number.isInteger(variantAction.index)) {
        moveGlossaryTermVariant(variantAction.side, variantAction.index, -1);
      } else if (variantAction.type === "move-down" && Number.isInteger(variantAction.index)) {
        moveGlossaryTermVariant(variantAction.side, variantAction.index, 1);
      }
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
