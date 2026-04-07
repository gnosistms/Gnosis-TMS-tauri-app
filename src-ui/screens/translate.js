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

function prefersCharacterHistoryDiff(languageCode) {
  const normalizedCode = String(languageCode ?? "").toLowerCase();
  return normalizedCode === "ja" || normalizedCode.startsWith("zh");
}

function tokenizeHistoryDiffText(value, languageCode) {
  const text = String(value ?? "");
  if (!text) {
    return [];
  }

  const useCharacterDiff = prefersCharacterHistoryDiff(languageCode);
  const segmentGranularity = useCharacterDiff ? "grapheme" : "word";

  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    try {
      return Array.from(
        new Intl.Segmenter(languageCode || undefined, { granularity: segmentGranularity }).segment(text),
        ({ segment }) => segment,
      );
    } catch {
      // Fall through to a simpler tokenizer if the runtime rejects the locale.
    }
  }

  if (useCharacterDiff) {
    return Array.from(text);
  }

  return text.match(/\s+|[^\s]+/g) ?? Array.from(text);
}

function appendHistoryDiffSegment(segments, type, text) {
  if (!text) {
    return;
  }

  const lastSegment = segments[segments.length - 1];
  if (lastSegment?.type === type) {
    lastSegment.text += text;
    return;
  }

  segments.push({ type, text });
}

function buildFallbackHistoryDiffSegments(previousTokens, currentTokens) {
  let prefixLength = 0;
  while (
    prefixLength < previousTokens.length
    && prefixLength < currentTokens.length
    && previousTokens[prefixLength] === currentTokens[prefixLength]
  ) {
    prefixLength += 1;
  }

  let previousSuffixStart = previousTokens.length - 1;
  let currentSuffixStart = currentTokens.length - 1;
  while (
    previousSuffixStart >= prefixLength
    && currentSuffixStart >= prefixLength
    && previousTokens[previousSuffixStart] === currentTokens[currentSuffixStart]
  ) {
    previousSuffixStart -= 1;
    currentSuffixStart -= 1;
  }

  const segments = [];
  appendHistoryDiffSegment(segments, "equal", previousTokens.slice(0, prefixLength).join(""));
  appendHistoryDiffSegment(
    segments,
    "delete",
    previousTokens.slice(prefixLength, previousSuffixStart + 1).join(""),
  );
  appendHistoryDiffSegment(
    segments,
    "insert",
    currentTokens.slice(prefixLength, currentSuffixStart + 1).join(""),
  );
  appendHistoryDiffSegment(
    segments,
    "equal",
    previousTokens.slice(previousSuffixStart + 1).join(""),
  );
  return segments;
}

function buildHistoryDiffSegments(previousText, currentText, languageCode) {
  const previousTokens = tokenizeHistoryDiffText(previousText, languageCode);
  const currentTokens = tokenizeHistoryDiffText(currentText, languageCode);

  if (previousTokens.length === 0) {
    return currentTokens.length === 0 ? [] : [{ type: "insert", text: currentTokens.join("") }];
  }

  if (currentTokens.length === 0) {
    return [{ type: "delete", text: previousTokens.join("") }];
  }

  if (previousTokens.length * currentTokens.length > 640000) {
    return buildFallbackHistoryDiffSegments(previousTokens, currentTokens);
  }

  const lcsMatrix = Array.from(
    { length: previousTokens.length + 1 },
    () => new Uint32Array(currentTokens.length + 1),
  );

  for (let previousIndex = previousTokens.length - 1; previousIndex >= 0; previousIndex -= 1) {
    for (let currentIndex = currentTokens.length - 1; currentIndex >= 0; currentIndex -= 1) {
      lcsMatrix[previousIndex][currentIndex] =
        previousTokens[previousIndex] === currentTokens[currentIndex]
          ? lcsMatrix[previousIndex + 1][currentIndex + 1] + 1
          : Math.max(
            lcsMatrix[previousIndex + 1][currentIndex],
            lcsMatrix[previousIndex][currentIndex + 1],
          );
    }
  }

  const segments = [];
  let previousIndex = 0;
  let currentIndex = 0;

  while (previousIndex < previousTokens.length && currentIndex < currentTokens.length) {
    if (previousTokens[previousIndex] === currentTokens[currentIndex]) {
      appendHistoryDiffSegment(segments, "equal", previousTokens[previousIndex]);
      previousIndex += 1;
      currentIndex += 1;
      continue;
    }

    if (lcsMatrix[previousIndex + 1][currentIndex] >= lcsMatrix[previousIndex][currentIndex + 1]) {
      appendHistoryDiffSegment(segments, "delete", previousTokens[previousIndex]);
      previousIndex += 1;
      continue;
    }

    appendHistoryDiffSegment(segments, "insert", currentTokens[currentIndex]);
    currentIndex += 1;
  }

  while (previousIndex < previousTokens.length) {
    appendHistoryDiffSegment(segments, "delete", previousTokens[previousIndex]);
    previousIndex += 1;
  }

  while (currentIndex < currentTokens.length) {
    appendHistoryDiffSegment(segments, "insert", currentTokens[currentIndex]);
    currentIndex += 1;
  }

  return segments;
}

