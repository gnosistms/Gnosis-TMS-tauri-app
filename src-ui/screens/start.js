import { primaryButton } from "../lib/ui.js";

export function renderStartScreen() {
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
            ${primaryButton("Log in with GitHub", "login-with-github")}
          </div>
        </div>
      </article>
    </main>
  `;
}
