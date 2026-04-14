import {
  escapeHtml,
  renderCollapseChevron,
  tooltipAttributes,
} from "../lib/ui.js";
import { normalizeEditorSidebarTab } from "../app/editor-comments.js";
import { findEditorHistoryPreviousEntry } from "../app/editor-history.js";
import { renderCommentsPane } from "./translate-comments-pane.js";
import { renderHistoryContent, renderHistoryPane } from "./translate-history-pane.js";

function renderSidebarTab(label, tab, activeTab) {
  const isActive = tab === activeTab;
  return `
    <button
      class="history-tabs__item${isActive ? " history-tabs__item--active" : ""}"
      type="button"
      data-action="switch-editor-sidebar-tab:${escapeHtml(tab)}"
      aria-pressed="${isActive ? "true" : "false"}"
    >
      ${escapeHtml(label)}
    </button>
  `;
}

function renderDuplicatesPane(editorChapter, rows) {
  const activeRow = rows.find((row) => row.id === editorChapter?.activeRowId) ?? null;
  if (!activeRow) {
    return `
      <div class="history-empty">
        <p>Select a translation to view duplicates.</p>
      </div>
    `;
  }

  return `
    <div class="history-empty">
      <p>No duplicates for this row.</p>
    </div>
  `;
}

function renderReviewPane(editorChapter, rows, languages) {
  const expandedSectionKeys =
    editorChapter?.reviewExpandedSectionKeys instanceof Set
      ? editorChapter.reviewExpandedSectionKeys
      : new Set(["last-update"]);
  const activeRow = rows.find((row) => row.id === editorChapter?.activeRowId) ?? null;
  const activeLanguage =
    languages.find((language) => language.code === editorChapter?.activeLanguageCode) ?? null;
  const activeSection =
    activeRow?.sections?.find((section) => section.code === activeLanguage?.code) ?? null;
  const history =
    editorChapter?.history && typeof editorChapter.history === "object"
      ? editorChapter.history
      : {
          status: "idle",
          error: "",
          entries: [],
        };
  const previousEntry = findEditorHistoryPreviousEntry(history.entries, activeSection);
  const currentEntry = {
    plainText: activeSection?.text ?? "",
  };
  const isExpanded = expandedSectionKeys.has("last-update");
  const summaryTooltip = tooltipAttributes(
    isExpanded ? "Collapse this review section" : "Expand this review section",
    { align: "start" },
  );
  const summaryMeta = history.status === "loading"
    ? "Loading..."
    : history.status === "error"
      ? "Error"
      : previousEntry
        ? "Diff"
        : "Text only";

  if (!activeRow || !activeLanguage || !activeSection) {
    return `
      <div class="history-empty">
        <p>Select a translation to view review tools.</p>
      </div>
    `;
  }

  return `
    <div class="history-stack">
      <section class="history-group">
        <button
          class="history-group__toggle"
          type="button"
          data-action="toggle-editor-review-section:last-update"
          aria-expanded="${isExpanded ? "true" : "false"}"
        >
          <span class="history-group__summary collapse-affordance"${summaryTooltip}>
            ${renderCollapseChevron(isExpanded, "history-group__chevron")}
            <span class="history-group__author">Last update</span>
          </span>
          <span class="history-group__meta">${escapeHtml(summaryMeta)}</span>
        </button>
        ${
          isExpanded
            ? `
              <div class="history-group__entries">
                <article class="history-item">
                  <p class="history-item__content" lang="${escapeHtml(activeLanguage.code)}">${renderHistoryContent(currentEntry, previousEntry)}</p>
                  ${
                    history.status === "loading"
                      ? '<p class="history-item__meta">Loading previous version...</p>'
                      : history.status === "error"
                        ? `<p class="history-item__note">${escapeHtml(history.error || "Could not load the previous version.")}</p>`
                        : previousEntry
                          ? '<p class="history-item__meta">Compared with the previous version</p>'
                          : '<p class="history-item__meta">No previous version</p>'
                  }
                </article>
              </div>
            `
            : ""
        }
      </section>
    </div>
  `;
}

export function renderTranslateSidebar(editorChapter, rows, languages, session) {
  const activeTab = normalizeEditorSidebarTab(editorChapter?.sidebarTab);
  const body = activeTab === "comments"
    ? renderCommentsPane(editorChapter, rows, session)
    : activeTab === "review"
      ? renderReviewPane(editorChapter, rows, languages)
    : activeTab === "duplicates"
      ? renderDuplicatesPane(editorChapter, rows)
      : renderHistoryPane(editorChapter, rows, languages);

  return `
    <aside class="translate-sidebar card card--history">
      <div class="card__body">
        <div class="history-tabs">
          ${renderSidebarTab("Review", "review", activeTab)}
          ${renderSidebarTab("History", "history", activeTab)}
          ${renderSidebarTab("Comments", "comments", activeTab)}
          ${renderSidebarTab("Duplicates", "duplicates", activeTab)}
        </div>
        ${body}
      </div>
    </aside>
  `;
}
