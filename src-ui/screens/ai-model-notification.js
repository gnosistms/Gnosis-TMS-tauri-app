import { getAiProviderActionLabel } from "../app/ai-provider-config.js";
import { escapeHtml, primaryButton, secondaryButton } from "../lib/ui.js";

export function renderAiModelNotice(notice) {
  if (!notice) return "";
  const provider = escapeHtml(getAiProviderActionLabel(notice.providerId));
  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="ai-model-notice-title" data-modal-dialog="ai-model-notification" tabindex="-1">
        <div class="card__body modal-card__body">
          <h2 class="modal__title" id="ai-model-notice-title">New AI models from ${provider}</h2>
          <p class="modal__supporting">${provider} has released the following new models:</p>
          <ul class="modal__supporting modal__supporting-list">${notice.models.map(({ label }) => `<li>${escapeHtml(label)}</li>`).join("")}</ul>
          <p class="modal__supporting">Click AI Settings to change your AI model settings.</p>
          <div class="modal__actions">
            ${secondaryButton("Ignore", "ignore-ai-model-notice", { modalCancel: true })}
            ${primaryButton("AI Settings", "open-ai-model-notice-settings", { modalDefault: true })}
          </div>
        </div>
      </section>
    </div>`;
}
