import { glossaries, glossaryTerms } from "../lib/data.js";
import {
  createSearchField,
  escapeHtml,
  navButton,
  pageShell,
  primaryButton,
  textAction,
  titleRefreshButton,
} from "../lib/ui.js";
import { getNoticeBadgeText } from "../app/status-feedback.js";

export function renderGlossaryEditorScreen(state) {
  const glossary = glossaries.find((item) => item.id === state.selectedGlossaryId) ?? glossaries[0];

  return pageShell({
    title: glossary.name,
    titleAction: titleRefreshButton("refresh-page", {
      spinning: state.pageSync?.status === "syncing",
      disabled: state.offline?.isEnabled === true || state.pageSync?.status === "syncing",
    }),
    navButtons: [
      navButton("Logout", "start"),
      navButton("Teams", "teams"),
      navButton("Glossaries", "glossaries"),
    ],
    tools: `${createSearchField("Search")} ${primaryButton("+ New Term", "noop")}`,
    pageSync: state.pageSync,
    noticeText: getNoticeBadgeText(),
    offlineMode: state.offline?.isEnabled === true,
    offlineReconnectState: state.offline?.reconnecting === true,
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
