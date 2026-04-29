import {
  escapeHtml,
  primaryButton,
  secondaryButton,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";

export function renderGlossaryDefaultModal(state) {
  const modal = state.glossaryDefault;
  if (!modal?.isOpen) {
    return "";
  }

  const glossaryName = String(modal.glossaryName ?? "").trim() || "this glossary";
  const isSaving = modal.status === "loading";
  const errorMarkup = modal.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(modal.error))}</p>`
    : "";

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="modal__eyebrow">MAKE DEFAULT</p>
          <h2 class="modal__title">Make ${escapeHtml(glossaryName)} the default glossary</h2>
          <p class="modal__supporting">The default glossary is assigned automatically to new files when you upload them.</p>
          ${errorMarkup}
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-glossary-default", { disabled: isSaving })}
            ${primaryButton(isSaving ? "Saving..." : "Make default", "confirm-glossary-default", { disabled: isSaving })}
          </div>
        </div>
      </section>
    </div>
  `;
}
