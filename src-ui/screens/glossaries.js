import { glossaries } from "../lib/data.js";
import { navButton, pageShell, primaryButton, textAction } from "../lib/ui.js";

export function renderGlossariesScreen() {
  return pageShell({
    title: "Glossaries",
    navButtons: [
      navButton("Logout", "start"),
      navButton("Teams", "teams"),
      navButton("Projects", "projects"),
    ],
    tools: `${textAction("Upload", "noop")} ${primaryButton("+ New Glossary", "noop")}`,
    body: `
      <section class="table-card">
        <div class="table-card__header glossary-list glossary-list--head">
          <div>Name</div>
          <div>Source Language</div>
          <div>Target Language</div>
          <div></div>
        </div>
        ${glossaries
          .map(
            (glossary) => `
              <div class="glossary-list glossary-list--row">
                <div class="glossary-list__name">
                  <button class="text-link" data-action="open-glossary:${glossary.id}">${glossary.name}</button>
                </div>
                <div>${glossary.sourceLanguage}</div>
                <div>${glossary.targetLanguage}</div>
                <div class="glossary-list__actions">
                  ${textAction("Rename", "noop")}
                  ${textAction("Open", `open-glossary:${glossary.id}`)}
                  ${textAction("Download", "noop")}
                  ${textAction("Delete", "noop")}
                </div>
              </div>
            `,
          )
          .join("")}
      </section>
    `,
  });
}
