import { renderRepoOldLayoutDiscardModal } from "./repo-old-layout-discard-modal.js";

export function renderQaListOldLayoutDiscardModal(state) {
  return renderRepoOldLayoutDiscardModal({
    modal: state.qaListOldLayoutDiscard,
    resourceLabel: "QA list",
    closeAction: "close-qa-list-old-layout-discard",
    confirmAction: "confirm-qa-list-old-layout-discard",
  });
}
