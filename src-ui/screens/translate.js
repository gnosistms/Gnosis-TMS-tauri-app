import { projects, translationRows } from "../lib/data.js";
import {
  buildPageRefreshAction,
  buildSectionNav,
  createSearchField,
  escapeHtml,
  pageShell,
  renderChevronIcon,
  renderSelectPillControl,
  renderCollapseChevron,
  secondaryButton,
  textAction,
  tooltipAttributes,
} from "../lib/ui.js";
import {
  diff_match_patch,
  DIFF_DELETE,
  DIFF_INSERT,
} from "../lib/vendor/diff-match-patch.js";
import { getNoticeBadgeText } from "../app/status-feedback.js";
import { buildEditorHistoryViewModel } from "../app/editor-history.js";
import {
  findChapterContextById,
  MANAGE_TARGET_LANGUAGES_OPTION_VALUE,
} from "../app/translate-flow.js";
import { EDITOR_FONT_SIZE_OPTIONS, coerceEditorFontSizePx } from "../app/state.js";
import {
  buildEditorRowHeights,
  calculateEditorVirtualWindow,
  EDITOR_VIRTUALIZATION_INITIAL_VIEWPORT_PX,
  EDITOR_VIRTUALIZATION_MIN_ROWS,
} from "../app/editor-virtualization-shared.js";
import { renderTargetLanguageManagerModal } from "./target-language-manager-modal.js";

const historyDiffEngine = new diff_match_patch();

function renderMarkerIcon(kind) {
  if (kind === "reviewed") {
    return `
      <svg class="translation-marker-button__icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <rect x="2.25" y="2.25" width="15.5" height="15.5" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"></rect>
        <path d="M6.2 10.25 8.8 12.85 13.9 7.7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    `;
  }

  return `
    <svg class="translation-marker-button__icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="2.25" y="2.25" width="15.5" height="15.5" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"></rect>
      <path d="M8 7.3a2.15 2.15 0 1 1 3.76 1.4c-.74.78-1.5 1.22-1.5 2.33" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
      <circle cx="10" cy="13.9" r="0.95" fill="currentColor"></circle>
    </svg>
  `;
}

function renderLanguageMarkerButton(kind, rowId, language) {
  const isReviewed = language.reviewed === true;
  const isPleaseCheck = language.pleaseCheck === true;
  const isActive = kind === "reviewed" ? isReviewed : isPleaseCheck;
  const isSaving = language.markerSaveState?.status === "saving";
  const label =
    kind === "reviewed"
      ? (isActive ? "Mark unreviewed" : "Mark reviewed")
      : (isActive ? 'Unmark "Please check"' : 'Mark "Please check"');
  const action = kind === "reviewed" ? "toggle-editor-reviewed" : "toggle-editor-please-check";

  return `
    <button
      class="translation-marker-button translation-marker-button--${kind}${isActive ? " is-active" : ""}${isSaving ? " is-saving" : ""}"
      type="button"
      data-action="${action}"
      data-row-id="${escapeHtml(rowId)}"
      data-language-code="${escapeHtml(language.code)}"
      aria-pressed="${isActive ? "true" : "false"}"
      ${isSaving ? "disabled" : ""}
      ${tooltipAttributes(label, { align: "end", side: "bottom" })}
    >
      ${renderMarkerIcon(kind)}
    </button>
  `;
}

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

  return renderSelectPillControl({
    className: "select-pill--toolbar",
    label: `${label}:`,
    value: selectedLanguage.name,
    selectAttributes: {
      [`data-${dataAttribute}`]: true,
      "aria-label": `${label} language`,
    },
    options: [
      ...languages.map((language) => ({
        value: language.code,
        label: language.name,
        selected: language.code === selectedCode,
      })),
      ...extraOptions.map((option) => ({
        value: option.value,
        label: option.label,
      })),
    ],
  });
}

function renderFontSizeSelect(fontSizePx) {
  return renderSelectPillControl({
    className: "select-pill--toolbar select-pill--font-size",
    label: "Font Size:",
    value: String(fontSizePx),
    selectAttributes: {
      "data-editor-font-size-select": true,
      "aria-label": "Editor font size",
    },
    options: EDITOR_FONT_SIZE_OPTIONS.map((option) => ({
      value: String(option),
      label: String(option),
      selected: option === fontSizePx,
    })),
  });
}

