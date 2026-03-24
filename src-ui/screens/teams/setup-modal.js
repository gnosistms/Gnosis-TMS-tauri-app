import { escapeHtml, primaryButton, secondaryButton } from "../../lib/ui.js";
import { renderOrganizationDebugPanel } from "./debug-panel.js";

function renderGuideStep() {
  return `
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
}

function renderInstallSummary() {
  return `
    <div class="setup-summary">
      <p>Finish creating the GitHub organization in your browser, then return here.</p>
      <p>The next step installs the Gnosis TMS GitHub App on that organization so the app can manage it directly.</p>
    </div>
  `;
}

function renderWaitingSummary() {
  return `
    <div class="setup-summary">
      <p>GitHub should now be showing the Gnosis TMS GitHub App installation page.</p>
      <p>Install the app on the organization you just created. GitHub will send you back here automatically when the installation completes.</p>
    </div>
  `;
}

function renderFinishSummary() {
  return `
    <div class="setup-summary">
      <p>GitHub App installation received.</p>
      <p>Click the button below to finish connecting that organization inside Gnosis TMS.</p>
    </div>
  `;
}

function renderSelectionStep(setup) {
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

  return `
    <div class="setup-summary">
      <p>More than one new organization was found on your GitHub account.</p>
      <p>Select the organization or organizations that should be treated as Gnosis TMS translation teams, then continue.</p>
    </div>
    <div class="org-choice-list">${selectionItems}</div>
  `;
}

function getStepConfig(setup) {
  const isGuideStep = setup.step === "guide";
  const isInstallStep = setup.step === "confirm";
  const isWaitingForInstallStep = setup.step === "waitingForAppInstall";
  const isFinishInstallStep = setup.step === "finishInstall";
  const isSelectionStep = setup.step === "select";

  if (isGuideStep) {
    return {
      eyebrow: "STEP 1 OF 3",
      heading: "Create A New Team",
      supporting:
        'To create a new team, you need to set up an "Organization" on GitHub. Click below to go to the setup page. Then follow these instructions:',
      body: renderGuideStep(),
      actionButton: primaryButton("Open GitHub Organization Setup", "begin-team-org-setup"),
    };
  }

  if (isInstallStep) {
    return {
      eyebrow: "STEP 2 OF 3",
      heading: "Install The GitHub App",
      supporting: "Now install the Gnosis TMS GitHub App on the organization you just created.",
      body: renderInstallSummary(),
      actionButton: primaryButton("Install Gnosis TMS GitHub App", "begin-github-app-install"),
    };
  }

  if (isWaitingForInstallStep) {
    return {
      eyebrow: "STEP 2 OF 3",
      heading: "Waiting For Installation",
      supporting:
        "Complete the installation in GitHub. We will use the installation callback to identify the organization.",
      body: renderWaitingSummary(),
      actionButton: secondaryButton("Waiting for GitHub...", "noop"),
    };
  }

  if (isSelectionStep) {
    return {
      eyebrow: "STEP 3 OF 3",
      heading: "Select Organizations",
      supporting:
        "Gnosis TMS found multiple new organizations on your GitHub account and needs your help identifying the right ones.",
      body: renderSelectionStep(setup),
      actionButton: primaryButton("Continue", "continue-selected-organizations"),
    };
  }

  return {
    eyebrow: "STEP 2 OF 3",
    heading: "Return To Gnosis TMS",
    supporting:
      "GitHub organization creation and GitHub App installation both happen in the browser. Once installation is complete, finish setup here.",
    body: renderFinishSummary(),
    actionButton: primaryButton("Finish setting up your organization", "finish-team-setup"),
  };
}

export function renderSetupModal(state) {
  const setup = state.teamSetup;
  if (!setup?.isOpen) {
    return "";
  }

  const { eyebrow, heading, supporting, body, actionButton } = getStepConfig(setup);
  const errorMarkup = setup.error
    ? `<p class="modal__error">${escapeHtml(setup.error)}</p>`
    : "";
  const debugPanel = state.debugOrgDiscovery
    ? renderOrganizationDebugPanel(setup)
    : "";

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
