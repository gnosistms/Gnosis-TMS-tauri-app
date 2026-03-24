import { teams } from "../lib/data.js";
import { escapeHtml, navButton, pageShell, primaryButton, textAction } from "../lib/ui.js";

export function renderTeamsScreen() {
  const cards = teams
    .map(
      (team) => `
        <article class="card card--list-row">
          <div class="card__body list-row">
            <div class="list-row__content">
              <h2 class="list-row__title">${escapeHtml(team.name)}</h2>
            </div>
            <div class="list-row__actions">
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
    tools: primaryButton("+ New Team", "noop"),
    body: `<section class="stack">${cards}</section>`,
  });
}
