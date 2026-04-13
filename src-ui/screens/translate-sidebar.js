import { escapeHtml } from "../lib/ui.js";
import { normalizeEditorSidebarTab } from "../app/editor-comments.js";
import { renderCommentsPane } from "./translate-comments-pane.js";
import { renderHistoryPane } from "./translate-history-pane.js";

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

export function renderTranslateSidebar(editorChapter, rows, languages, session) {
  const activeTab = normalizeEditorSidebarTab(editorChapter?.sidebarTab);
  const body = activeTab === "comments"
    ? renderCommentsPane(editorChapter, rows, session)
    : activeTab === "duplicates"
      ? renderDuplicatesPane(editorChapter, rows)
      : renderHistoryPane(editorChapter, rows, languages);

  return `
    <aside class="translate-sidebar card card--history">
      <div class="card__body">
        <div class="history-tabs">
          ${renderSidebarTab("History", "history", activeTab)}
          ${renderSidebarTab("Comments", "comments", activeTab)}
          ${renderSidebarTab("Duplicates", "duplicates", activeTab)}
        </div>
        ${body}
      </div>
    </aside>
  `;
}
