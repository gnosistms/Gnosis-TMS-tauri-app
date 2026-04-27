import {
  escapeHtml,
  loadingPrimaryButton,
  primaryButton,
  secondaryButton,
} from "../lib/ui.js";

function renderVersionMessage(update) {
  const nextVersion = String(update?.version ?? "").trim();
  const currentVersion = String(update?.currentVersion ?? "").trim();

  if (nextVersion && currentVersion) {
    return `Gnosis TMS ${nextVersion} is available. You are currently running ${currentVersion}.`;
  }

  if (nextVersion) {
    return `Gnosis TMS ${nextVersion} is available.`;
  }

  return "A new version of Gnosis TMS is available.";
}

export function renderAppUpdateModal(state) {
  const update = state.appUpdate;
  if (!update?.promptVisible) {
    return "";
  }

  const error = String(update.error ?? "").trim();

  if (update.status === "installing") {
    return `
      <div class="modal-backdrop" aria-live="polite">
        <section class="card modal-card modal-card--compact">
          <div class="card__body modal-card__body">
            <p class="card__eyebrow">APP UPDATE</p>
            <h2 class="modal__title">Installing update</h2>
            <p class="modal__supporting">
              Downloading and installing the latest version now. The app will restart when it is ready.
            </p>
            <div class="modal__actions">
              ${loadingPrimaryButton({
                label: "Update now",
                loadingLabel: "Installing...",
                action: "install-app-update",
                isLoading: true,
              })}
            </div>
          </div>
        </section>
      </div>
    `;
  }

  if (update.status === "restarting") {
    return `
      <div class="modal-backdrop" aria-live="polite">
        <section class="card modal-card modal-card--compact">
          <div class="card__body modal-card__body">
            <p class="card__eyebrow">APP UPDATE</p>
            <h2 class="modal__title">Restarting to finish update</h2>
            <p class="modal__supporting">
              The update has been installed. Gnosis TMS is restarting now.
            </p>
            <div class="modal__actions">
              ${primaryButton("Restarting...", "noop", { disabled: true })}
            </div>
          </div>
        </section>
      </div>
    `;
  }

  return `
    <div class="modal-backdrop" aria-live="polite">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">APP UPDATE</p>
          <h2 class="modal__title">${update.required === true ? "Update required" : "Update available"}</h2>
          <p class="modal__supporting">
            ${escapeHtml(update.required === true ? (update.message || renderVersionMessage(update)) : renderVersionMessage(update))}
          </p>
          ${
            update.required === true
              ? `
                <p class="modal__supporting">
                  This repo was saved by a newer version of Gnosis TMS. Update before continuing.
                </p>
              `
              : `
                <p class="modal__supporting">
                  Update now to download and install it, or choose Later and keep working.
                </p>
              `
          }
          ${error ? `<p class="modal__error" role="alert">${escapeHtml(error)}</p>` : ""}
          <div class="modal__actions">
            ${update.required === true ? "" : secondaryButton("Later", "dismiss-app-update")}
            ${primaryButton("Update now", "install-app-update")}
          </div>
        </div>
      </section>
    </div>
  `;
}
