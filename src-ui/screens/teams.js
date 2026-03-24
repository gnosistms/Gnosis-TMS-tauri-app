import { escapeHtml, navButton, pageShell, primaryButton, secondaryButton, textAction } from "../lib/ui.js";

function renderSetupModal(state) {
  const setup = state.teamSetup;
  if (!setup?.isOpen) {
    return "";
  }

  const isGuideStep = setup.step === "guide";
  const guide = `
    <div class="setup-guide">
      <p>Gnosis TMS will open GitHub in your default browser so you can create the organization there.</p>
      <p>When GitHub opens:</p>
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
      <p>Gnosis TMS will pull the organization details from GitHub in a later step instead of asking you to re-enter them locally.</p>
    </div>
  `;

  const errorMarkup = setup.error
    ? `<p class="modal__error">${escapeHtml(setup.error)}</p>`
    : "";

  const actionButton = isGuideStep
    ? primaryButton("Open GitHub Organization Setup", "begin-team-org-setup")
    : primaryButton("Done", "finish-team-setup");

  const body = isGuideStep ? guide : confirm;
  const heading = isGuideStep ? "Create A New Team" : "Return To Gnosis TMS";
  const eyebrow = isGuideStep ? "STEP 1 OF 2" : "STEP 2 OF 2";
  const supporting = isGuideStep
    ? 'To create a new team, you need to set up an "Organization" on GitHub. Click below to go to the setup page. Then follow these instructions:'
    : "GitHub organization creation happens in the browser. Once you have finished there, return here and continue.";

  return `
    <div class="modal-backdrop">
      <section class="card modal-card">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">${eyebrow}</p>
          <h2 class="modal__title">${heading}</h2>
          <p class="modal__supporting">${supporting}</p>
          <div class="modal__form">${body}</div>
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
  const cards = state.teams
    .map(
      (team) => `
        <article class="card card--list-row">
          <div class="card__body list-row">
            <div class="list-row__content">
              <h2 class="list-row__title">${escapeHtml(team.name)}</h2>
              <p class="list-row__meta">@${escapeHtml(team.githubOrg)} · owner @${escapeHtml(team.ownerLogin)} · ${team.memberCount} member${team.memberCount === 1 ? "" : "s"} · ${team.repoCount} repo${team.repoCount === 1 ? "" : "s"}</p>
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
    tools: primaryButton("+ New Team", "open-new-team"),
    body: `<section class="stack">${cards}</section>${renderSetupModal(state)}`,
  });
}
