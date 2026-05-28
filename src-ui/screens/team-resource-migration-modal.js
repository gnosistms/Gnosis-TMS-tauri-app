import { escapeHtml } from "../lib/ui.js";

export function renderTeamResourceMigrationModal(state) {
  const modal = state.teamResourceMigrationModal;
  if (!modal?.isOpen) {
    return "";
  }

  const targetVersion = String(modal.targetVersion ?? "").trim() || "0.8.10";
  const message = String(modal.message ?? "").trim() || "Preparing migration...";

  return `
    <div class="modal-backdrop modal-backdrop--team-resource-migration" aria-live="polite">
      <section class="card modal-card modal-card--compact modal-card--team-resource-migration" role="status" aria-busy="true">
        <div class="card__body modal-card__body modal-card__body--navigation-loading">
          <p class="card__eyebrow">Migrating</p>
          <div class="navigation-loading-modal__spinner" aria-hidden="true"></div>
          <h2 class="modal__title navigation-loading-modal__title">Migrating data to version ${escapeHtml(targetVersion)}</h2>
          <p class="modal__supporting navigation-loading-modal__message">${escapeHtml(message)}</p>
        </div>
      </section>
    </div>
  `;
}
