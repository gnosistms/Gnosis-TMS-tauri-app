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
      <p>When you get to GitHub:</p>
      <ol class="setup-guide__list">
        <li>Choose <strong>Free</strong>.</li>
        <li>Set the organization to <strong>A business or institution</strong>.</li>
        <li>Create the organization with the name and slug you want your team to use.</li>
        <li>Return to Gnosis TMS after GitHub finishes creating the organization.</li>
      </ol>
    </div>
  `;

  const confirm = `
    <label class="field">
      <span class="field__label">Team Name</span>
      <input class="field__input" type="text" value="${escapeHtml(setup.form.name)}" data-team-field="name" placeholder="Name this team in Gnosis TMS" />
    </label>
    <label class="field">
      <span class="field__label">GitHub Organization Slug</span>
      <input class="field__input" type="text" value="${escapeHtml(setup.form.slug)}" data-team-field="slug" placeholder="the-org-you-created-on-github" />
    </label>
    <label class="field">
      <span class="field__label">Contact Email</span>
      <input class="field__input" type="text" inputmode="email" autocomplete="email" value="${escapeHtml(setup.form.contactEmail)}" data-team-field="contactEmail" placeholder="teamadminaddress@example.com" />
    </label>
    <p class="modal__supporting">
      Enter the organization details you created in GitHub. Gnosis TMS will save them into this repo and create a local git commit for the setup draft.
    </p>
  `;

  const errorMarkup = setup.error
    ? `<p class="modal__error">${escapeHtml(setup.error)}</p>`
    : "";

  const actionButton = isGuideStep
    ? primaryButton("Open GitHub Organization Setup", "begin-team-org-setup")
    : primaryButton("Save Team Setup", "finish-team-setup");

  const body = isGuideStep ? guide : confirm;
  const heading = isGuideStep ? "Create A New Team" : "Finish Team Setup";
  const eyebrow = isGuideStep ? "STEP 1 OF 2" : "STEP 2 OF 2";
  const supporting = isGuideStep
    ? "Gnosis TMS teams are backed by GitHub organizations. The app will guide you to GitHub first, then save the finished team setup after you come back."
    : "Now that the GitHub organization exists, enter the details here so Gnosis TMS can track the team locally and in git.";

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
