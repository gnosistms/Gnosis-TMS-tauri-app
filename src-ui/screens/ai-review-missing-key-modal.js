import { escapeHtml, primaryButton, secondaryButton } from "../lib/ui.js";
import { getAiProviderActionLabel } from "../app/ai-provider-config.js";

export function renderAiReviewMissingKeyModal(state) {
  const modal = state.aiReviewMissingKeyModal;
  if (!modal?.isOpen) {
    return "";
  }

  const providerLabel = getAiProviderActionLabel(modal.providerId);
  const isMemberMessage = modal.reason === "member_missing";
  const title = isMemberMessage
    ? `${providerLabel} is not configured for this team`
    : `You have not saved a ${providerLabel} API key yet`;
  const message = isMemberMessage
    ? `Ask the team owner to configure a shared ${providerLabel} key${modal.teamName ? ` for ${modal.teamName}` : ""} before using this AI feature.`
    : `In order to use this AI feature, you must enter a ${providerLabel} API key. Click below to do that.`;
  const primaryActionMarkup = isMemberMessage
    ? ""
    : primaryButton("Enter key", "enter-ai-key");

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">${escapeHtml("NEEDS API KEY")}</p>
          <h2 class="modal__title">${escapeHtml(title)}</h2>
          <p class="modal__supporting">
            ${escapeHtml(message)}
          </p>
          <div class="modal__actions">
            ${secondaryButton(isMemberMessage ? "OK" : "Cancel", "cancel-ai-review-missing-key")}
            ${primaryActionMarkup}
          </div>
        </div>
      </section>
    </div>
  `;
}
