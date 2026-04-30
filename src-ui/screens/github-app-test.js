import { escapeHtml, pageShell, primaryButton, secondaryButton } from "../lib/ui.js";
import { getNoticeBadgeText } from "../app/status-feedback.js";

function renderStatus(state) {
  if (!state.message) {
    return "";
  }

  const tone =
    state.status === "error"
      ? "auth-status--error"
      : state.status === "launching" ||
          state.status === "waiting" ||
          state.status === "loading" ||
          state.status === "loadingRepos" ||
          state.status === "callbackReceived"
        ? "auth-status--waiting"
        : "";

  return `<p class="card__supporting auth-status ${tone}">${escapeHtml(state.message)}</p>`;
}

function renderInstallationCard(testState) {
  const installation = testState.installation;
  const installationRows = [
    {
      label: "Installation ID",
      value: testState.installationId ? String(testState.installationId) : "Waiting",
    },
    {
      label: "Account",
      value: installation?.accountLogin ? `@${installation.accountLogin}` : "Not loaded yet",
    },
    {
      label: "Account type",
      value: installation?.accountType ?? "Not loaded yet",
    },
  ];

  return `
    <article class="card">
      <div class="card__body github-app-test-card">
        <div>
          <p class="card__eyebrow">Broker Proof</p>
          <h2 class="card__title card__title--small">Installation handshake</h2>
        </div>
        <dl class="github-app-test-grid">
          ${installationRows
            .map(
              (row) => `
                <div class="github-app-test-grid__row">
                  <dt>${escapeHtml(row.label)}</dt>
                  <dd>${escapeHtml(row.value)}</dd>
                </div>
              `,
            )
            .join("")}
        </dl>
        <div class="hero-actions">
          ${secondaryButton("Refresh installation", "refresh-github-app-test-installation", {
            disabled: !testState.installationId,
          })}
          ${primaryButton("List repositories", "load-github-app-test-repositories")}
        </div>
      </div>
    </article>
  `;
}

function renderRepositoryList(repositories) {
  if (!repositories.length) {
    return `
      <article class="card">
        <div class="card__body github-app-test-card">
          <h2 class="card__title card__title--small">Accessible repositories</h2>
          <p class="card__supporting">
            Once the broker can mint an installation token, this list should populate with repositories visible to the installed GitHub App.
          </p>
        </div>
      </article>
    `;
  }

  return `
    <article class="card table-card">
      <div class="table-card__header github-app-test-table github-app-test-table--head">
        <div>Repository</div>
        <div>Visibility</div>
        <div>Open</div>
      </div>
      ${repositories
        .map(
          (repository) => `
            <div class="github-app-test-table github-app-test-table--row">
              <div>
                <strong>${escapeHtml(repository.fullName)}</strong>
                <p class="card__supporting github-app-test-table__meta">
                  ${escapeHtml(repository.description ?? "No description")}
                </p>
              </div>
              <div>${repository.private ? "Private" : "Public"}</div>
              <div>
                ${
                  repository.htmlUrl
                    ? `<a class="text-link" href="${escapeHtml(repository.htmlUrl)}" target="_blank" rel="noopener noreferrer">Open on GitHub</a>`
                    : "Unavailable"
                }
              </div>
            </div>
          `,
        )
        .join("")}
    </article>
  `;
}

function renderConfigCard(testState) {
  const config = testState.config;
  return `
    <article class="card">
      <div class="card__body github-app-test-card">
        <div>
          <p class="card__eyebrow">DigitalOcean Broker</p>
          <h2 class="card__title card__title--small">Desktop-to-broker contract</h2>
        </div>
        <p class="card__supporting">
          Configure <code>GITHUB_APP_BROKER_BASE_URL</code> in the Tauri app, then point your DigitalOcean service at the routes below.
        </p>
        <dl class="github-app-test-grid">
          <div class="github-app-test-grid__row">
            <dt>Broker base URL</dt>
            <dd>${escapeHtml(config?.brokerBaseUrl ?? "Not loaded")}</dd>
          </div>
          <div class="github-app-test-grid__row">
            <dt>Desktop callback</dt>
            <dd>${escapeHtml(config?.callbackUrl ?? "Not loaded")}</dd>
          </div>
          <div class="github-app-test-grid__row">
            <dt>Start route</dt>
            <dd>${escapeHtml(config?.startUrl ?? "Not loaded")}</dd>
          </div>
          <div class="github-app-test-grid__row">
            <dt>Inspect route</dt>
            <dd>${escapeHtml(config?.inspectInstallationTemplate ?? "Not loaded")}</dd>
          </div>
          <div class="github-app-test-grid__row">
            <dt>Repositories route</dt>
            <dd>${escapeHtml(config?.listRepositoriesTemplate ?? "Not loaded")}</dd>
          </div>
        </dl>
      </div>
    </article>
  `;
}

export function renderGithubAppTestScreen(state) {
  const testState = state.githubAppTest;
  const installDisabled = testState.configStatus !== "ready";
  const offlineMode = state.offline?.isEnabled === true;

  return pageShell({
    title: "GitHub App Auth Test",
    pageSync: state.pageSync,
    noticeText: getNoticeBadgeText(),
    offlineMode,
    offlineReconnectState: state.offline?.reconnecting === true,
    body: `
      <section class="stack">
        <article class="card card--hero github-app-test-hero">
          <div class="card__body">
            <div class="start-hero__layout start-hero__layout--with-logo">
              <div class="start-hero__text">
                <p class="card__eyebrow">Tauri + GitHub App + DigitalOcean</p>
                <h1 class="card__title">Brokered GitHub App authentication</h1>
                <p class="card__subtitle">
                  This test harness proves the desktop app can start the GitHub App installation in the browser, receive the installation callback locally, and query GitHub through your DigitalOcean service instead of embedding the app private key in Tauri.
                </p>
              </div>
              <div class="start-hero__logo" aria-hidden="true"></div>
            </div>
            <div class="hero-actions">
              ${primaryButton("Install GitHub App", installDisabled ? "noop" : "start-github-app-test-install", { disabled: offlineMode || installDisabled })}
              ${secondaryButton("Reload config", "reload-github-app-test-config", { disabled: offlineMode })}
            </div>
            ${renderStatus(testState)}
          </div>
        </article>
        ${renderConfigCard(testState)}
        ${renderInstallationCard(testState)}
        ${renderRepositoryList(testState.repositories)}
      </section>
    `,
  });
}
