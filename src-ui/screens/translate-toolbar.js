import {
  createSearchField,
  escapeHtml,
  renderSelectPillControl,
  secondaryButton,
  tooltipAttributes,
} from "../lib/ui.js";
import {
  EDITOR_ROW_FILTER_MODE_SHOW_ALL,
  EDITOR_ROW_FILTER_OPTIONS,
  labelForEditorRowFilterMode,
} from "../app/editor-filters.js";
import { EDITOR_MODE_PREVIEW, normalizeEditorPreviewSearchState } from "../app/editor-preview.js";
import { EDITOR_FONT_SIZE_OPTIONS } from "../app/state.js";

const TOOLBAR_ICONS = {
  deriveGlossaries: `
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
      <path d="m8 13 4-7 4 7" />
      <path d="M9.1 11h5.7" />
    </svg>
  `,
  clearTranslations: `
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <line x1="12" x2="18" y1="12" y2="18" />
      <line x1="12" x2="18" y1="18" y2="12" />
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  `,
  aiTranslateAll: `
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="m5 8 6 6" />
      <path d="m4 14 6-6 2-3" />
      <path d="M2 5h12" />
      <path d="M7 2h1" />
      <path d="m22 22-5-10-5 10" />
      <path d="M14 18h6" />
    </svg>
  `,
  aiReviewAll: `
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M13.2 5.25H7a3.75 3.75 0 0 0-3.75 3.75v7a3.75 3.75 0 0 0 3.75 3.75h7a3.75 3.75 0 0 0 3.75-3.75v-4.2" />
      <path d="m7.3 12.55 2.45 2.45 4.8-4.85" />
    </svg>
  `,
  unreviewAll: `
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <defs>
        <mask id="toolbar-unreview-all-underlay-mask" maskUnits="userSpaceOnUse">
          <rect x="0" y="0" width="24" height="24" style="fill: white; stroke: none;" />
          <circle cx="17.5" cy="6.5" r="5.3" style="fill: black; stroke: none;" />
        </mask>
      </defs>
      <path mask="url(#toolbar-unreview-all-underlay-mask)" d="M13.2 5.25H7a3.75 3.75 0 0 0-3.75 3.75v7a3.75 3.75 0 0 0 3.75 3.75h7a3.75 3.75 0 0 0 3.75-3.75v-4.2" />
      <path mask="url(#toolbar-unreview-all-underlay-mask)" d="m7.3 12.55 2.45 2.45 4.8-4.85" />
      <circle cx="17.5" cy="6.5" r="5.3" />
      <path d="m15.6 4.6 3.8 3.8" />
      <path d="m19.4 4.6-3.8 3.8" />
    </svg>
  `,
};

function renderToolbarIconAction(label, action, icon, options = {}) {
  const tooltip = options.tooltip
    ? tooltipAttributes(options.tooltip, options.tooltipOptions)
    : "";
  const disabledAttributes = options.disabled
    ? ' disabled aria-disabled="true" data-offline-blocked="true"'
    : "";
  return `
    <button
      class="toolbar-icon-action${options.disabled ? " is-disabled" : ""}"
      data-action="${escapeHtml(action)}"
      aria-label="${escapeHtml(label)}"
      ${tooltip}
      ${disabledAttributes}
    >
      <span class="toolbar-icon-action__icon" aria-hidden="true">${icon}</span>
    </button>
  `;
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
  clearTranslationsAvailable = false,
  offlineMode = false,
}) {
  const offlineAiTooltip = offlineMode
    ? "AI actions are unavailable offline."
    : "";
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
            ? renderToolbarIconAction("Derive glossaries", "open-editor-derive-glossaries", TOOLBAR_ICONS.deriveGlossaries, {
              tooltip: offlineAiTooltip || "Automatically generate glossaries for the languages that don't have a glossary.",
              tooltipOptions: { align: "end" },
              disabled: offlineMode,
            })
            : ""}
          ${clearTranslationsAvailable
            ? renderToolbarIconAction("Clear translations", "open-editor-clear-translations", TOOLBAR_ICONS.clearTranslations, {
              tooltip: "Clear all translation text for selected languages.",
              tooltipOptions: { align: "end" },
            })
            : ""}
          ${renderToolbarIconAction("AI translate all", "open-editor-ai-translate-all", TOOLBAR_ICONS.aiTranslateAll, {
            tooltip: offlineAiTooltip || "Translate all empty fields in selected languages",
            tooltipOptions: { align: "end" },
            disabled: offlineMode,
          })}
          ${renderToolbarIconAction("Unreview all", "open-editor-unreview-all", TOOLBAR_ICONS.unreviewAll, {
            tooltip: 'Remove the "reviewed" mark from all rows of the target language.',
            tooltipOptions: { align: "end" },
          })}
          ${renderToolbarIconAction("AI Review", "open-editor-ai-review-all", TOOLBAR_ICONS.aiReviewAll, {
            tooltip: offlineAiTooltip || "AI review all target language translations",
            tooltipOptions: { align: "end" },
            disabled: offlineMode,
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
