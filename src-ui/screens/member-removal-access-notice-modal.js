import { escapeHtml, primaryButton } from "../lib/ui.js";

export function renderMemberRemovalAccessNoticeModal(state) {
  const notice = state.memberRemovalAccessNotice;
  if (!notice?.isOpen) {
    return "";
  }

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">${escapeHtml("MEMBER REMOVED")}</p>
          <h2 class="modal__title">Access removal takes a little while</h2>
          <p class="modal__supporting">
            @${escapeHtml(notice.username)} has been removed from this team. It may take up
            to 30 minutes before they fully lose the ability to read team data.
          </p>
          <div class="modal__actions">
            ${primaryButton("Ok", "dismiss-member-removal-access-notice")}
          </div>
        </div>
      </section>
    </div>
  `;
}
