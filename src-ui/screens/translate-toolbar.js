import {
  createSearchField,
  escapeHtml,
  renderSelectPillControl,
  secondaryButton,
  textAction,
  tooltipAttributes,
} from "../lib/ui.js";
import {
  EDITOR_ROW_FILTER_MODE_SHOW_ALL,
  EDITOR_ROW_FILTER_OPTIONS,
  labelForEditorRowFilterMode,
} from "../app/editor-filters.js";
import { EDITOR_MODE_PREVIEW, normalizeEditorPreviewSearchState } from "../app/editor-preview.js";
import { EDITOR_FONT_SIZE_OPTIONS } from "../app/state.js";

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

function renderFilterSelect(editorFilters) {
  const selectedMode = editorFilters?.filters?.rowFilterMode ?? EDITOR_ROW_FILTER_MODE_SHOW_ALL;
  const isConflictLocked = editorFilters?.isConflictLocked === true;
  return renderSelectPillControl({
    className: "select-pill--toolbar",
    label: "Filter:",
    value: labelForEditorRowFilterMode(selectedMode),
    tooltip: isConflictLocked
      ? "You must resolve the conflicts before changing this setting."
      : "",
    disabled: isConflictLocked,
    selectAttributes: {
      "data-editor-filter-select": true,
      "aria-label": "Editor filter",
    },
    options: EDITOR_ROW_FILTER_OPTIONS.map((option) => ({
      value: option.value,
      label: option.label,
      selected: option.value === selectedMode,
    })),
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

  return rowCount === 1 ? "Showing 1 matching row" : `Showing ${rowCount} matching rows`;
}

export function renderEditorFilterBanner(editorFilters) {
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

export function renderEditorConflictBanner(editorFilters) {
  if (editorFilters?.isConflictLocked !== true) {
    return "";
  }

  return `
    <div class="translation-results-banner" aria-live="assertive">
      <div class="translation-results-banner__gutter" aria-hidden="true"></div>
      <div class="translation-results-banner__card translation-results-banner__card--error">
        <p class="translation-results-banner__text translation-results-banner__text--error">The following translations have conflicts between the local version and the version saved on GitHub. You must resolve the conflicts before editing other translations.</p>
      </div>
    </div>
  `;
}

export function renderEditorSyncBanner(editorChapter) {
  const banners = [];
  if (editorChapter?.deferredStructuralChanges === true) {
    banners.push("Remote row structure changed. Refresh the file to show inserted or removed rows.");
  }
  if (editorChapter?.backgroundSyncStatus === "error" && editorChapter?.backgroundSyncError) {
    banners.push(`Background sync paused: ${editorChapter.backgroundSyncError}`);
  }

  return banners.map((label) => `
    <div class="translation-results-banner" aria-live="polite">
      <div class="translation-results-banner__gutter" aria-hidden="true"></div>
      <div class="translation-results-banner__card">
        <p class="translation-results-banner__text">${escapeHtml(label)}</p>
      </div>
    </div>
  `).join("");
}

export function renderTranslateModeControl(mode = "translate") {
  return renderTranslateModeControlForMode(mode);
}

function renderTranslateModeControlForMode(mode = "translate") {
  const isPreviewMode = mode === EDITOR_MODE_PREVIEW;
  return `
    <div class="segmented-control" role="tablist" aria-label="Editor mode">
      <button
        class="segmented-control__button${isPreviewMode ? "" : " is-active"}"
        type="button"
        data-action="set-editor-mode:translate"
        role="tab"
        aria-selected="${isPreviewMode ? "false" : "true"}"
      >Translate</button>
      <button
        class="segmented-control__button${isPreviewMode ? " is-active" : ""}"
        type="button"
        data-action="set-editor-mode:preview"
        role="tab"
        aria-selected="${isPreviewMode ? "true" : "false"}"
      >Preview</button>
    </div>
  `;
}

function renderPreviewSearchField(previewSearchState) {
  const normalizedSearchState = normalizeEditorPreviewSearchState(previewSearchState);
  return createSearchField({
    placeholder: "Find in preview",
    value: normalizedSearchState.query,
    inputAttributes: {
      "data-preview-search-input": true,
      "aria-label": "Find in preview",
      autocomplete: "off",
      spellcheck: "false",
    },
  });
}

function renderPreviewSearchNavigation(previewSearchState) {
  const normalizedSearchState = normalizeEditorPreviewSearchState(previewSearchState);
  const hasMatches = normalizedSearchState.totalMatchCount > 0;
  const hasQuery = normalizedSearchState.query.trim().length > 0;
  if (!hasQuery) {
    return "";
  }

  return `
    <div class="preview-search-nav" aria-label="Preview search navigation">
      <button
        type="button"
        class="translation-row-text-style-button preview-search-nav__button"
        data-preview-search-nav-button
        data-action="step-editor-preview-search:previous"
        aria-label="Previous match"
        ${!hasMatches ? "disabled" : ""}
        ${tooltipAttributes("Previous")}
      >
        <span class="translation-row-text-style-button__label" aria-hidden="true">↑</span>
      </button>
      <button
        type="button"
        class="translation-row-text-style-button preview-search-nav__button"
        data-preview-search-nav-button
        data-action="step-editor-preview-search:next"
        aria-label="Next match"
        ${!hasMatches ? "disabled" : ""}
        ${tooltipAttributes("Next")}
      >
        <span class="translation-row-text-style-button__label" aria-hidden="true">↓</span>
      </button>
    </div>
  `;
}

export function renderTranslateToolbar({
  languages,
  sourceCode,
  targetCode,
  editorFilters,
  editorReplace,
  editorFontSizePx,
  sourceLanguageExtraOptions = [],
  targetLanguageExtraOptions = [],
  deriveGlossariesAvailable = false,
}) {
  return `
    <div class="translate-toolbar__body translate-toolbar__body--header">
      <div class="toolbar-row">
        ${renderLanguageSelect("Source", "editor-source-language-select", sourceCode, languages, sourceLanguageExtraOptions)}
        ${renderLanguageSelect("Target", "editor-target-language-select", targetCode, languages, targetLanguageExtraOptions)}
        ${renderFontSizeSelect(editorFontSizePx)}
        ${renderFilterSelect(editorFilters)}
      </div>
      <div class="toolbar-row toolbar-row--between">
        <div class="toolbar-search">
          ${renderEditorSearchField(editorFilters)}
          ${renderEditorReplaceControls(editorReplace)}
        </div>
        <div class="toolbar-meta">
          ${deriveGlossariesAvailable
            ? textAction("Derive glossaries", "open-editor-derive-glossaries", {
              tooltip: "Use this to automatically generate glossaries for the languages that don't have a glossary.",
            })
            : ""}
          ${textAction("AI translate all", "open-editor-ai-translate-all", {
            tooltip: "Translate all empty fields in selected languages",
          })}
          ${textAction("Unreview All", "open-editor-unreview-all", {
            tooltip: 'Remove the "reviewed" mark from all rows of the target language.',
          })}
        </div>
      </div>
    </div>
  `;
}

export function renderPreviewToolbar({
  languages,
  targetCode,
  previewSearchState,
}) {
  return `
    <div class="translate-toolbar__body translate-toolbar__body--header">
      <div class="toolbar-row toolbar-row--between">
        <div class="toolbar-search toolbar-search--preview">
          ${renderLanguageSelect("Target", "editor-target-language-select", targetCode, languages)}
          ${renderPreviewSearchField(previewSearchState)}
          ${renderPreviewSearchNavigation(previewSearchState)}
        </div>
        <div class="toolbar-meta toolbar-meta--preview">
          <button
            type="button"
            class="select-pill select-pill--toolbar select-pill--preview-action"
            data-action="copy-editor-preview-html"
            ${tooltipAttributes("Copy the entire document shown below for pasting into other apps.", { align: "end", side: "bottom" })}
          >
            <span class="select-pill__value">Copy HTML</span>
          </button>
        </div>
      </div>
    </div>
  `;
}
