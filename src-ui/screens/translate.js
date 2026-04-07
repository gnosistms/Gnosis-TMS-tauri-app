import { projects, translationRows } from "../lib/data.js";
import {
  buildPageRefreshAction,
  buildSectionNav,
  createSearchField,
  escapeHtml,
  pageShell,
  secondaryButton,
  textAction,
} from "../lib/ui.js";
import { getNoticeBadgeText } from "../app/status-feedback.js";
import {
  findChapterContextById,
  MANAGE_TARGET_LANGUAGES_OPTION_VALUE,
} from "../app/translate-flow.js";
import { EDITOR_FONT_SIZE_OPTIONS, coerceEditorFontSizePx } from "../app/state.js";
import { renderTargetLanguageManagerModal } from "./target-language-manager-modal.js";

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

function renderLanguageSelect(label, dataAttribute, selectedCode, languages, extraOptions = []) {
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
        ${extraOptions
          .map(
            (option) => `
              <option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>
            `,
          )
          .join("")}
      </select>
    </label>
  `;
}

function renderFontSizeSelect(fontSizePx) {
  return `
    <label class="select-pill select-pill--control select-pill--font-size">
      <span class="select-pill__label">Font Size:</span>
      <span class="select-pill__value">${escapeHtml(String(fontSizePx))}</span>
      <span class="select-pill__chevron" aria-hidden="true">⌄</span>
      <select data-editor-font-size-select aria-label="Editor font size">
        ${EDITOR_FONT_SIZE_OPTIONS
          .map(
            (option) => `
              <option value="${escapeHtml(String(option))}" ${option === fontSizePx ? "selected" : ""}>${escapeHtml(String(option))}</option>
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

function buildLiveTranslationRows(editorChapter, languages) {
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
      saveStatus: row.saveStatus || "idle",
      saveError: row.saveError || "",
      sections: languages.map((language) => ({
        code: language.code,
        name: language.name,
        text: row.fields?.[language.code] ?? "",
      })),
    };
  });
}

function buildFallbackRows(languages) {
  return translationRows.map((row, index) => ({
    id: row.id,
    title: row.sourceTitle || row.targetTitle || `Row ${index + 1}`,
    saveStatus: "idle",
    saveError: "",
    sections: languages.map((language, languageIndex) => ({
      code: language.code,
      name: language.name,
      text:
        languageIndex === 0
          ? row.sourceBody || ""
          : languageIndex === 1
            ? row.targetBody || ""
            : "",
    })),
  }));
}

function orderRowSectionsByCollapsedState(sections, collapsedLanguageCodes = new Set()) {
  const expandedSections = [];
  const collapsedSections = [];

  for (const section of sections) {
    if (collapsedLanguageCodes.has(section.code)) {
      collapsedSections.push(section);
    } else {
      expandedSections.push(section);
    }
  }

  return [...expandedSections, ...collapsedSections];
}

function summarizeTranslationText(value, maxLength = 54) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "Empty translation";
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function formatHistoryTimestamp(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function renderHistorySidebar(editorChapter, rows, languages) {
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
          restoringCommitSha: null,
        };
  const canRestore = activeRow?.saveStatus === "idle";
  const hasUnsavedChanges = activeRow && activeRow.saveStatus !== "idle";

  const historyBody = !activeRow || !activeLanguage
    ? `
      <div class="history-empty">
        <p>Select a translation to view its Git history.</p>
      </div>
    `
    : `
      <div class="history-context">
        <p class="history-context__eyebrow">${escapeHtml(activeLanguage.name)}</p>
        <h3>${escapeHtml(activeRow.title)}</h3>
        <p class="history-context__excerpt">${escapeHtml(summarizeTranslationText(activeSection?.text))}</p>
      </div>
      ${
        hasUnsavedChanges
          ? '<p class="history-note">Save the current row before restoring a previous revision.</p>'
          : ""
      }
      ${
        history.status === "loading"
          ? `
            <div class="history-empty">
              <p>Loading history...</p>
            </div>
          `
          : history.status === "error"
            ? `
              <div class="history-empty">
                <p>${escapeHtml(history.error || "Could not load the Git history for this translation.")}</p>
              </div>
            `
            : !Array.isArray(history.entries) || history.entries.length === 0
              ? `
                <div class="history-empty">
                  <p>No committed history exists for this translation yet.</p>
                </div>
              `
              : `
                <div class="history-stack">
                  ${history.entries
                    .map((entry) => {
                      const isCurrentValue = canRestore && activeSection?.text === entry.plainText;
                      const isRestoring =
                        history.status === "restoring" && history.restoringCommitSha === entry.commitSha;
                      const restoreButton = isCurrentValue
                        ? secondaryButton("Current", "noop", { disabled: true })
                        : secondaryButton(
                          isRestoring ? "Restoring..." : "Restore",
                          `restore-editor-history:${entry.commitSha}`,
                          { disabled: !canRestore || history.status === "restoring" },
                        );

                      return `
                        <article class="history-item">
                          <h3>${escapeHtml(summarizeTranslationText(entry.plainText))}</h3>
                          <p class="history-item__meta">${escapeHtml(
                            [entry.authorName || "Unknown author", formatHistoryTimestamp(entry.committedAt)]
                              .filter(Boolean)
                              .join(" · "),
                          )}</p>
                          ${
                            entry.message
                              ? `<p class="history-item__message">${escapeHtml(entry.message)}</p>`
                              : ""
                          }
                          ${restoreButton}
                        </article>
                      `;
                    })
                    .join("")}
                </div>
              `
      }
    `;

  return `
    <aside class="translate-sidebar card card--history">
      <div class="card__body">
        <div class="history-tabs">
          <button class="history-tabs__item history-tabs__item--active">History</button>
          <button class="history-tabs__item">Comments</button>
          <button class="history-tabs__item">Duplicates</button>
        </div>
        ${historyBody}
      </div>
    </aside>
  `;
}

function renderTranslationContentRows(rows, collapsedLanguageCodes = new Set(), activeField = {}) {
  return rows
    .map(
      (row) => {
        const orderedSections = orderRowSectionsByCollapsedState(row.sections, collapsedLanguageCodes);
        return `
          <article class="card card--translation">
            <div class="card__body">
              ${
                row.saveStatus === "saving"
                  ? '<div class="translation-row__header"><div class="translation-row__meta">Saving...</div></div>'
                  : row.saveStatus === "dirty"
                    ? '<div class="translation-row__header"><div class="translation-row__meta">Unsaved</div></div>'
                    : row.saveStatus === "error"
                      ? `<div class="translation-row__header"><div class="translation-row__meta translation-row__meta--error">${escapeHtml(row.saveError || "Save failed")}</div></div>`
                      : ""
              }
              <div class="translation-row__stack">
                ${orderedSections
                  .map(
                    (language) => {
                      const isCollapsed = collapsedLanguageCodes.has(language.code);
                      const isActiveSelection =
                        activeField.rowId === row.id && activeField.languageCode === language.code;
                      return `
                        <section class="translation-language-panel${isCollapsed ? " is-collapsed" : ""}">
                          <button
                            class="translation-language-panel__toggle"
                            type="button"
                            data-action="toggle-editor-language:${escapeHtml(language.code)}"
                            aria-expanded="${isCollapsed ? "false" : "true"}"
                          >
                            <span class="translation-language-panel__chevron${isCollapsed ? " is-collapsed" : ""}" aria-hidden="true">
                              <svg viewBox="0 0 12 12" focusable="false" aria-hidden="true">
                                <path d="M2.5 4.25 6 7.75l3.5-3.5" />
                              </svg>
                            </span>
                            <span class="translation-language-panel__label">${escapeHtml(language.name)}</span>
                          </button>
                          ${
                            isCollapsed
                              ? ""
                              : `
                                <textarea
                                  class="translation-language-panel__field${isActiveSelection ? " is-active-selection" : ""}"
                                  data-editor-row-field
                                  data-row-id="${escapeHtml(row.id)}"
                                  data-language-code="${escapeHtml(language.code)}"
                                  lang="${escapeHtml(language.code)}"
                                  spellcheck="false"
                                >${escapeHtml(language.text)}</textarea>
                              `
                          }
                        </section>
                      `;
                    },
                  )
                  .join("")}
              </div>
            </div>
          </article>
        `;
      },
    )
    .join("");
}

export function renderTranslateScreen(state) {
  const chapter = findSelectedChapter(state);
  const editorChapter =
    state.editorChapter?.chapterId === state.selectedChapterId ? state.editorChapter : null;
  const languages = chapterLanguageOptions(chapter, editorChapter);
  const { sourceCode, targetCode } = resolveSelectedLanguageCodes(languages, chapter, editorChapter);
  const liveRows = buildLiveTranslationRows(editorChapter, languages);
  const contentRows = liveRows.length > 0 ? liveRows : buildFallbackRows(languages);
  const collapsedLanguageCodes =
    editorChapter?.collapsedLanguageCodes instanceof Set
      ? editorChapter.collapsedLanguageCodes
      : new Set();
  const editorFontSizePx = coerceEditorFontSizePx(editorChapter?.fontSizePx);
  const targetLanguageManageOption = [{
    value: MANAGE_TARGET_LANGUAGES_OPTION_VALUE,
    label: "Add / Remove",
  }];
  const activeField = {
    rowId: editorChapter?.activeRowId ?? null,
    languageCode: editorChapter?.activeLanguageCode ?? null,
  };
  const displayTitle = middleTruncateTitle(chapter.name);
  const headerBody = `
    <div class="translate-toolbar__body translate-toolbar__body--header">
      <div class="toolbar-row">
        ${renderLanguageSelect("Source", "editor-source-language-select", sourceCode, languages)}
        ${renderLanguageSelect("Target", "editor-target-language-select", targetCode, languages, targetLanguageManageOption)}
        ${renderFontSizeSelect(editorFontSizePx)}
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
    titleAction: buildPageRefreshAction(state),
    navButtons: buildSectionNav("translate"),
    tools: renderModeSegmentedControl(),
    headerBody,
    pageSync: state.pageSync,
    noticeText: getNoticeBadgeText(),
    offlineMode: state.offline?.isEnabled === true,
    offlineReconnectState: state.offline?.reconnecting === true,
    body: `
      <section class="translate-layout" style="--translation-editor-font-size: ${escapeHtml(String(editorFontSizePx))}px;">
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
                  : renderTranslationContentRows(contentRows, collapsedLanguageCodes, activeField)
            }
          </div>
        </div>
        <div class="translate-sidebar-scroll">
          ${renderHistorySidebar(editorChapter, contentRows, languages)}
        </div>
      </section>
    `,
  }) + renderTargetLanguageManagerModal(state);
}
