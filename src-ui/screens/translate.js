import { projects, translationRows } from "../lib/data.js";
import {
  createSearchField,
  escapeHtml,
  navButton,
  pageShell,
  textAction,
} from "../lib/ui.js";

export function renderTranslateScreen(state) {
  const chapter =
    projects.flatMap((project) => project.chapters).find((item) => item.id === state.selectedChapterId) ??
    projects[1].chapters[0];

  return pageShell({
    title: chapter.name,
    navButtons: [
      navButton("Logout", "start"),
      navButton("Teams", "teams"),
      navButton("Projects", "projects"),
      navButton("Glossaries", "glossaries"),
    ],
    body: `
      <section class="translate-toolbar card">
        <div class="card__body translate-toolbar__body">
          <div class="toolbar-row">
            <button class="pill pill--active">Translate</button>
            <button class="pill">Preview</button>
            <button class="select-pill">Source: Spanish <span>⌄</span></button>
            <button class="select-pill">Target: Vietnamese <span>⌄</span></button>
            <button class="select-pill">Font Size: 14 <span>⌄</span></button>
            <button class="select-pill">Visible languages: 3 <span>⌄</span></button>
            <button class="select-pill">Filter: Show all <span>⌄</span></button>
          </div>
          <div class="toolbar-row toolbar-row--between">
            <div class="toolbar-search">
              ${createSearchField("Search")}
              <label class="replace-toggle"><input type="checkbox" /> Replace</label>
            </div>
            <div class="toolbar-meta">
              <span>936 source words</span>
              ${textAction("Unreview All", "noop")}
              ${textAction("Download", "noop")}
            </div>
          </div>
        </div>
      </section>
      <section class="translate-layout">
        <div class="translate-main">
          ${translationRows
            .map(
              (row) => `
                <article class="card card--translation">
                  <div class="card__body">
                    <div class="translation-row__meta">
                      ${textAction("Insert", "noop")}
                      ${textAction("Delete", "noop")}
                    </div>
                    <div class="translation-row__grid">
                      <div class="translation-cell">
                        <div class="translation-cell__title">${escapeHtml(row.sourceTitle)}</div>
                        <p>${escapeHtml(row.sourceBody)}</p>
                        <textarea>${
                          row.targetEditable ? escapeHtml(row.notes) : ""
                        }</textarea>
                        <div class="translation-cell__actions">
                          <button class="button button--secondary">Cancel</button>
                          <button class="button button--primary">Save</button>
                          <button class="button button--primary">Save & Review</button>
                        </div>
                      </div>
                      <div class="translation-cell">
                        <div class="translation-cell__title">${escapeHtml(row.targetTitle)}</div>
                        <p>${escapeHtml(row.targetBody)}</p>
                        <div class="translation-cell__note">${escapeHtml(row.notes)}</div>
                      </div>
                    </div>
                    <div class="translation-row__footer">
                      <span class="status-badge status-badge--${
                        row.status === "Reviewed" ? "good" : "warning"
                      }">${escapeHtml(row.status)}</span>
                      <button class="button button--secondary">Comments</button>
                    </div>
                  </div>
                </article>
              `,
            )
            .join("")}
        </div>
        <aside class="card card--history">
          <div class="card__body">
            <div class="history-tabs">
              <button class="history-tabs__item history-tabs__item--active">History</button>
              <button class="history-tabs__item">Comments</button>
              <button class="history-tabs__item">Duplicates</button>
            </div>
            <div class="history-stack">
              ${[1, 2, 3]
                .map(
                  () => `
                    <article class="history-item">
                      <h3>Chuong 1 - Tinh yeu</h3>
                      <p>Uploaded 27/01/2026</p>
                      <button class="button button--secondary">Restore</button>
                    </article>
                  `,
                )
                .join("")}
            </div>
          </div>
        </aside>
      </section>
    `,
  });
}
