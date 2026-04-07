import { projects, translationRows } from "../lib/data.js";
import {
  createSearchField,
  escapeHtml,
  navButton,
  pageShell,
  textAction,
  titleRefreshButton,
} from "../lib/ui.js";
import { getNoticeBadgeText } from "../app/status-feedback.js";
import { findChapterContextById } from "../app/translate-flow.js";

function findSelectedChapter(state) {
  const liveChapter = findChapterContextById(state.selectedChapterId)?.chapter ?? null;
  if (liveChapter) {
    return liveChapter;
  }

  return (
    projects.flatMap((project) => project.chapters).find((item) => item.id === state.selectedChapterId) ??
    projects[1].chapters[0]
  );
}

function middleTruncateTitle(value, maxLength = 34) {
  const text = String(value ?? "");
  if (text.length <= maxLength) {
    return text;
  }

  const ellipsis = "...";
  const remaining = maxLength - ellipsis.length;
  const startLength = Math.ceil(remaining / 2);
  const endLength = Math.floor(remaining / 2);
  return `${text.slice(0, startLength)}${ellipsis}${text.slice(text.length - endLength)}`;
}

function chapterLanguageOptions(chapter, editorChapter) {
  if (Array.isArray(editorChapter?.languages) && editorChapter.languages.length > 0) {
    return editorChapter.languages;
  }

  if (Array.isArray(chapter?.languages) && chapter.languages.length > 0) {
    return chapter.languages;
  }

  return [
    { code: "es", name: "Spanish", role: "source" },
    { code: "vi", name: "Vietnamese", role: "target" },
  ];
}

function resolveSelectedLanguageCodes(languages, chapter, editorChapter) {
  const sourceCode =
    editorChapter?.selectedSourceLanguageCode
    ?? chapter?.selectedSourceLanguageCode
    ?? languages[0]?.code
    ?? languages.find((language) => language.role === "source")?.code
    ?? null;
  const targetCode =
    editorChapter?.selectedTargetLanguageCode
    ?? chapter?.selectedTargetLanguageCode
    ?? languages.find((language) => language.code !== sourceCode && language.role === "target")?.code
    ?? languages.find((language) => language.code !== sourceCode)?.code
    ?? sourceCode;

  return { sourceCode, targetCode };
}

function renderLanguageSelect(label, dataAttribute, selectedCode, languages) {
  const selectedLanguage =
    languages.find((language) => language.code === selectedCode)
    ?? languages[0]
    ?? { name: "" };

  return `
    <label class="select-pill select-pill--control">
      <span class="select-pill__label">${escapeHtml(label)}:</span>
      <span class="select-pill__value">${escapeHtml(selectedLanguage.name)}</span>
      <span class="select-pill__chevron" aria-hidden="true">⌄</span>
      <select data-${escapeHtml(dataAttribute)} aria-label="${escapeHtml(label)} language">
        ${languages
          .map(
            (language) => `
              <option value="${escapeHtml(language.code)}" ${
                language.code === selectedCode ? "selected" : ""
              }>${escapeHtml(language.name)}</option>
            `,
          )
          .join("")}
      </select>
    </label>
  `;
}

function renderModeSegmentedControl() {
  return `
    <div class="segmented-control" role="tablist" aria-label="Editor mode">
      <button class="segmented-control__button is-active" aria-selected="true">Translate</button>
      <button class="segmented-control__button" aria-selected="false">Preview</button>
    </div>
  `;
}

function buildLiveTranslationRows(editorChapter) {
  if (!Array.isArray(editorChapter?.rows) || editorChapter.rows.length === 0) {
    return [];
  }

  return editorChapter.rows.map((row, index) => {
    const label =
      row.externalId?.trim()
      || row.description?.trim()
      || row.context?.trim()
      || `Row ${index + 1}`;
    return {
      id: row.rowId,
      title: label,
    };
  });
}

function buildFallbackRows() {
  return translationRows.map((row, index) => ({
    id: row.id,
    title: row.sourceTitle || row.targetTitle || `Row ${index + 1}`,
  }));
}

