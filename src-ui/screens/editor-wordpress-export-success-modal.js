import { escapeHtml, primaryButton } from "../lib/ui.js";

export function renderEditorWordPressExportSuccessModal(state) {
  const modal = state.editorChapter?.wordpressExportSuccessModal;
  if (!modal?.isOpen || !modal.url) {
    return "";
  }

  const message = modal.isDraft
    ? "Your content was exported to WordPress and the post is still an unpublished draft. To preview and publish, click the link below to see the post on your WordPress site."
    : "Your content was exported to WordPress. To see it, click the link below.";

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--wordpress-export-success">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">WORDPRESS EXPORT</p>
          <h2 class="modal__title">Content successfully exported to WordPress</h2>
          <p class="modal__supporting">${escapeHtml(message)}</p>
          <p class="wordpress-export-success-modal__link">
            <a href="${escapeHtml(modal.url)}">${escapeHtml(modal.url)}</a>
          </p>
          <div class="modal__actions">
            ${primaryButton("Ok", "close-wordpress-export-success-modal")}
          </div>
        </div>
      </section>
    </div>
  `;
}
