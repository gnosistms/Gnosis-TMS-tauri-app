import {
  buildPageRefreshAction,
  buildSectionNav,
  createSearchField,
  escapeHtml,
  navButton,
  pageShell,
  primaryButton,
  renderStateCard,
  textAction,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { getNoticeBadgeText, getStatusSurfaceItems } from "../app/status-feedback.js";
import { renderGlossaryTermEditorModal } from "./glossary-term-editor-modal.js";
import { canManageGlossaries, selectedTeam } from "../app/glossary-shared.js";
import { anyGlossaryTermWriteIsActive } from "../app/glossary-term-write-coordinator.js";
import { findChapterContextById } from "../app/project-context.js";
import {
  extractGlossaryRubyVisibleText,
  renderGlossaryRubyTermListHtml,
} from "../app/glossary-ruby.js";

function shortenChapterNavLabel(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "Editor";
  }

  return text.length > 35 ? `${text.slice(0, 35)}...` : text;
}

export function renderGlossaryEditorScreen(state) {
  const glossary = state.glossaryEditor;
  const canManageTerms = canManageGlossaries(selectedTeam());
  const chapterTitle =
    findChapterContextById(state.selectedChapterId)?.chapter?.name
    ?? state.editorChapter?.fileTitle
    ?? "";
  const navButtons =
    glossary.navigationSource === "editor"
      ? [
          navButton(shortenChapterNavLabel(chapterTitle), "translate", false, {
            isBack: true,
            disabled: !state.selectedChapterId,
          }),
        ]
      : buildSectionNav("glossaryEditor");
  const searchQuery = String(glossary.searchQuery ?? "").trim().toLowerCase();
  const visibleTerms = (Array.isArray(glossary.terms) ? glossary.terms : []).filter((term) => {
    if (!searchQuery) {
      return true;
    }

    return [
      ...(Array.isArray(term.sourceTerms) ? term.sourceTerms.map((value) => extractGlossaryRubyVisibleText(value)) : []),
      ...(Array.isArray(term.targetTerms) ? term.targetTerms.map((value) => extractGlossaryRubyVisibleText(value)) : []),
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
  const renderTermCell = (termId, values) => {
    const html = renderGlossaryRubyTermListHtml(values);
    return canManageTerms
      ? `<button class="glossary-term-link" data-action="edit-glossary-term:${termId}">${html}</button>`
      : `<span>${html}</span>`;
  };
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
                  <div class="term-grid term-grid--row${canManageTerms ? " term-grid--row--interactive" : ""}"${canManageTerms ? ` data-action="edit-glossary-term:${term.termId}"` : ""}>
                    <div>
                      ${renderTermCell(term.termId, term.sourceTerms ?? [])}
                    </div>
                    <div>
                      ${renderTermCell(term.termId, term.targetTerms ?? [])}
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
      titleAction: buildPageRefreshAction(state, state.pageSync, "refresh-page", {
        backgroundRefreshing: anyGlossaryTermWriteIsActive(),
      }),
      navButtons,
      tools: canManageTerms ? `${searchField} ${primaryButton("+ New Term", "open-new-term")}` : searchField,
      pageSync: state.pageSync,
      noticeText: getNoticeBadgeText(),
      statusItems: getStatusSurfaceItems("glossaryEditor"),
      offlineMode: state.offline?.isEnabled === true,
      offlineReconnectState: state.offline?.reconnecting === true,
      body,
    }) +
    renderGlossaryTermEditorModal(state)
  );
}