function renderHistoryContent(entry, previousEntry, languageCode) {
  const currentText = String(entry?.plainText ?? "");
  if (!previousEntry) {
    return escapeHtml(currentText);
  }

  return buildHistoryDiffSegments(previousEntry.plainText, currentText, languageCode)
    .map((segment) => {
      if (segment.type === "equal") {
        return escapeHtml(segment.text);
      }

      return `<span class="history-diff__${segment.type}">${escapeHtml(segment.text)}</span>`;
    })
    .join("");
}

function historyAuthorLabel(entry) {
  return String(entry?.authorName ?? "").trim() || "Unknown author";
}

function buildHistoryGroups(entries) {
  const groups = [];

  for (const entry of entries) {
    const authorName = historyAuthorLabel(entry);
    const previousGroup = groups[groups.length - 1] ?? null;
    if (previousGroup?.authorName === authorName) {
      previousGroup.entries.push(entry);
      continue;
    }

    groups.push({
      key: entry.commitSha,
      authorName,
      entries: [entry],
    });
  }

  return groups;
}

function buildVisibleHistoryEntries(groups, expandedGroupKeys) {
  return groups.flatMap((group) =>
    expandedGroupKeys.has(group.key) ? group.entries : [group.entries[0]],
  );
}

function buildOlderVisibleHistoryEntryMap(entries) {
  return new Map(
    entries.map((entry, index) => [
      entry.commitSha,
      index < entries.length - 1 ? entries[index + 1] : null,
    ]),
  );
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
      { disabled: !canRestore || history.status === "restoring", compact: true },
    );

  return `
    <article class="history-item">
      <p class="history-item__content" lang="${escapeHtml(activeLanguage.code)}">${renderHistoryContent(entry, previousEntry, activeLanguage.code)}</p>
      <p class="history-item__meta">${escapeHtml(
        [historyAuthorLabel(entry), formatHistoryTimestamp(entry.committedAt)]
          .filter(Boolean)
          .join(" · "),
      )}</p>
      <div class="history-item__actions">
        ${restoreButton}
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
  const historyGroups = buildHistoryGroups(Array.isArray(history.entries) ? history.entries : []);
  const visibleHistoryEntries = buildVisibleHistoryEntries(historyGroups, expandedGroupKeys);
  const olderVisibleEntryByCommitSha = buildOlderVisibleHistoryEntryMap(visibleHistoryEntries);

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
                    const revisionLabel = `${group.entries.length} ${group.entries.length === 1 ? "revision" : "revisions"}`;

                    return `
                      <section class="history-group">
                        <${headingTag}${headingAttributes}>
                          <span class="history-group__summary">
                            <span class="history-group__chevron${isExpanded ? " is-expanded" : ""}" aria-hidden="true">
                              <svg viewBox="0 0 12 12" focusable="false" aria-hidden="true">
                                <path d="M4.25 2.5 7.75 6l-3.5 3.5" />
                              </svg>
                            </span>
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

function renderTranslationContentRows(rows, collapsedLanguageCodes = new Set()) {
  return rows
    .map(
      (row) => {
        const orderedSections = orderRowSectionsByCollapsedState(row.sections, collapsedLanguageCodes);
        return `
          <article class="card card--translation">
            <div class="card__body">
              <div class="translation-row__stack">
                ${orderedSections
                  .map(
                    (language) => {
                      const isCollapsed = collapsedLanguageCodes.has(language.code);
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
                  : renderTranslationContentRows(contentRows, collapsedLanguageCodes)
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
