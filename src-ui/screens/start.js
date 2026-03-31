import { primaryButton } from "../lib/ui.js";

export function renderStartScreen(state) {
  if (state.offline?.checked && state.offline.hasConnection === false) {
    const offlineAction = state.offline.hasLocalData
      ? `<div class="hero-actions">${primaryButton("Work offline", "work-offline")}</div>`
      : "";
    const offlineMessage = state.offline.hasLocalData
      ? "You are not connected to the internet. Would you like to run in offline mode?"
      : "You are not connected to the internet. Connect to the internet to continue.";

    return `
      <main class="screen screen--start">
        <div class="start-stack">
          <article class="card card--hero">
            <div class="card__body">
              <p class="card__eyebrow">GNOSIS TMS</p>
              <h1 class="card__title">No internet connection</h1>
              <p class="card__subtitle">${offlineMessage}</p>
              ${offlineAction}
            </div>
          </article>
        </div>
      </main>
    `;
  }

  const auth = state.auth ?? {};
  const isBusy = auth.status === "launching" || auth.status === "waiting";
  const buttonLabel = isBusy
    ? "Waiting for GitHub..."
    : auth.status === "expired"
      ? "Log in with GitHub again"
      : "Log in with GitHub";
  const statusMarkup = auth.message
    ? `
      <article class="card start-message-card">
        <div class="card__body">
          <p class="card__supporting auth-status auth-status--${auth.status ?? "idle"}">${auth.message}</p>
        </div>
      </article>
    `
    : "";

  return `
    <main class="screen screen--start">
      <div class="start-stack">
        ${statusMarkup}
        <article class="card card--hero">
          <div class="card__body">
            <p class="card__eyebrow">INVERENCIAL PEACE!</p>
            <h1 class="card__title">Gnosis TMS</h1>
            <p class="card__subtitle">
              Sign in with GitHub to authenticate to the Gnosis TMS broker. The
              broker will then use the installed GitHub App to manage your
              organization data safely.
            </p>
            <div class="hero-actions">
              ${primaryButton(buttonLabel, "login-with-github")}
            </div>
          </div>
        </article>
      </div>
    </main>
  `;
}
