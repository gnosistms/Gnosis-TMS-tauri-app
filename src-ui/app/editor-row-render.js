import {
  escapeHtml,
  renderInlineStateBox,
  renderCollapseChevron,
  sectionSeparator,
  textAction,
  tooltipAttributes,
} from "../lib/ui.js";
import { editorFieldImageMetadataText } from "./editor-images.js";
import { convertLocalFileSrc } from "./runtime.js";
import {
  buildEditorRowHeights,
  calculateEditorVirtualWindow,
  EDITOR_VIRTUALIZATION_INITIAL_VIEWPORT_PX,
  EDITOR_VIRTUALIZATION_MIN_ROWS,
} from "./editor-virtualization-shared.js";
import {
  EDITOR_ROW_TEXT_STYLE_OPTIONS,
  normalizeEditorRowTextStyle,
} from "./editor-row-text-style.js";

export function renderTranslationMarkerIcon(kind) {
  if (kind === "comments") {
    return `
      <svg class="translation-marker-button__icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <rect x="2.25" y="2.25" width="15.5" height="15.5" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"></rect>
        <path d="M10 5.9v5.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
        <circle cx="10" cy="14.1" r="1.05" fill="currentColor"></circle>
      </svg>
    `;
  }

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

function renderUnreadCommentsMarkerIcon() {
  return renderTranslationMarkerIcon("comments");
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

function renderCommentsMarkerButton(rowId, language) {
  if (language.showCommentsButton !== true) {
    return "";
  }

  const hasComments = language.hasComments === true;
  const hasUnreadComments = language.hasUnreadComments === true;
  const isSelectedCommentsRow = language.isSelectedCommentsRow === true;
  const title = "View / edit comments";

  return `
    <button
      class="translation-marker-button translation-marker-button--comments${hasComments ? " is-active" : ""}${hasUnreadComments ? " is-unread" : ""}"
      type="button"
      data-action="open-editor-comments"
      data-row-id="${escapeHtml(rowId)}"
      data-language-code="${escapeHtml(language.code)}"
      aria-pressed="${isSelectedCommentsRow ? "true" : "false"}"
      ${tooltipAttributes(title, { align: "end", side: "bottom" })}
    >
      ${hasUnreadComments ? renderUnreadCommentsMarkerIcon() : renderTranslationMarkerIcon("comments")}
    </button>
  `;
}

function renderEditorRowSyncBadges(row) {
  const badges = [];
  if (row.hasConflict) {
    badges.push('<span class="translation-row-badge translation-row-badge--conflict">Conflict</span>');
  } else if (row.remotelyDeleted) {
    badges.push('<span class="translation-row-badge translation-row-badge--deleted">Deleted Remotely</span>');
  } else if (row.isStale) {
    badges.push('<span class="translation-row-badge translation-row-badge--stale">Stale</span>');
  }

  if (badges.length === 0) {
    return "";
  }

  return `<div class="translation-row__badges">${badges.join("")}</div>`;
}

function renderEditorRowConflictActions(row) {
  return row.hasConflict ? "" : "";
}

function renderEditorRowContextAction(row) {
  if (row?.showContextAction !== true) {
    return "";
  }

  return `
    <div class="translation-row__context">
      ${textAction("Show in context", `show-editor-row-in-context:${row.id}`, {
        tooltip: "Exit the search and scroll to the position of this result",
      })}
    </div>
  `;
}

function renderRowTextStyleButtons(row, language) {
  const selectedTextStyle = normalizeEditorRowTextStyle(row?.textStyle);
  const isSaving = row?.textStyleSaveState?.status === "saving";
  const showAddFootnoteButton = language.showAddFootnoteButton === true;
  const secondaryButtons = [];

  if (showAddFootnoteButton) {
    secondaryButtons.push(`
      <button
        class="translation-row-text-style-button translation-row-text-style-button--footnote"
        type="button"
        data-action="open-editor-footnote"
        data-editor-footnote-button
        data-row-id="${escapeHtml(row.id)}"
        data-language-code="${escapeHtml(language.code)}"
        ${tooltipAttributes("Add footnote", { side: "top" })}
      >
        <span class="translation-row-text-style-button__label" aria-hidden="true">*</span>
      </button>
    `);
  }

  if (language.showAddImageButtons === true) {
    secondaryButtons.push(`
      <button
        class="translation-row-text-style-button translation-row-text-style-button--image"
        type="button"
        data-action="open-editor-image-url"
        data-editor-image-button
        data-row-id="${escapeHtml(row.id)}"
        data-language-code="${escapeHtml(language.code)}"
        ${tooltipAttributes("Add image by link", { side: "top" })}
      >
        <span class="translation-row-text-style-button__label">img url</span>
      </button>
    `);
    secondaryButtons.push(`
      <button
        class="translation-row-text-style-button translation-row-text-style-button--image"
        type="button"
        data-action="open-editor-image-upload"
        data-editor-image-button
        data-row-id="${escapeHtml(row.id)}"
        data-language-code="${escapeHtml(language.code)}"
        ${tooltipAttributes("Upload image", { side: "top" })}
      >
        <span class="translation-row-text-style-button__label">img ↑</span>
      </button>
    `);
  }

  return `
    <div class="translation-row-text-style-actions">
      <div class="translation-row-text-style-actions__group" role="radiogroup" aria-label="Text style">
        ${EDITOR_ROW_TEXT_STYLE_OPTIONS.map((option) => `
          <button
            class="translation-row-text-style-button${selectedTextStyle === option.value ? " is-active" : ""}${isSaving ? " is-saving" : ""}"
            type="button"
            role="radio"
            data-action="set-editor-row-text-style"
            data-editor-row-text-style-button
            data-row-id="${escapeHtml(row.id)}"
            data-language-code="${escapeHtml(language.code)}"
            data-text-style="${escapeHtml(option.value)}"
            aria-checked="${selectedTextStyle === option.value ? "true" : "false"}"
            ${isSaving ? "disabled" : ""}
            ${tooltipAttributes(option.tooltip, { side: "top" })}
          >
            <span class="translation-row-text-style-button__label">${escapeHtml(option.label)}</span>
          </button>
        `).join("")}
      </div>
      ${
        secondaryButtons.length > 0
          ? `
            <span class="translation-row-text-style-actions__separator" aria-hidden="true"></span>
            <div class="translation-row-text-style-actions__group translation-row-text-style-actions__group--secondary">
              ${secondaryButtons.join("")}
            </div>
          `
          : ""
      }
    </div>
  `;
}

function editorLanguageImageSrc(image) {
  if (!image) {
    return "";
  }

  if (image.kind === "url") {
    return image.url ?? "";
  }

  if (image.kind === "upload") {
    return convertLocalFileSrc(image.filePath ?? "");
  }

  return "";
}

function renderEditorLanguageImage(row, language) {
  if (!language.hasVisibleImage) {
    return "";
  }

  if (language.showInvalidImageUrl === true) {
    return `
      <div class="translation-language-panel__image-shell">
        ${renderInlineStateBox({
          tone: "error",
          message: "Invalid image URL",
        })}
      </div>
    `;
  }

  if (language.isImageUrlEditorOpen === true) {
    return `
      <div
        class="translation-language-panel__field-stack translation-language-panel__field-stack--image-url"
        data-row-id="${escapeHtml(row.id)}"
        data-language-code="${escapeHtml(language.code)}"
      >
        <input
          class="translation-language-panel__field translation-language-panel__image-url-input"
          type="text"
          data-editor-image-url-input
          data-row-id="${escapeHtml(row.id)}"
          data-language-code="${escapeHtml(language.code)}"
          spellcheck="false"
          placeholder="paste image url here"
          value="${escapeHtml(language.imageUrlDraft ?? "")}"
        />
      </div>
    `;
  }

  if (language.isImageUploadEditorOpen === true) {
    return `
      <div class="translation-language-panel__image-shell">
        <button
          class="translation-language-panel__image-upload"
          type="button"
          data-action="open-editor-image-upload-picker"
          data-editor-image-upload-dropzone
          data-row-id="${escapeHtml(row.id)}"
          data-language-code="${escapeHtml(language.code)}"
        >
          <span>Drag and drop an image file or click to select.</span>
        </button>
      </div>
    `;
  }

  const image = language.image;
  const imageSrc = editorLanguageImageSrc(image);
  if (!image || !imageSrc) {
    return "";
  }

  const imageLabel = editorFieldImageMetadataText(image);
  return `
    <div class="translation-language-panel__image-shell">
      <div class="translation-language-panel__image-row">
        <button
          class="translation-language-panel__image-preview"
          type="button"
          data-action="open-editor-image-preview"
          data-row-id="${escapeHtml(row.id)}"
          data-language-code="${escapeHtml(language.code)}"
          ${tooltipAttributes(imageLabel || "Preview image", { side: "top" })}
        >
          <img
            class="translation-language-panel__image"
            data-editor-language-image-preview-img
            data-row-id="${escapeHtml(row.id)}"
            data-language-code="${escapeHtml(language.code)}"
            src="${escapeHtml(imageSrc)}"
            alt=""
            loading="eager"
          />
        </button>
        <button
          class="translation-language-panel__image-remove"
          type="button"
          data-action="remove-editor-language-image"
          data-editor-language-image-remove-button
          data-row-id="${escapeHtml(row.id)}"
          data-language-code="${escapeHtml(language.code)}"
          ${tooltipAttributes("Remove image", { side: "top" })}
        >
          <span aria-hidden="true">x</span>
        </button>
      </div>
    </div>
  `;
}

function renderConflictResolutionField(row, language, textStyle) {
  return `
    <button
      class="translation-language-panel__field-static translation-language-panel__field-static--conflict"
      type="button"
      data-action="open-editor-conflict-resolution:${escapeHtml(row.id)}:${escapeHtml(language.code)}"
      data-row-id="${escapeHtml(row.id)}"
      data-language-code="${escapeHtml(language.code)}"
      data-row-text-style="${escapeHtml(textStyle)}"
    >
      <span
        class="translation-language-panel__field-static-text"
        lang="${escapeHtml(language.code)}"
      >${escapeHtml(language.text)}</span>
    </button>
  `;
}

function renderDisabledConflictField(language, textStyle) {
  return `
    <div
      class="translation-language-panel__field-static translation-language-panel__field-static--disabled"
      data-row-text-style="${escapeHtml(textStyle)}"
      ${tooltipAttributes(
        "This language does not have a conflict. Please edit the languages marked with red text before editing this.",
      )}
    >
      <span
        class="translation-language-panel__field-static-text"
        lang="${escapeHtml(language.code)}"
      >${escapeHtml(language.text)}</span>
    </div>
  `;
}

function renderEditorFootnoteField(row, language) {
  return `
    <div
      class="translation-language-panel__field-stack translation-language-panel__field-stack--footnote"
      data-editor-glossary-field-stack
      data-row-id="${escapeHtml(row.id)}"
      data-language-code="${escapeHtml(language.code)}"
      data-content-kind="footnote"
    >
      <div
        class="translation-language-panel__field-highlight translation-language-panel__search-highlight"
        data-editor-search-highlight
        lang="${escapeHtml(language.code)}"
        aria-hidden="true"
      ></div>
      <div
        class="translation-language-panel__field-highlight translation-language-panel__glossary-highlight"
        data-editor-glossary-highlight
        lang="${escapeHtml(language.code)}"
        aria-hidden="true"
      ></div>
      <textarea
        class="translation-language-panel__field translation-language-panel__field--footnote"
        data-editor-row-field
        data-content-kind="footnote"
        data-row-id="${escapeHtml(row.id)}"
        data-language-code="${escapeHtml(language.code)}"
        lang="${escapeHtml(language.code)}"
        spellcheck="false"
        placeholder="Enter footnote text here."
      >${escapeHtml(language.footnote)}</textarea>
    </div>
  `;
}

function renderEditorLanguageField(row, language) {
  const textStyle = normalizeEditorRowTextStyle(row?.textStyle);
  if (row.hasConflict) {
    return language.hasConflict
      ? renderConflictResolutionField(row, language, textStyle)
      : renderDisabledConflictField(language, textStyle);
  }

  const fieldClassName = `translation-language-panel__field${language.isAiTranslating ? " translation-language-panel__field--loading" : ""}`;
  const loadingAttributes = language.isAiTranslating
    ? ' readonly aria-busy="true"'
    : "";

  return `
    <div
      class="translation-language-panel__editor${language.isActive ? " translation-language-panel__editor--active" : ""}"
      data-editor-language-cluster
      data-row-id="${escapeHtml(row.id)}"
      data-language-code="${escapeHtml(language.code)}"
    >
      <div
        class="translation-language-panel__field-stack"
        data-editor-glossary-field-stack
        data-row-id="${escapeHtml(row.id)}"
        data-language-code="${escapeHtml(language.code)}"
        data-row-text-style="${escapeHtml(textStyle)}"
      >
        <div
          class="translation-language-panel__field-highlight translation-language-panel__search-highlight"
          data-editor-search-highlight
          lang="${escapeHtml(language.code)}"
          aria-hidden="true"
        ></div>
        <div
          class="translation-language-panel__field-highlight translation-language-panel__glossary-highlight"
          data-editor-glossary-highlight
          lang="${escapeHtml(language.code)}"
          aria-hidden="true"
        ></div>
        <textarea
          class="${fieldClassName}"
          data-editor-row-field
          data-row-id="${escapeHtml(row.id)}"
          data-language-code="${escapeHtml(language.code)}"
          lang="${escapeHtml(language.code)}"
          spellcheck="false"
          ${loadingAttributes}
        >${escapeHtml(language.text)}</textarea>
      </div>
      ${language.hasVisibleFootnote ? renderEditorFootnoteField(row, language) : ""}
      ${renderEditorLanguageImage(row, language)}
      ${renderRowTextStyleButtons(row, language)}
    </div>
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

export function renderTranslationContentRow(
  row,
  collapsedLanguageCodes = new Set(),
  rowIndex = null,
  editorReplace = null,
) {
  if (row?.kind === "deleted-group") {
    const rowIndexAttribute = Number.isInteger(rowIndex) ? ` data-row-index="${rowIndex}"` : "";
    return `
      <div class="translation-deleted-group" data-editor-deleted-group data-row-id="${escapeHtml(row.id)}"${rowIndexAttribute}>
        ${sectionSeparator({
          label: row.label || "Deleted rows",
          action: `toggle-editor-deleted-row-group:${row.groupId}`,
          isOpen: row.isOpen === true,
        })}
      </div>
    `;
  }

  const orderedSections = orderRowSectionsByCollapsedState(row.sections, collapsedLanguageCodes);
  const rowIndexAttribute = Number.isInteger(rowIndex) ? ` data-row-index="${rowIndex}"` : "";
  const rowActions = row.lifecycleState === "deleted"
    ? `
      <div class="translation-row__actions">
        ${renderEditorRowConflictActions(row)}
        ${row.canRestore ? textAction("Restore", `restore-editor-row:${row.id}`) : ""}
        ${row.canPermanentDelete ? textAction("Delete", `open-editor-row-permanent-delete:${row.id}`) : ""}
      </div>
    `
    : `
      <div class="translation-row__actions">
        ${renderEditorRowConflictActions(row)}
        ${row.canInsert ? textAction("Insert", `open-insert-editor-row:${row.id}`) : ""}
        ${row.canSoftDelete ? textAction("Delete", `soft-delete-editor-row:${row.id}`) : ""}
      </div>
    `;
  const rowSelection = row.canReplaceSelect
    ? `
      <div class="translation-row__selection">
        <input
          class="translation-row__select"
          type="checkbox"
          data-editor-replace-row-select
          data-row-id="${escapeHtml(row.id)}"
          aria-label="Select row for replace"
          ${row.replaceSelected ? "checked" : ""}
          ${row.replaceSelectionDisabled ? "disabled" : ""}
        />
      </div>
    `
    : '<div class="translation-row__selection" aria-hidden="true"></div>';

  return `
    <div class="translation-row-shell" data-editor-row-card data-row-id="${escapeHtml(row.id)}"${rowIndexAttribute}>
      ${renderEditorRowSyncBadges(row)}
      ${rowActions}
      <div class="translation-row__content">
        ${rowSelection}
        <article class="card card--translation${row.lifecycleState === "deleted" ? " is-deleted" : ""}">
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
                        <span class="translation-language-panel__label${language.hasConflict ? " translation-language-panel__label--conflict" : ""}">${escapeHtml(language.name)}</span>
                      </button>
                      <div class="translation-language-panel__actions">
                        ${renderCommentsMarkerButton(row.id, language)}
                        ${renderLanguageMarkerButton("reviewed", row.id, language)}
                        ${renderLanguageMarkerButton("please-check", row.id, language)}
                      </div>
                    </div>
                    ${
                      isCollapsed
                        ? ""
                        : renderEditorLanguageField(row, language)
                    }
                  </section>
                `;
              })
              .join("")}
            </div>
            ${renderEditorRowContextAction(row)}
          </div>
        </article>
      </div>
    </div>
  `;
}

export function renderTranslationContentRowsRange(
  rows,
  collapsedLanguageCodes = new Set(),
  startIndex = 0,
  endIndex = rows.length,
  editorReplace = null,
) {
  return rows
    .slice(startIndex, endIndex)
    .map((row, offset) =>
      renderTranslationContentRow(row, collapsedLanguageCodes, startIndex + offset, editorReplace)
    )
    .join("");
}

function shouldVirtualizeEditorRows(rows) {
  return Array.isArray(rows) && rows.length >= EDITOR_VIRTUALIZATION_MIN_ROWS;
}

export function renderTranslationContentRows(
  rows,
  collapsedLanguageCodes = new Set(),
  editorFontSizePx = 20,
  editorReplace = null,
) {
  if (!shouldVirtualizeEditorRows(rows)) {
    return renderTranslationContentRowsRange(rows, collapsedLanguageCodes, 0, rows.length, editorReplace);
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
          editorReplace,
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
