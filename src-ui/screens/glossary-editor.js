import {
  escapeHtml,
  navButton,
  pageShell,
  primaryButton,
  textAction,
  titleRefreshButton,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { getNoticeBadgeText } from "../app/status-feedback.js";
import { renderGlossaryTermEditorModal } from "./glossary-term-editor-modal.js";

export function renderGlossaryEditorScreen(state) {
  const glossary = state.glossaryEditor;
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
  const searchField = `
    <label class="search-field">
      <span class="search-field__icon">⌕</span>
      <input
        type="text"
        placeholder="Search"
        value="${escapeHtml(glossary.searchQuery ?? "")}"
        data-glossary-term-search-input
      />
    </label>
  `;
  const bodyMarkup = glossary.status === "error"
    ? `
      <article class="card card--hero card--empty">
        <div class="card__body">
          <p class="card__eyebrow">GLOSSARY LOAD FAILED</p>
          <h2 class="card__title card__title--small">Could not load this glossary.</h2>
          <p class="card__subtitle">${escapeHtml(formatErrorForDisplay(glossary.error || "Unknown error."))}</p>
        </div>
      </article>
    `
    : glossary.status !== "ready"
      ? `
        <article class="card card--hero card--empty">
          <div class="card__body">
            <p class="card__eyebrow">LOADING TERMS</p>
            <h2 class="card__title card__title--small">Loading glossary terms...</h2>
          </div>
        </article>
      `
    : visibleTerms.length
      ? `
        <section class="table-card">
          <div class="term-grid term-grid--head">
            <div>${escapeHtml(glossary.sourceLanguage?.name ?? "Source")}</div>
            <div>${escapeHtml(glossary.targetLanguage?.name ?? "Target")}</div>
            <div></div>
          </div>
          ${visibleTerms
            .map(
              (term) => `
                <div class="term-grid term-grid--row">
                  <div>
                    <button class="text-link" data-action="edit-glossary-term:${term.termId}">${escapeHtml((term.sourceTerms ?? []).join(", "))}</button>
                  </div>
                  <div>
                    <button class="text-link" data-action="edit-glossary-term:${term.termId}">${escapeHtml((term.targetTerms ?? []).join(", "))}</button>
                  </div>
                  <div class="term-grid__actions">
                    ${textAction("Edit", `edit-glossary-term:${term.termId}`)}
                    ${textAction("Delete", `delete-glossary-term:${term.termId}`)}
                  </div>
                </div>
              `,
            )
            .join("")}
        </section>
      `
      : `
        <article class="card card--hero card--empty">
          <div class="card__body">
            <p class="card__eyebrow">TERMS</p>
            <h2 class="card__title card__title--small">${escapeHtml(searchQuery ? "No terms match this search." : "This glossary has no terms yet.")}</h2>
            <p class="card__subtitle">Add the first term to begin using this glossary in the editor.</p>
          </div>
        </article>
      `;
  const body = `
    <section class="stack">
      ${bodyMarkup}
    </section>
  `;

  return (
    pageShell({
      title: glossary.title || "Glossary",
      titleAction: titleRefreshButton("refresh-page", {
        spinning: state.pageSync?.status === "syncing",
        spinStartedAt: state.pageSync?.startedAt,
        disabled: state.offline?.isEnabled === true || state.pageSync?.status === "syncing",
      }),
      navButtons: [
        navButton("Projects", "projects"),
        navButton("Glossaries", "glossaries"),
      ],
      tools: `${searchField} ${primaryButton("+ New Term", "open-new-term")}`,
      pageSync: state.pageSync,
      noticeText: getNoticeBadgeText(),
      offlineMode: state.offline?.isEnabled === true,
      offlineReconnectState: state.offline?.reconnecting === true,
      body,
    }) +
    renderGlossaryTermEditorModal(state)
  );
}
