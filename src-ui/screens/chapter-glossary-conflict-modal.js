import { escapeHtml, primaryButton } from "../lib/ui.js";

export function renderChapterGlossaryConflictModal(state) {
  const conflict = state.chapterGlossaryConflict;
  if (!conflict?.isOpen) {
    return "";
  }

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <h2 class="modal__title">Warning</h2>
          <p class="modal__supporting">${escapeHtml(conflict.message || "")}</p>
          <div class="modal__actions">
            ${primaryButton("Ok", "acknowledge-chapter-glossary-conflict")}
          </div>
        </div>
      </section>
    </div>
  `;
}