function renderFilterSelect() {
  return renderSelectPillControl({
    className: "select-pill--toolbar",
    label: "Filter:",
    value: "Show all",
    selectAttributes: {
      "data-editor-filter-select": true,
      "aria-label": "Editor filter",
    },
    options: [
      {
        value: "show-all",
        label: "Show all",
        selected: true,
      },
    ],
  });
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
        reviewed: row.fieldStates?.[language.code]?.reviewed === true,
        pleaseCheck: row.fieldStates?.[language.code]?.pleaseCheck === true,
        markerSaveState:
          row.markerSaveState?.languageCode === language.code
            ? row.markerSaveState
            : { status: "idle", languageCode: null, kind: null, error: "" },
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

function buildHistoryDiffSegments(previousText, currentText) {
  const diffs = historyDiffEngine.diff_main(String(previousText ?? ""), String(currentText ?? ""), false);
  historyDiffEngine.diff_cleanupSemantic(diffs);
  historyDiffEngine.diff_cleanupSemanticLossless(diffs);

  return diffs
    .filter((diff) => Boolean(diff?.[1]))
    .map((diff) => {
      const operation = diff?.[0];
      const text = diff?.[1] ?? "";
      return ({
      type:
        operation === DIFF_INSERT
          ? "insert"
          : operation === DIFF_DELETE
            ? "delete"
            : "equal",
      text,
      });
    });
}

function renderHistoryContent(entry, previousEntry) {
  const currentText = String(entry?.plainText ?? "");
  if (!previousEntry) {
    return escapeHtml(currentText);
  }

  return buildHistoryDiffSegments(previousEntry.plainText, currentText)
    .map((segment) => {
      if (segment.type === "equal") {
        return escapeHtml(segment.text);
      }

      return `<span class="history-diff__${segment.type}">${escapeHtml(segment.text)}</span>`;
    })
    .join("");
}

function renderHistoryEntry(entry, previousEntry, activeLanguage, activeSection, canRestore, history) {
  const isCurrentValue = canRestore && activeSection?.text === entry.plainText;
  const isRestoring =
    history.status === "restoring" && history.restoringCommitSha === entry.commitSha;
  const restoreButton = isCurrentValue
    ? secondaryButton("Current", "noop", { disabled: true, compact: true })
    : secondaryButton(
      isRestoring ? "Restoring..." : "Restore",
      `restore-editor-history:${entry.commitSha}`,
      {
        disabled: !canRestore || history.status === "restoring",
        compact: true,
        tooltip: "Restore this version to the editor",
        tooltipOptions: { align: "start" },
      },
    );

  return `
    <article class="history-item">
      <p class="history-item__content" lang="${escapeHtml(activeLanguage.code)}">${renderHistoryContent(entry, previousEntry)}</p>
      ${
        entry?.statusNote
          ? `<p class="history-item__note">${escapeHtml(entry.statusNote)}</p>`
          : ""
      }
      <div class="history-item__footer">
        <div class="history-item__actions">
          ${restoreButton}
        </div>
        <p class="history-item__meta">${escapeHtml(formatHistoryTimestamp(entry.committedAt))}</p>
      </div>
    </article>
  `;
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
  const expandedGroupKeys = history.expandedGroupKeys instanceof Set ? history.expandedGroupKeys : new Set();
  const canRestore = activeRow?.saveStatus === "idle";
  const historyView = buildEditorHistoryViewModel(history.entries, expandedGroupKeys);
  const historyGroups = historyView.groups;
  const olderVisibleEntryByCommitSha = historyView.olderVisibleEntryByCommitSha;

  const historyBody = !activeRow || !activeLanguage
    ? `
      <div class="history-empty">
        <p>Select a translation to view its Git history.</p>
      </div>
    `
    : `
      ${
        history.status === "error"
          ? `
            <div class="history-empty">
              <p>${escapeHtml(history.error || "Could not load the Git history for this translation.")}</p>
            </div>
          `
          : !Array.isArray(history.entries) || history.entries.length === 0
            ? (
              history.status === "loading"
                ? ""
                : `
                  <div class="history-empty">
                    <p>No committed history exists for this translation yet.</p>
                  </div>
                `
            )
            : `
              <div class="history-stack">
                ${historyGroups
                  .map((group) => {
                    const isExpandable = group.entries.length > 1;
                    const isExpanded = isExpandable && expandedGroupKeys.has(group.key);
                    const visibleEntries = isExpanded ? group.entries : [group.entries[0]];
                    const headingTag = isExpandable ? "button" : "div";
                    const headingAttributes = isExpandable
                      ? ` class="history-group__toggle" type="button" data-action="toggle-editor-history-group:${escapeHtml(group.key)}" aria-expanded="${isExpanded ? "true" : "false"}"`
                      : ' class="history-group__toggle history-group__toggle--static"';
                    const summaryTooltip = isExpandable
                      ? tooltipAttributes(
                        isExpanded ? "Collapse this group of revisions" : "Expand this group of revisions",
                        { align: "start" },
                      )
                      : "";
                    const revisionLabel = `${group.entries.length} ${group.entries.length === 1 ? "revision" : "revisions"}`;

                    return `
                      <section class="history-group">
                        <${headingTag}${headingAttributes}>
                          <span class="history-group__summary collapse-affordance"${summaryTooltip}>
                            ${renderCollapseChevron(isExpanded, "history-group__chevron")}
                            <span class="history-group__author">${escapeHtml(group.authorName)}</span>
                          </span>
                          <span class="history-group__meta">${escapeHtml(revisionLabel)}</span>
                        </${headingTag}>
                        <div class="history-group__entries">
                          ${visibleEntries
                            .map((entry) =>
                              renderHistoryEntry(
                                entry,
                                olderVisibleEntryByCommitSha.get(entry.commitSha) ?? null,
                                activeLanguage,
                                activeSection,
                                canRestore,
                                history,
                              ),
                            )
                            .join("")}
                        </div>
                      </section>
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

export function renderTranslationContentRow(row, collapsedLanguageCodes = new Set(), rowIndex = null) {
  const orderedSections = orderRowSectionsByCollapsedState(row.sections, collapsedLanguageCodes);
  const rowIndexAttribute = Number.isInteger(rowIndex) ? ` data-row-index="${rowIndex}"` : "";

  return `
    <article class="card card--translation" data-editor-row-card data-row-id="${escapeHtml(row.id)}"${rowIndexAttribute}>
      <div class="card__body">
        <div class="translation-row__stack">
          ${orderedSections
            .map(
              (language) => {
                const isCollapsed = collapsedLanguageCodes.has(language.code);
                return `
                  <section
                    class="translation-language-panel${isCollapsed ? " is-collapsed" : ""}"
                    data-editor-language-panel
                    data-row-id="${escapeHtml(row.id)}"
                    data-language-code="${escapeHtml(language.code)}"
                  >
                    <div class="translation-language-panel__header">
                      <button
                        class="translation-language-panel__toggle collapse-affordance"
                        type="button"
                        data-action="toggle-editor-language:${escapeHtml(language.code)}"
                        data-editor-language-toggle
                        data-row-id="${escapeHtml(row.id)}"
                        data-language-code="${escapeHtml(language.code)}"
                        aria-expanded="${isCollapsed ? "false" : "true"}"
                        ${tooltipAttributes(isCollapsed ? "Show this language" : "Hide this language")}
                      >
                        ${renderCollapseChevron(!isCollapsed, "translation-language-panel__chevron")}
                        <span class="translation-language-panel__label">${escapeHtml(language.name)}</span>
                      </button>
                      <div class="translation-language-panel__actions">
                        ${renderLanguageMarkerButton("reviewed", row.id, language)}
                        ${renderLanguageMarkerButton("please-check", row.id, language)}
                      </div>
                    </div>
                    ${
                      isCollapsed
                        ? ""
                        : `
                          <textarea
                            class="translation-language-panel__field"
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
}

export function renderTranslationContentRowsRange(
  rows,
  collapsedLanguageCodes = new Set(),
  startIndex = 0,
  endIndex = rows.length,
) {
  return rows
    .slice(startIndex, endIndex)
    .map((row, offset) => renderTranslationContentRow(row, collapsedLanguageCodes, startIndex + offset))
    .join("");
}

function shouldVirtualizeEditorRows(rows) {
  return Array.isArray(rows) && rows.length >= EDITOR_VIRTUALIZATION_MIN_ROWS;
}

function renderTranslationContentRows(
  rows,
  collapsedLanguageCodes = new Set(),
  editorFontSizePx = 20,
) {
  if (!shouldVirtualizeEditorRows(rows)) {
    return renderTranslationContentRowsRange(rows, collapsedLanguageCodes);
  }

  const initialRowHeights = buildEditorRowHeights(rows, new Map(), collapsedLanguageCodes, editorFontSizePx);
  const initialWindow = calculateEditorVirtualWindow(
    initialRowHeights,
    0,
    EDITOR_VIRTUALIZATION_INITIAL_VIEWPORT_PX,
  );

  return `
    <div class="translate-virtual-list" data-editor-virtual-list>
      <div
        class="translate-virtual-list__spacer"
        data-editor-virtual-spacer="top"
        style="height: ${initialWindow.topSpacerHeight}px;"
      ></div>
      <div class="translate-virtual-list__items" data-editor-virtual-items>
        ${renderTranslationContentRowsRange(
          rows,
          collapsedLanguageCodes,
          initialWindow.startIndex,
          initialWindow.endIndex,
        )}
      </div>
      <div
        class="translate-virtual-list__spacer"
        data-editor-virtual-spacer="bottom"
        style="height: ${initialWindow.bottomSpacerHeight}px;"
      ></div>
    </div>
  `;
}

export function buildTranslateScreenViewModel(state) {
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
  const displayTitle = middleTruncateTitle(chapter.name);

  return {
    chapter,
    editorChapter,
    languages,
    sourceCode,
    targetCode,
    contentRows,
    collapsedLanguageCodes,
    editorFontSizePx,
    targetLanguageManageOption,
    displayTitle,
  };
}

export function renderTranslateScreen(state) {
  const {
    chapter,
    editorChapter,
    languages,
    sourceCode,
    targetCode,
    contentRows,
    collapsedLanguageCodes,
    editorFontSizePx,
    targetLanguageManageOption,
    displayTitle,
  } = buildTranslateScreenViewModel(state);
  const headerBody = `
    <div class="translate-toolbar__body translate-toolbar__body--header">
      <div class="toolbar-row">
        ${renderLanguageSelect("Source", "editor-source-language-select", sourceCode, languages)}
        ${renderLanguageSelect("Target", "editor-target-language-select", targetCode, languages, targetLanguageManageOption)}
        ${renderFontSizeSelect(editorFontSizePx)}
        ${renderFilterSelect()}
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
                  : renderTranslationContentRows(contentRows, collapsedLanguageCodes, editorFontSizePx)
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
