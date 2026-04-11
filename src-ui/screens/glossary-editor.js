import {
  buildPageRefreshAction,
  buildSectionNav,
  createSearchField,
  escapeHtml,
  pageShell,
  primaryButton,
  renderStateCard,
  textAction,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { getNoticeBadgeText } from "../app/status-feedback.js";
import { renderGlossaryTermEditorModal } from "./glossary-term-editor-modal.js";
import { canManageGlossaries, selectedTeam } from "../app/glossary-shared.js";

export function renderGlossaryEditorScreen(state) {
  const glossary = state.glossaryEditor;
  const canManageTerms = canManageGlossaries(selectedTeam());
  const searchQuery = String(glossary.searchQuery ?? "").trim().toLowerCase();
  const visibleTerms = (Array.isArray(glossary.terms) ? glossary.terms : []).filter((term) => {
    if (!searchQuery) {
      return true;
    }

    return [
      ...(Array.isArray(term.sourceTerms) ? term.sourceTerms : []),
      ...(Array.isArray(term.targetTerms) ? term.targetTerms : []),
      term.notesToTranslators,
      term.footnote,
    ].some((value) => String(value ?? "").toLowerCase().includes(searchQuery));
  });
  const searchField = createSearchField({
    placeholder: "Search",
    value: glossary.searchQuery ?? "",
    inputAttributes: {
      "data-glossary-term-search-input": true,
    },
  });
  const renderTermCell = (termId, text) =>
    canManageTerms
      ? `<button class="glossary-term-link" data-action="edit-glossary-term:${termId}">${escapeHtml(text)}</button>`
      : `<span>${escapeHtml(text)}</span>`;
  const bodyMarkup = glossary.status === "error"
    ? renderStateCard({
      eyebrow: "GLOSSARY LOAD FAILED",
      title: "Could not load this glossary.",
      subtitle: formatErrorForDisplay(glossary.error || "Unknown error."),
      tone: "error",
    })
    : glossary.status !== "ready"
      ? renderStateCard({
        eyebrow: "LOADING TERMS",
        title: "Loading glossary terms...",
      })
    : visibleTerms.length
      ? `
        <section class="table-card table-card--glossary-editor">
          <div class="term-grid term-grid--head">
            <div>${escapeHtml(glossary.sourceLanguage?.name ?? "Source")}</div>
            <div>${escapeHtml(glossary.targetLanguage?.name ?? "Target")}</div>
            <div></div>
          </div>
          <div class="term-grid__body">
            ${visibleTerms
              .map(
                (term) => `
                  <div class="term-grid term-grid--row">
                    <div>
                      ${renderTermCell(term.termId, (term.sourceTerms ?? []).join(", "))}
                    </div>
                    <div>
                      ${renderTermCell(term.termId, (term.targetTerms ?? []).join(", "))}
                    </div>
                    <div class="term-grid__actions">
                      ${canManageTerms ? textAction("Edit", `edit-glossary-term:${term.termId}`) : ""}
                      ${canManageTerms ? textAction("Delete", `delete-glossary-term:${term.termId}`) : ""}
                    </div>
                  </div>
                `,
              )
              .join("")}
          </div>
        </section>
      `
      : renderStateCard({
        eyebrow: "TERMS",
        title: searchQuery ? "No terms match this search." : "This glossary has no terms yet.",
        subtitle: "Add the first term to begin using this glossary in the editor.",
      });
  const body = `
    <section class="stack">
      ${bodyMarkup}
    </section>
  `;

  return (
    pageShell({
      title: glossary.title || "Glossary",
      titleAction: buildPageRefreshAction(state),
      navButtons: buildSectionNav("glossaryEditor"),
      tools: canManageTerms ? `${searchField} ${primaryButton("+ New Term", "open-new-term")}` : searchField,
      pageSync: state.pageSync,
      noticeText: getNoticeBadgeText(),
      offlineMode: state.offline?.isEnabled === true,
      offlineReconnectState: state.offline?.reconnecting === true,
      body,
    }) +
    renderGlossaryTermEditorModal(state)
  );
}
