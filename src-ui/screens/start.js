import { primaryButton } from "../lib/ui.js";

export function renderStartScreen(state) {
  const auth = state.auth ?? {};
  const isBusy = auth.status === "launching" || auth.status === "waiting";
  const buttonLabel = isBusy ? "Waiting for GitHub..." : "Log in with GitHub";
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
            Sign in with your GitHub account to use Gnosis TMS. You will be
            directed to create a new account if you don't have one yet.
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
