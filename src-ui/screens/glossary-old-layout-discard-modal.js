import { renderRepoOldLayoutDiscardModal } from "./repo-old-layout-discard-modal.js";

export function renderGlossaryOldLayoutDiscardModal(state) {
  return renderRepoOldLayoutDiscardModal({
    modal: state.glossaryOldLayoutDiscard,
    resourceLabel: "Glossary",
    closeAction: "close-glossary-old-layout-discard",
    confirmAction: "confirm-glossary-old-layout-discard",
  });
}
