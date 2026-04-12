import {
  buildPageRefreshAction,
  buildSectionNav,
  createSearchField,
  escapeHtml,
  pageShell,
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
import { buildEditorHistoryViewModel, editorHistoryEntryMatchesSection } from "../app/editor-history.js";
import { buildEditorScreenViewModel } from "../app/editor-screen-model.js";
import { renderTranslationContentRows, renderTranslationMarkerIcon } from "../app/editor-row-render.js";
import { getNoticeBadgeText } from "../app/status-feedback.js";
import { MANAGE_TARGET_LANGUAGES_OPTION_VALUE } from "../app/translate-flow.js";
import { EDITOR_FONT_SIZE_OPTIONS } from "../app/state.js";
import { renderEditorRowInsertModal } from "./editor-row-insert-modal.js";
import { renderEditorRowPermanentDeletionModal } from "./editor-row-permanent-deletion-modal.js";
import { renderTargetLanguageManagerModal } from "./target-language-manager-modal.js";

const historyDiffEngine = new diff_match_patch();

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

function renderEditorSearchField(editorFilters) {
  const caseSensitive = editorFilters?.filters?.caseSensitive === true;
  return createSearchField({
    placeholder: "Search",
    value: editorFilters?.filters?.searchQuery ?? "",
    endAdornment: `
      <button
        type="button"
        class="search-field__action${caseSensitive ? " search-field__action--active" : ""}"
        data-action="toggle-editor-search-case-sensitive"
        data-editor-search-case-toggle
        aria-label="${caseSensitive ? "Disable case-sensitive search" : "Enable case-sensitive search"}"
        aria-pressed="${caseSensitive ? "true" : "false"}"
        ${tooltipAttributes(caseSensitive ? "Disable case-sensitive search" : "Enable case-sensitive search")}
      >
        aA
      </button>
    `,
    inputAttributes: {
      "data-editor-search-input": true,
      "aria-label": "Search visible rows",
    },
  });
}

function renderEditorReplaceField(editorReplace) {
  return createSearchField({
    placeholder: "Replace...",
    value: editorReplace?.replaceQuery ?? "",
    showIcon: false,
    inputAttributes: {
      "data-editor-replace-input": true,
      "aria-label": "Replace selected search matches",
      ...(editorReplace?.status === "saving" ? { disabled: true } : {}),
    },
  });
}

function renderEditorReplaceControls(editorReplace) {
  if (!editorReplace?.isAvailable) {
    return "";
  }

  const isBusy = editorReplace.status === "saving";
  const toggle = `
    <label class="replace-toggle${editorReplace.isEnabled ? " replace-toggle--checkbox-only" : ""}">
      <input
        type="checkbox"
        data-editor-replace-toggle
        aria-label="${editorReplace.isEnabled ? "Hide replace controls" : "Show replace controls"}"
        ${editorReplace.isEnabled ? "checked" : ""}
        ${isBusy ? "disabled" : ""}
      />
      ${editorReplace.isEnabled ? "" : '<span class="replace-toggle__label">Replace</span>'}
    </label>
  `;
  if (!editorReplace.isEnabled) {
    return toggle;
  }

  return `
    ${toggle}
    ${renderEditorReplaceField(editorReplace)}
    ${secondaryButton(
      isBusy ? "Replacing..." : "Replace selected",
      "replace-selected-editor-rows",
      {
        compact: true,
        disabled: isBusy || editorReplace.selectedMatchingRowCount === 0,
        className: "button--replace-toolbar",
      },
    )}
    ${secondaryButton("Select all", "select-all-editor-replace-rows", {
      compact: true,
      disabled: isBusy || editorReplace.matchingRowCount === 0,
      className: "button--replace-toolbar",
      tooltip: "Mark all search results for replacement",
    })}
  `;
}

function renderEditorFilterSummaryLabel(editorFilters) {
  if (!editorFilters?.hasActiveFilters) {
    return null;
  }

  const rowCount = Number.isFinite(editorFilters?.matchingRowCount)
    ? editorFilters.matchingRowCount
    : 0;
  if (rowCount <= 0) {
    return null;
  }

  return rowCount === 1
    ? "Search result: 1 matching row"
    : `Search result: ${rowCount} matching rows`;
}

function renderEditorFilterBanner(editorFilters) {
  const label = renderEditorFilterSummaryLabel(editorFilters);
  if (!label) {
    return "";
  }

  return `
    <div class="translation-results-banner" aria-live="polite">
      <div class="translation-results-banner__gutter" aria-hidden="true"></div>
      <div class="translation-results-banner__card">
        <p class="translation-results-banner__text">${escapeHtml(label)}</p>
      </div>
    </div>
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
      return {
        type:
          operation === DIFF_INSERT
            ? "insert"
            : operation === DIFF_DELETE
              ? "delete"
              : "equal",
        text,
      };
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

function buildHistoryMarkerNoteActions(entry, previousEntry) {
  if (!entry || !previousEntry) {
    return [];
  }

  const actions = [];
  if ((previousEntry.reviewed === true) !== (entry.reviewed === true)) {
    actions.push({
      kind: "reviewed",
      enabled: entry.reviewed === true,
    });
  }
  if ((previousEntry.pleaseCheck === true) !== (entry.pleaseCheck === true)) {
    actions.push({
      kind: "please-check",
      enabled: entry.pleaseCheck === true,
    });
  }

  return actions;
}

function renderHistoryMarkerNoteAction(action) {
  const title =
    action.kind === "reviewed"
      ? action.enabled
        ? "Marked reviewed"
        : "Removed reviewed"
      : action.enabled
        ? 'Marked "Please check"'
        : 'Removed "Please check"';
  const icon = `
    <span
      class="history-item__marker-note-icon history-item__marker-note-icon--${action.kind}${action.enabled ? "" : " history-item__marker-note-icon--removed"}"
      aria-hidden="true"
    >
      ${renderTranslationMarkerIcon(action.kind)}
    </span>
  `;

  return `<span class="history-item__marker-note" title="${escapeHtml(title)}">${icon}</span>`;
}

function buildHistoryMarkerNoteActionsFromStatusNote(statusNote) {
  switch (String(statusNote ?? "").trim()) {
    case "Marked reviewed":
      return [{ kind: "reviewed", enabled: true }];
    case "Marked unreviewed":
    case "Removed reviewed":
      return [{ kind: "reviewed", enabled: false }];
    case 'Marked "Please check"':
      return [{ kind: "please-check", enabled: true }];
    case 'Removed "Please check"':
      return [{ kind: "please-check", enabled: false }];
    default:
      return [];
  }
}

function renderHistoryNote(entry, previousEntry) {
  const markerActions = (
    Array.isArray(entry?.markerNoteActions) && entry.markerNoteActions.length > 0
      ? entry.markerNoteActions
      : buildHistoryMarkerNoteActions(entry, previousEntry)
  );
  if (markerActions.length > 0) {
    return `
      <p class="history-item__note history-item__note--markers">
        ${markerActions.map((action) => renderHistoryMarkerNoteAction(action)).join("")}
      </p>
    `;
  }

  const fallbackMarkerActions = buildHistoryMarkerNoteActionsFromStatusNote(entry?.statusNote);
  if (fallbackMarkerActions.length > 0) {
    return `
      <p class="history-item__note history-item__note--markers">
        ${fallbackMarkerActions.map((action) => renderHistoryMarkerNoteAction(action)).join("")}
      </p>
    `;
  }

  return entry?.statusNote
    ? `<p class="history-item__note">${escapeHtml(entry.statusNote)}</p>`
    : "";
}

function renderHistoryEntry(entry, previousEntry, activeLanguage, activeSection, canRestore, history) {
  const isCurrentValue = editorHistoryEntryMatchesSection(entry, activeSection);
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
      ${renderHistoryNote(entry, previousEntry)}
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
  const canRestore =
    activeRow?.saveStatus === "idle" && activeSection?.markerSaveState?.status !== "saving";
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
          : history.status !== "loading" && historyGroups.length === 0
            ? `
              <div class="history-empty">
                <p>No committed history exists for this translation yet.</p>
              </div>
            `
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

export function renderTranslateScreen(state) {
  const {
    chapter,
    editorChapter,
    languages,
    sourceCode,
    targetCode,
    contentRows,
    editorFilters,
    editorReplace,
    collapsedLanguageCodes,
    editorFontSizePx,
  } = buildEditorScreenViewModel(state);
  const targetLanguageManageOption = [{
    value: MANAGE_TARGET_LANGUAGES_OPTION_VALUE,
    label: "Add / Remove",
  }];
  const titleText = chapter?.name ?? editorChapter?.fileTitle ?? "Translate";
  const displayTitle = middleTruncateTitle(titleText);
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
          ${renderEditorSearchField(editorFilters)}
          ${renderEditorReplaceControls(editorReplace)}
        </div>
        <div class="toolbar-meta">
          ${textAction("Unreview All", "noop")}
        </div>
      </div>
    </div>
  `;

  let translateBody = "";
  if (editorChapter?.status === "loading") {
    translateBody = `
      <article class="card card--translation">
        <div class="card__body">
          <p>Loading file...</p>
        </div>
      </article>
    `;
  } else if (editorChapter?.status === "error") {
    translateBody = `
      <article class="card card--translation">
        <div class="card__body">
          <p>${escapeHtml(editorChapter.error || "The file could not be loaded.")}</p>
        </div>
      </article>
    `;
  } else if (!chapter && !editorChapter?.chapterId) {
    translateBody = `
      <article class="card card--translation">
        <div class="card__body">
          <p>Could not determine which file to open.</p>
        </div>
      </article>
    `;
  } else if (contentRows.length === 0) {
    translateBody = `
      <article class="card card--translation">
        <div class="card__body">
          <p>${escapeHtml(
            editorFilters?.hasActiveFilters
              ? "No rows match the current search."
              : "This file does not contain any translatable rows.",
          )}</p>
        </div>
      </article>
    `;
  } else {
    translateBody = renderTranslationContentRows(
      contentRows,
      collapsedLanguageCodes,
      editorFontSizePx,
      editorReplace,
    );
  }

  return pageShell({
    title: displayTitle,
    titleTooltip: titleText,
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
          <div class="translate-main${editorReplace?.isEnabled ? " translate-main--replace-mode" : ""}">
            ${renderEditorFilterBanner(editorFilters)}
            ${translateBody}
          </div>
        </div>
        <div class="translate-sidebar-scroll">
          ${renderHistorySidebar(editorChapter, contentRows, languages)}
        </div>
      </section>
    `,
  }) + renderTargetLanguageManagerModal(state)
    + renderEditorRowInsertModal(state)
    + renderEditorRowPermanentDeletionModal(state);
}
