import {
  actionNavButton,
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
import { renderQaTermEditorModal } from "./qa-term-editor-modal.js";
import { canManageQaLists, selectedTeam } from "../app/qa-list-shared.js";
import {
  extractGlossaryRubyVisibleText,
  renderGlossaryRubyTermListHtml,
} from "../app/glossary-ruby.js";
import { findChapterContextById, resolveSelectedChapterGlossary } from "../app/project-context.js";

function shortenChapterNavLabel(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "Editor";
  }

  return text.length > 35 ? `${text.slice(0, 35)}...` : text;
}

export function renderQaListEditorScreen(state) {
  const qaList = state.qaListEditor;
  const canManageTerms = canManageQaLists(selectedTeam());
  const chapterTitle =
    findChapterContextById(state.selectedChapterId)?.chapter?.name
    ?? state.editorChapter?.fileTitle
    ?? "";
  const linkedGlossary = resolveSelectedChapterGlossary(state.glossaries);
  const navButtons =
    qaList.navigationSource === "editor"
      ? [
          navButton(shortenChapterNavLabel(chapterTitle), "translate", false, {
            isBack: true,
            disabled: !state.selectedChapterId,
          }),
          actionNavButton("Glossary", "open-editor-glossary", false, {
            disabled: !linkedGlossary?.repoName,
          }),
        ]
      : buildSectionNav("qaListEditor");
  const searchQuery = String(qaList.searchQuery ?? "").trim().toLowerCase();
  const visibleTerms = (Array.isArray(qaList.terms) ? qaList.terms : []).filter((term) => {
    if (!searchQuery) {
      return true;
    }

    return [
      extractGlossaryRubyVisibleText(term.text),
      term.notes,
    ].some((value) => String(value ?? "").toLowerCase().includes(searchQuery));
  });
  const searchField = createSearchField({
    placeholder: "Search",
    value: qaList.searchQuery ?? "",
    inputAttributes: {
      "data-qa-term-search-input": true,
    },
  });
  const renderTextCell = (term) => {
    const html = renderGlossaryRubyTermListHtml([term.text]);
    return canManageTerms
      ? `<button class="glossary-term-link" data-action="edit-qa-term:${term.termId}">${html}</button>`
      : `<span>${html}</span>`;
  };
  const bodyMarkup = qaList.status === "error"
    ? renderStateCard({
      eyebrow: "QA LIST LOAD FAILED",
      title: "Could not load this QA list.",
      subtitle: formatErrorForDisplay(qaList.error || "Unknown error."),
      tone: "error",
    })
    : qaList.status !== "ready"
      ? renderStateCard({
        eyebrow: "LOADING QA TERMS",
        title: "Loading QA terms...",
      })
      : visibleTerms.length
        ? `
          <section class="table-card table-card--glossary-editor">
            <div class="term-grid term-grid--qa-list term-grid--head">
              <div>Text</div>
              <div>Notes</div>
              <div></div>
            </div>
            <div class="term-grid__body">
              ${visibleTerms
                .map(
                  (term) => `
                    <div class="term-grid term-grid--qa-list term-grid--row${canManageTerms ? " term-grid--row--interactive" : ""}"${canManageTerms ? ` data-action="edit-qa-term:${term.termId}"` : ""}>
                      <div>${renderTextCell(term)}</div>
                      <div>${escapeHtml(term.notes ?? "")}</div>
                      <div class="term-grid__actions">
                        ${canManageTerms ? textAction("Edit", `edit-qa-term:${term.termId}`) : ""}
                        ${canManageTerms ? textAction("Delete", `delete-qa-term:${term.termId}`) : ""}
                      </div>
                    </div>
                  `,
                )
                .join("")}
            </div>
          </section>
        `
        : renderStateCard({
          eyebrow: "QA TERMS",
          title: searchQuery ? "No QA terms match this search." : "This QA list has no terms yet.",
          subtitle: "Add the first QA term to begin building this list.",
        });

  return (
    pageShell({
      title: qaList.title || "QA List",
      subtitle: qaList.language?.name ?? "",
      titleAction: buildPageRefreshAction(state, state.pageSync, "refresh-page", {
        backgroundRefreshing: false,
      }),
      navButtons,
      leftTools: searchField,
      tools: canManageTerms ? primaryButton("+ New QA Term", "open-new-qa-term") : "",
      pageSync: state.pageSync,
      noticeText: getNoticeBadgeText(),
      statusItems: getStatusSurfaceItems("qaListEditor"),
      offlineMode: state.offline?.isEnabled === true,
      offlineReconnectState: state.offline?.reconnecting === true,
      body: `<section class="stack">${bodyMarkup}</section>`,
    }) +
    renderQaTermEditorModal(state)
  );
}
