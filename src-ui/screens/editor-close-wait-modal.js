import { escapeHtml, secondaryButton } from "../lib/ui.js";

function pendingChangesLabel(pendingCount) {
  if (pendingCount <= 0) {
    return "Finishing the last save...";
  }
  return pendingCount === 1
    ? "1 change left to save..."
    : `${pendingCount} changes left to save...`;
}

export function renderEditorCloseWaitModal(state) {
  const closeWait = state.editorCloseWait;
  if (!closeWait?.isOpen) {
    return "";
  }

  const pendingCount = Math.max(0, Number.parseInt(String(closeWait.pendingCount ?? 0), 10) || 0);
  const initialCount = Math.max(pendingCount, Number.parseInt(String(closeWait.initialCount ?? 0), 10) || 0);
  const completedCount = initialCount - pendingCount;
  const percent = initialCount > 0
    ? Math.max(0, Math.min(100, Math.round((completedCount / initialCount) * 100)))
    : 0;

  return `
    <div class="modal-backdrop" aria-live="polite">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">CLOSING</p>
          <h2 class="modal__title">Saving changes before closing</h2>
          <p class="modal__supporting">
            The app will close by itself when saving finishes. This can include
            syncing to GitHub, which may take a while on a slow connection.
          </p>
          <div class="editor-close-wait-modal__progress">
            <p class="editor-close-wait-modal__progress-label">${escapeHtml(pendingChangesLabel(pendingCount))}</p>
            <div
              class="editor-close-wait-modal__progress-track"
              role="progressbar"
              aria-label="Changes saved before closing"
              aria-valuemin="0"
              aria-valuemax="${escapeHtml(String(initialCount))}"
              aria-valuenow="${escapeHtml(String(completedCount))}"
            >
              <div class="editor-close-wait-modal__progress-fill" style="width: ${escapeHtml(String(percent))}%;"></div>
            </div>
          </div>
          <div class="modal__actions">
            ${secondaryButton("Close without saving", "editor-close-wait-force-close")}
            <button class="button button--primary" data-action="editor-close-wait-keep-open">Keep app open</button>
          </div>
        </div>
      </section>
    </div>
  `;
}
