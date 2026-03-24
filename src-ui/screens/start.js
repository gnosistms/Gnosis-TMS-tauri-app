import { primaryButton } from "../lib/ui.js";

export function renderStartScreen() {
  return `
    <main class="screen screen--start">
      <article class="card card--hero">
        <div class="card__body">
          <p class="card__eyebrow">INVERENCIAL PEACE!</p>
          <h1 class="card__title">Gnosis TMS</h1>
          <p class="card__subtitle">
            Sign in with your GitHub account to access your teams, shared projects,
            and glossary workflows.
          </p>
          <p class="card__supporting">
            Creating a GitHub account is free. We use GitHub to manage storage for
            shared files and collaboration history.
          </p>
          <div class="hero-actions">
            ${primaryButton("Log in with GitHub", "login-with-github")}
            <a
              class="hero-link"
              href="https://github.com/signup"
              target="_blank"
              rel="noreferrer"
            >
              Create a free GitHub account
            </a>
          </div>
        </div>
      </article>
    </main>
  `;
}
