import { secondaryButton } from "../lib/ui.js";

export function renderTargetLanguageManagerModal(state) {
  const modal = state.targetLanguageManager;
  if (!modal?.isOpen) {
    return "";
  }

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">TARGET LANGUAGES</p>
          <h2 class="modal__title">Add Or Remove Languages</h2>
          <p class="modal__supporting">
            This placeholder modal will later let you add a new target language or remove an existing one from the editor.
          </p>
          <div class="modal__actions">
            ${secondaryButton("Close", "close-target-language-manager")}
          </div>
        </div>
      </section>
    </div>
  `;
}
