import { escapeHtml, navButton, pageShell, primaryButton, secondaryButton, textAction } from "../lib/ui.js";

function renderOrganizationList(items) {
  if (!items.length) {
    return '<p class="debug-panel__empty">None</p>';
  }

  return `
    <ul class="debug-panel__list">
      ${items
        .map(
          (organization) => `
            <li>
              <strong>${escapeHtml(organization.name || organization.login)}</strong>
              <span>@${escapeHtml(organization.login)}</span>
              <code>${escapeHtml(organization.description || "(no description)")}</code>
            </li>
          `,
        )
        .join("")}
    </ul>
  `;
}

function renderSimpleList(items) {
  if (!items?.length) {
    return '<p class="debug-panel__empty">None</p>';
  }

  return `
    <ul class="debug-panel__list">
      ${items.map((item) => `<li><code>${escapeHtml(item)}</code></li>`).join("")}
    </ul>
  `;
}

function renderSetupModal(state) {
  const setup = state.teamSetup;
  if (!setup?.isOpen) {
    return "";
  }

  const isGuideStep = setup.step === "guide";
  const guide = `
    <div class="setup-guide">
      <ol class="setup-guide__list">
        <li>Set <strong>Organization name</strong> to the name of the translation team.</li>
        <li>Set <strong>Contact email</strong> to your email.</li>
        <li>Choose <strong>My personal account</strong>.</li>
        <li>Complete the verification.</li>
        <li>Do not choose any add-on.</li>
        <li>Accept the terms of service.</li>
      </ol>
    </div>
  `;

  const confirm = `
    <div class="setup-summary">
      <p>Finish creating the GitHub organization in your browser, then return here.</p>
      <p>When you click the button below, Gnosis TMS will check your GitHub account for new organizations and finish setting up the right one.</p>
    </div>
  `;

  const selectionItems = setup.orgsAfter
    .map(
      (organization) => `
        <label class="org-choice">
          <input
            type="checkbox"
            data-org-selection="${escapeHtml(organization.login)}"
            ${setup.selectedOrganizations.has(organization.login) ? "checked" : ""}
          />
          <span>
            <strong>${escapeHtml(organization.name || organization.login)}</strong>
            <span class="org-choice__meta">@${escapeHtml(organization.login)}</span>
          </span>
        </label>
      `,
    )
    .join("");

  const select = `
    <div class="setup-summary">
      <p>More than one new organization was found on your GitHub account.</p>
      <p>Select the organization or organizations that should be treated as Gnosis TMS translation teams, then continue.</p>
    </div>
    <div class="org-choice-list">${selectionItems}</div>
  `;

  const errorMarkup = setup.error
    ? `<p class="modal__error">${escapeHtml(setup.error)}</p>`
    : "";

  const debugPanel = state.debugOrgDiscovery
    ? `
      <section class="debug-panel">
        <h3 class="debug-panel__title">Organization Debug</h3>
        <div class="debug-panel__section">
          <p class="debug-panel__label">Before</p>
          ${renderOrganizationList(setup.orgsBefore)}
        </div>
        <div class="debug-panel__section">
          <p class="debug-panel__label">After</p>
          ${renderOrganizationList(setup.allOrgsAfter)}
        </div>
        <div class="debug-panel__section">
          <p class="debug-panel__label">Diff</p>
          ${renderOrganizationList(setup.orgsAfter)}
        </div>
        <div class="debug-panel__section">
          <p class="debug-panel__label">Granted OAuth scopes</p>
          ${renderSimpleList(setup.diagnostics?.oauthScopes)}
        </div>
        <div class="debug-panel__section">
          <p class="debug-panel__label">Accepted OAuth scopes</p>
          ${renderSimpleList(setup.diagnostics?.acceptedOauthScopes)}
        </div>
        <div class="debug-panel__section">
          <p class="debug-panel__label">Raw /user/orgs logins</p>
          ${renderSimpleList(setup.diagnostics?.userOrgLogins)}
        </div>
        <div class="debug-panel__section">
          <p class="debug-panel__label">Raw /user/memberships/orgs logins</p>
          ${renderSimpleList(setup.diagnostics?.membershipOrgLogins)}
        </div>
      </section>
    `
    : "";

  const isSelectionStep = setup.step === "select";
  const actionButton = isGuideStep
    ? primaryButton("Open GitHub Organization Setup", "begin-team-org-setup")
    : isSelectionStep
      ? primaryButton("Continue", "continue-selected-organizations")
      : primaryButton("Finish setting up your organization", "finish-team-setup");

  const body = isGuideStep ? guide : isSelectionStep ? select : confirm;
  const heading = isGuideStep
    ? "Create A New Team"
    : isSelectionStep
      ? "Select Organizations"
      : "Return To Gnosis TMS";
  const eyebrow = isGuideStep ? "STEP 1 OF 2" : "STEP 2 OF 2";
  const supporting = isGuideStep
    ? 'To create a new team, you need to set up an "Organization" on GitHub. Click below to go to the setup page. Then follow these instructions:'
    : isSelectionStep
      ? "Gnosis TMS found multiple new organizations on your GitHub account and needs your help identifying the right ones."
      : "GitHub organization creation happens in the browser. Once you have finished there, return here and continue.";

  return `
    <div class="modal-backdrop">
      <section class="card modal-card">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">${eyebrow}</p>
          <h2 class="modal__title">${heading}</h2>
          <p class="modal__supporting">${supporting}</p>
          <div class="modal__form">${body}</div>
          ${debugPanel}
          ${errorMarkup}
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-team-setup")}
            ${actionButton}
          </div>
        </div>
      </section>
    </div>
  `;
}

export function renderTeamsScreen(state) {
  const emptyState = `
    <article class="card card--hero card--empty">
      <div class="card__body">
        <p class="card__eyebrow">NO TEAMS FOUND</p>
        <h2 class="card__title card__title--small">No teams found.</h2>
        <p class="card__subtitle">Click "+ New Team" to create a team.</p>
      </div>
    </article>
  `;

  const cards = state.teams
    .map(
      (team) => `
        <article class="card card--list-row">
          <div class="card__body list-row">
            <div class="list-row__content">
              <h2 class="list-row__title">${escapeHtml(team.name)}</h2>
              <p class="list-row__meta">@${escapeHtml(team.githubOrg)} · owner @${escapeHtml(team.ownerLogin)}</p>
            </div>
            <div class="list-row__actions">
              <span class="pill">${escapeHtml(team.statusLabel)}</span>
              ${textAction("Open", `open-team:${team.id}`)}
              ${textAction("Rename", "noop")}
              ${textAction("Delete", "noop")}
            </div>
          </div>
        </article>
      `,
    )
    .join("");

  return pageShell({
    title: "Translation Teams",
    navButtons: [navButton("Logout", "start")],
    tools: [
      secondaryButton("Refresh Organizations", "refresh-organizations"),
      secondaryButton("Reconnect GitHub", "reconnect-github"),
      primaryButton("+ New Team", "open-new-team"),
    ].join(""),
    body: `<section class="stack">${cards || emptyState}</section>${renderSetupModal({
      ...state,
      debugOrgDiscovery: window.__GNOSIS_DEBUG__?.DEBUG_ORG_DISCOVERY === true,
    })}`,
  });
}