function renderTranslationContentRows(rows, languages) {
  const languageCount = Array.isArray(languages) ? languages.length : 0;

  return rows
    .map(
      (row, index) => `
        <article class="card card--translation">
          <div class="card__body">
            <div class="translation-row__header">
              <div class="translation-row__title">${escapeHtml(row.title || `Row ${index + 1}`)}</div>
              <div class="translation-row__meta">${escapeHtml(
                `${languageCount} language${languageCount === 1 ? "" : "s"}`,
              )}</div>
            </div>
            <div class="translation-row__stack">
              ${languages
                .map(
                  (language) => `
                    <section class="translation-language-panel">
                      <div class="translation-language-panel__label">${escapeHtml(language.name)}</div>
                      <div class="translation-language-panel__surface"></div>
                    </section>
                  `,
                )
                .join("")}
            </div>
          </div>
        </article>
      `,
    )
    .join("");
}

export function renderTranslateScreen(state) {
  const chapter = findSelectedChapter(state);
  const editorChapter =
    state.editorChapter?.chapterId === state.selectedChapterId ? state.editorChapter : null;
  const languages = chapterLanguageOptions(chapter, editorChapter);
  const { sourceCode, targetCode } = resolveSelectedLanguageCodes(languages, chapter, editorChapter);
  const liveRows = buildLiveTranslationRows(editorChapter);
  const contentRows = liveRows.length > 0 ? liveRows : buildFallbackRows();
  const displayTitle = middleTruncateTitle(chapter.name);
  const headerBody = `
    <div class="translate-toolbar__body translate-toolbar__body--header">
      <div class="toolbar-row">
        ${renderLanguageSelect("Source", "editor-source-language-select", sourceCode, languages)}
        ${renderLanguageSelect("Target", "editor-target-language-select", targetCode, languages)}
        <button class="select-pill">Font Size: 14 <span>⌄</span></button>
        <button class="select-pill">Visible languages: ${escapeHtml(String(languages.length))} <span>⌄</span></button>
        <button class="select-pill">Filter: Show all <span>⌄</span></button>
      </div>
      <div class="toolbar-row toolbar-row--between">
        <div class="toolbar-search">
          ${createSearchField("Search")}
          <label class="replace-toggle"><input type="checkbox" /> Replace</label>
        </div>
        <div class="toolbar-meta">
          ${textAction("Unreview All", "noop")}
        </div>
      </div>
    </div>
  `;

  return pageShell({
    title: displayTitle,
    titleTooltip: chapter.name,
    headerClass: "page-header--editor",
    bodyClass: "page-body--editor",
    titleAction: titleRefreshButton("refresh-page", {
      spinning: state.pageSync?.status === "syncing",
      disabled: state.offline?.isEnabled === true || state.pageSync?.status === "syncing",
    }),
    navButtons: [
      navButton("Projects", "projects"),
      navButton("Glossaries", "glossaries"),
    ],
    tools: renderModeSegmentedControl(),
    headerBody,
    pageSync: state.pageSync,
    noticeText: getNoticeBadgeText(),
    offlineMode: state.offline?.isEnabled === true,
    offlineReconnectState: state.offline?.reconnecting === true,
    body: `
      <section class="translate-layout">
        <div class="translate-main-scroll">
          <div class="translate-main">
            ${
              editorChapter?.status === "loading"
                ? `
                  <article class="card card--translation">
                    <div class="card__body">
                      <p>Loading file...</p>
                    </div>
                  </article>
                `
                : editorChapter?.status === "error"
                  ? `
                    <article class="card card--translation">
                      <div class="card__body">
                        <p>${escapeHtml(editorChapter.error || "The file could not be loaded.")}</p>
                      </div>
                    </article>
                  `
                  : renderTranslationContentRows(contentRows, languages)
            }
          </div>
        </div>
        <div class="translate-sidebar-scroll">
          <aside class="translate-sidebar card card--history">
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
        </div>
      </section>
    `,
  });
}
