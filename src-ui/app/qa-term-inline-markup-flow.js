import { updateQaTermDraftField } from "./qa-term-draft.js";
import { createRepoResourceTermInlineMarkupFlow } from "./repo-resource/term-inline-markup-flow.js";

function isQaTermTextarea(element) {
  return Boolean(
    element
      && typeof element.value === "string"
      && typeof element.selectionStart === "number"
      && typeof element.selectionEnd === "number"
      && typeof element.setSelectionRange === "function"
      && element?.dataset?.qaTermTextInput !== undefined,
  );
}

const qaTermInlineMarkupFlow = createRepoResourceTermInlineMarkupFlow({
  buttonSelector: "[data-qa-term-inline-style-button]",
  isResourceTextarea: isQaTermTextarea,
  buttonAppliesToTextarea() {
    return true;
  },
  applyDraftUpdate(textarea) {
    updateQaTermDraftField("text", textarea.value);
  },
  autosizeMaxHeight: 132,
});

export const syncQaTermInlineStyleButtons = qaTermInlineMarkupFlow.syncButtons;
export const toggleQaTermInlineStyle = qaTermInlineMarkupFlow.toggle;
