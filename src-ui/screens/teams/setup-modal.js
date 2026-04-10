import { escapeHtml, primaryButton, secondaryButton } from "../../lib/ui.js";
import { formatErrorForDisplay } from "../../app/error-display.js";

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
        <li>Click <strong>Next</strong>.</li>
      </ol>
    </div>
  `;
}

const RETURN_FROM_ORG_CREATION_MESSAGE =
  'After clicking "Next" on the GitHub create organization page, leave your browser and come back here.';
const INSTALL_FLOW_MESSAGE =
  "Click below to go to GitHub and install Gnosis TMS in your new organization. This will give Gnosis TMS permission to store data in your GitHub account.<br><br>When you finish, GitHub will send you back here automatically.";
const FINISH_INSTALL_MESSAGE =
  "You have successfully installed Gnosis TMS into your GitHub organization. Click below to finish setup.";

function getStepConfig(setup) {
  const isIntroStep = setup.step === "intro";
  const isGuideStep = setup.step === "guide";
  const isReturnFromOrgCreationStep = setup.step === "returnFromOrgCreation";
  const isInstallStep = setup.step === "confirm";
  const isWaitingForInstallStep = setup.step === "waitingForAppInstall";

  if (isIntroStep) {
    return {
      eyebrow: "New Team",
      heading: "Before you create a new team",
      supporting:
        "Creating a new team is a process with several steps. It's not complicated but you must follow all the steps in order exactly as directed.",
      afterBodyClass: "",
      afterBodySupporting: "",
      body: "",
      actionButton: primaryButton("I understand", "acknowledge-team-setup"),
    };
  }

  if (isGuideStep) {
    return {
      eyebrow: "STEP 1 OF 4",
      heading: "Create A New Team",
      supporting:
        'To create a new team, you need to set up an "Organization" on GitHub. Click below to go to the setup page. Then follow these instructions:',
      afterBodyClass: "modal__supporting--please-check",
      afterBodySupporting:
        'After you click <strong>Next</strong> on GitHub, come back here for step 2.',
      body: renderGuideStep(),
      actionButton: primaryButton("Open GitHub Organization Setup", "begin-team-org-setup"),
    };
  }

  if (isReturnFromOrgCreationStep) {
    return {
      eyebrow: "STEP 2 OF 4",
      heading: "Return To Gnosis TMS",
      supporting: RETURN_FROM_ORG_CREATION_MESSAGE,
      afterBodyClass: "",
      afterBodySupporting: "",
      body: "",
      actionButton: primaryButton("Continue", "continue-team-setup-after-org-creation"),
    };
  }

  if (isInstallStep) {
    return {
      eyebrow: "STEP 3 OF 4",
      heading: "Install Gnosis TMS Into Your GitHub Organization",
      supporting: INSTALL_FLOW_MESSAGE,
      afterBodyClass: "",
      afterBodySupporting: "",
      body: "",
      actionButton: primaryButton("Install Gnosis TMS GitHub App", "begin-github-app-install"),
    };
  }

  if (isWaitingForInstallStep) {
    return {
      eyebrow: "STEP 3 OF 4",
      heading: "Waiting For Installation",
      supporting: INSTALL_FLOW_MESSAGE,
      afterBodyClass: "",
      afterBodySupporting: "",
      body: "",
      actionButton: secondaryButton("Waiting for GitHub...", "noop"),
    };
  }

  return {
    eyebrow: "STEP 4 OF 4",
    heading: "Finish team setup",
    supporting: FINISH_INSTALL_MESSAGE,
    afterBodyClass: "",
    afterBodySupporting: "",
    body: "",
    actionButton: primaryButton("Finish setting up your team", "finish-team-setup"),
  };
}

export function renderSetupModal(state) {
  const setup = state.teamSetup;
  if (!setup?.isOpen) {
    return "";
  }

  const {
    eyebrow,
    heading,
    supporting,
    afterBodyClass,
    afterBodySupporting,
    body,
    actionButton,
  } = getStepConfig(setup);
  const errorMarkup = setup.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(setup.error))}</p>`
    : "";
  const supportingMarkup = supporting
    ? `<p class="modal__supporting">${supporting}</p>`
    : "";
  const afterBodyMarkup = afterBodySupporting
    ? `<p class="modal__supporting${afterBodyClass ? ` ${afterBodyClass}` : ""}">${afterBodySupporting}</p>`
    : "";
  const bodyMarkup = body
    ? `<div class="modal__form">${body}</div>`
    : "";

  return `
    <div class="modal-backdrop">
      <section class="card modal-card">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">${eyebrow}</p>
          <h2 class="modal__title">${heading}</h2>
          ${supportingMarkup}
          ${bodyMarkup}
          ${afterBodyMarkup}
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
