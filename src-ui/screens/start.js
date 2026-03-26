import { primaryButton } from "../lib/ui.js";

export function renderStartScreen(state) {
  const auth = state.auth ?? {};
  const isBusy = auth.status === "launching" || auth.status === "waiting";
  const buttonLabel = isBusy
    ? "Waiting for GitHub..."
    : auth.status === "expired"
      ? "Log in with GitHub again"
      : "Log in with GitHub";
  const statusMarkup = auth.message
    ? `<p class="card__supporting auth-status auth-status--${auth.status ?? "idle"}">${auth.message}</p>`
    : "";

  return `
    <main class="screen screen--start">
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
          ${statusMarkup}
        </div>
      </article>
    </main>
  `;
}
