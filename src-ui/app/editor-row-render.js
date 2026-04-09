import { escapeHtml, renderCollapseChevron, tooltipAttributes } from "../lib/ui.js";
import {
  buildEditorRowHeights,
  calculateEditorVirtualWindow,
  EDITOR_VIRTUALIZATION_INITIAL_VIEWPORT_PX,
  EDITOR_VIRTUALIZATION_MIN_ROWS,
} from "./editor-virtualization-shared.js";

export function renderTranslationMarkerIcon(kind) {
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
      ${renderTranslationMarkerIcon(kind)}
    </button>
  `;
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

export function renderTranslationContentRow(row, collapsedLanguageCodes = new Set(), rowIndex = null) {
  const orderedSections = orderRowSectionsByCollapsedState(row.sections, collapsedLanguageCodes);
  const rowIndexAttribute = Number.isInteger(rowIndex) ? ` data-row-index="${rowIndex}"` : "";

  return `
    <article class="card card--translation" data-editor-row-card data-row-id="${escapeHtml(row.id)}"${rowIndexAttribute}>
      <div class="card__body">
        <div class="translation-row__stack">
          ${orderedSections
            .map((language) => {
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
            })
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

export function renderTranslationContentRows(
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
