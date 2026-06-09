import { updateGlossaryTermVariant } from "./glossary-term-draft.js";
import { createRepoResourceTermInlineMarkupFlow } from "./repo-resource/term-inline-markup-flow.js";

function isGlossaryVariantTextarea(element) {
  return Boolean(
    element
      && typeof element.value === "string"
      && typeof element.selectionStart === "number"
      && typeof element.selectionEnd === "number"
      && typeof element.setSelectionRange === "function"
      && element?.dataset?.variantSide
      && element?.dataset?.variantIndex !== undefined,
  );
}

const glossaryTermInlineMarkupFlow = createRepoResourceTermInlineMarkupFlow({
  buttonSelector: "[data-glossary-inline-style-button]",
  isResourceTextarea: isGlossaryVariantTextarea,
  buttonAppliesToTextarea(button, textarea) {
    return button?.dataset?.variantSide === textarea?.dataset?.variantSide;
  },
  applyDraftUpdate(textarea, operations) {
    const side = textarea.dataset.variantSide ?? "";
    const index = Number.parseInt(textarea.dataset.variantIndex ?? "", 10);
    if ((side === "source" || side === "target") && Number.isInteger(index) && index >= 0) {
      (operations.updateGlossaryTermVariant ?? updateGlossaryTermVariant)(side, index, textarea.value);
    }
  },
  autosizeMaxHeight: 96,
});

export const syncGlossaryTermInlineStyleButtons = glossaryTermInlineMarkupFlow.syncButtons;
export const toggleGlossaryTermInlineStyle = glossaryTermInlineMarkupFlow.toggle;
