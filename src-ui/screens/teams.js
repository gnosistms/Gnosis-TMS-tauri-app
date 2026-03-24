import { escapeHtml, navButton, pageShell, primaryButton, secondaryButton, textAction } from "../lib/ui.js";

function renderSetupModal(state) {
  const setup = state.teamSetup;
  if (!setup?.isOpen) {
    return "";
  }

  const creator = state.auth.session?.login ?? "current-user";
  const isDraftStep = setup.step === "details";
  const details = `
    <label class="field">
      <span class="field__label">Team Name</span>
      <input class="field__input" type="text" value="${escapeHtml(setup.form.name)}" data-team-field="name" placeholder="Enter team name" />
    </label>
    <label class="field">
      <span class="field__label">GitHub Organization Slug</span>
      <input class="field__input" type="text" value="${escapeHtml(setup.form.slug)}" data-team-field="slug" placeholder="This will be generated automatically." />
    </label>
    <label class="field">
      <span class="field__label">Contact Email</span>
      <input class="field__input" type="email" value="${escapeHtml(setup.form.contactEmail)}" data-team-field="contactEmail" placeholder="teamadminaddress@example.com" />
    </label>
  `;

  const verify = `
    <div class="setup-summary">
      <p><strong>Team:</strong> ${escapeHtml(setup.form.name)}</p>
      <p><strong>GitHub org:</strong> ${escapeHtml(setup.form.slug)}</p>
      <p><strong>Owner:</strong> @${escapeHtml(creator)}</p>
      <p><strong>Contact email:</strong> ${escapeHtml(setup.form.contactEmail)}</p>
    </div>
    <label class="field">
      <span class="field__label">GitHub Organization Slug To Confirm</span>
      <input class="field__input" type="text" value="${escapeHtml(setup.form.confirmedSlug)}" data-team-field="confirmedSlug" placeholder="${escapeHtml(setup.form.slug)}" />
    </label>
    <p class="modal__supporting">
      After creating the organization in GitHub, come back here and confirm the slug so Gnosis TMS can finish setup and prepare the team metadata flow.
    </p>
  `;

  const errorMarkup = setup.error
    ? `<p class="modal__error">${escapeHtml(setup.error)}</p>`
    : "";

  const actionButton = isDraftStep
    ? primaryButton("Open GitHub Organization Setup", "begin-team-org-setup")
    : primaryButton("Finish Team Setup", "finish-team-setup");

  const body = isDraftStep ? details : verify;
  const heading = isDraftStep ? "Create A New Team" : "Finish GitHub Organization Setup";
  const eyebrow = isDraftStep ? "STEP 1 OF 2" : "STEP 2 OF 2";
  const supporting = isDraftStep
    ? "A Gnosis TMS team is backed by its own GitHub organization. We will open GitHub in your browser, then you will return here to finalize the team."
    : "GitHub organization creation happens in the browser. Once you have created it, finish setup here so the app can treat it as a Gnosis TMS team.";

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
