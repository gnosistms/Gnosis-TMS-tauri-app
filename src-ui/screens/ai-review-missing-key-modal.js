import { escapeHtml, primaryButton, secondaryButton } from "../lib/ui.js";

export function renderAiReviewMissingKeyModal(state) {
  const modal = state.aiReviewMissingKeyModal;
  if (!modal?.isOpen) {
    return "";
  }

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">${escapeHtml("NEEDS API KEY")}</p>
          <h2 class="modal__title">You have not saved an AI API key yet</h2>
          <p class="modal__supporting">
            In order to use this AI feature, you must enter an AI API key. Click below to do that.
          </p>
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-ai-review-missing-key")}
            ${primaryButton("Enter key", "enter-ai-key")}
          </div>
        </div>
      </section>
    </div>
  `;
}
