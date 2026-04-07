import {
  cancelGlossaryCreation,
  cancelGlossaryTermEditor,
  deleteGlossaryTerm,
  openGlossaryCreation,
  openGlossaryTermEditor,
  showGlossaryFeatureNotReady,
  submitGlossaryCreation,
  submitGlossaryTermEditor,
} from "../glossary-flow.js";
import { actionSuffix, runWithImmediateLoading } from "../action-helpers.js";

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
