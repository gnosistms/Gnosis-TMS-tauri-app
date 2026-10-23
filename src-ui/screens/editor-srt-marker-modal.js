import { escapeHtml, primaryButton } from "../lib/ui.js";

export function renderEditorSrtMarkerModal(state) {
  const modal = state.editorChapter?.srtMarkerModal;
  if (!modal) return "";
  const message = modal.valid
    ? "There were errors in your use of ⟦n⟧ markers to separate the text. We have fixed them automatically. Please check your text to make sure we fixed them correctly."
    : `There were errors in your use of ⟦n⟧ markers to separate the text. Please check the text and ensure that you have exactly ${modal.count} separators from 1 to ${modal.count} and that they appear in order from 1 to ${modal.count}.`;
  return `<div class="modal-backdrop">
    <section class="card modal-card modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="editor-srt-marker-modal-title" data-modal-dialog="editor-srt-marker" tabindex="-1">
      <div class="card__body modal-card__body">
        <h2 class="modal__title" id="editor-srt-marker-modal-title">Check sentence separators</h2>
        <p class="modal__supporting">${escapeHtml(message)}</p>
        <div class="modal__actions">${primaryButton("Ok", "dismiss-editor-srt-marker-modal", { modalDefault: true, modalCancel: true, modalInitialFocus: true })}</div>
      </div>
    </section>
  </div>`;
}
