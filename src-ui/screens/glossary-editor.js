import { glossaries, glossaryTerms } from "../lib/data.js";
import {
  createSearchField,
  escapeHtml,
  navButton,
  pageShell,
  primaryButton,
  textAction,
} from "../lib/ui.js";

export function renderGlossaryEditorScreen(state) {
  const glossary = glossaries.find((item) => item.id === state.selectedGlossaryId) ?? glossaries[0];

  return pageShell({
    title: glossary.name,
    navButtons: [
      navButton("Logout", "start"),
      navButton("Teams", "teams"),
      navButton("Glossaries", "glossaries"),
    ],
    tools: `${createSearchField("Search")} ${primaryButton("+ New Term", "noop")}`,
    pageSync: state.pageSync,
    body: `
      <section class="table-card">
        <div class="term-grid term-grid--head">
          <div>Spanish</div>
          <div>Vietnamese</div>
          <div></div>
        </div>
        ${glossaryTerms
          .map(
            ([source, target]) => `
              <div class="term-grid term-grid--row">
                <div>${escapeHtml(source)}</div>
                <div>${escapeHtml(target)}</div>
                <div class="term-grid__actions">
                  ${textAction("Edit", "noop")}
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
