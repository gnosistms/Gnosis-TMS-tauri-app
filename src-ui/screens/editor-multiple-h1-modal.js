import { primaryButton, secondaryButton } from "../lib/ui.js";

export function renderEditorMultipleH1Modal(state) {
  if (!state.editorChapter?.pendingH1RowId) return "";

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact" role="dialog" aria-modal="true"
        aria-labelledby="editor-multiple-h1-title" aria-describedby="editor-multiple-h1-message"
        data-modal-dialog="editor-multiple-h1" tabindex="-1">
        <div class="card__body modal-card__body">
          <h2 class="modal__title" id="editor-multiple-h1-title">Multiple H1 headings on this page</h2>
          <p class="modal__supporting" id="editor-multiple-h1-message">The H1 heading should be used for the page title only. All other headings on a page should be H2 and H3. Do you still want to set this text style to H1?</p>
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-editor-multiple-h1", { modalCancel: true, modalInitialFocus: true })}
            ${primaryButton("Set H1", "confirm-editor-multiple-h1", { modalDefault: true })}
          </div>
        </div>
      </section>
    </div>
  `;
}
