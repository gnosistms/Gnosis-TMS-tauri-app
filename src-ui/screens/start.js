import { primaryButton } from "../lib/ui.js";

function renderStartHeroLogo() {
  return '<div class="start-hero__logo" aria-hidden="true"></div>';
}

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
              <div class="start-hero__layout start-hero__layout--with-logo">
                <div class="start-hero__text">
                  <p class="card__eyebrow">GNOSIS TMS</p>
                  <h1 class="card__title">No internet connection</h1>
                  <p class="card__subtitle">${offlineMessage}</p>
                </div>
                ${renderStartHeroLogo()}
              </div>
              ${offlineAction}
            </div>
          </article>
        </div>
      </main>
    `;
  }

  const auth = state.auth ?? {};
  const isResolvingStartupAuth = auth.status === "booting" || auth.status === "restoring";
  const isBusy = auth.status === "launching" || auth.status === "waiting";
  const buttonLabel = isBusy
    ? "Waiting for GitHub..."
    : "Log in with GitHub";
  const heroTitle = "Gnosis TMS";
  const heroSubtitle = isResolvingStartupAuth
    ? "Please wait while we log you in."
    : `Sign in with your GitHub account. If you don't have one yet, you
              will be invited to create one before signing in.`;
  const statusMarkup = auth.message
    && !isResolvingStartupAuth
    ? `
      <article class="card start-message-card start-message-card--${auth.status ?? "idle"}">
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
            <div class="start-hero__layout start-hero__layout--with-logo">
              <div class="start-hero__text">
                <p class="card__eyebrow">PAZ INVERENCIAL!</p>
                <h1 class="card__title">${heroTitle}</h1>
                <p class="card__subtitle">${heroSubtitle}</p>
              </div>
              ${renderStartHeroLogo()}
            </div>
            ${
              isResolvingStartupAuth
                ? ""
                : `
            <div class="hero-actions">
              ${primaryButton(buttonLabel, "login-with-github")}
            </div>
            `
            }
          </div>
        </article>
      </div>
    </main>
  `;
}
