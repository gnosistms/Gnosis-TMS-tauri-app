import { escapeHtml } from "../../lib/ui.js";

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

export function renderOrganizationDebugPanel(setup) {
  return `
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
  `;
}
