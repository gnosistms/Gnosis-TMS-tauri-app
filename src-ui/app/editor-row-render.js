import {
  escapeHtml,
  renderCollapseChevron,
  sectionSeparator,
  textAction,
  tooltipAttributes,
} from "../lib/ui.js";
import { editorFieldImageMetadataText } from "./editor-images.js";
import { editorImagePreviewFrameSizeForSrc } from "./editor-image-preview-size.js";
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
import {
  renderSanitizedInlineMarkupHtml,
  renderSanitizedInlineMarkupWithEditorHighlightState,
  rubyButtonConfig,
} from "./editor-inline-markup.js";
import {
  buildCachedEditorRowGlossaryHighlights,
  renderableEditorGlossaryHighlightHtml,
} from "./editor-glossary-highlight-cache.js";
import { historyLastUpdateLabel } from "./editor-history.js";
import { buildEditorRowSearchHighlightMap } from "./editor-search-flow.js";
import { buildEditorSearchHighlightKey } from "./editor-search-highlighting.js";

export function renderTranslationMarkerIcon(kind) {
  if (kind === "comments") {
    return `
      <svg class="translation-marker-button__icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <defs>
          <mask id="translation-marker-mask-comments">
            <rect x="0" y="0" width="20" height="20" fill="white"></rect>
            <path d="M10 5.9v5.8" fill="none" stroke="black" stroke-width="2" stroke-linecap="round"></path>
            <circle cx="10" cy="14.1" r="1.05" fill="black"></circle>
          </mask>
        </defs>
        <rect class="translation-marker-button__active-fill" x="2.25" y="2.25" width="15.5" height="15.5" rx="4" fill="currentColor" mask="url(#translation-marker-mask-comments)"></rect>
        <rect class="translation-marker-button__outline" x="2.25" y="2.25" width="15.5" height="15.5" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"></rect>
        <path class="translation-marker-button__glyph" d="M10 5.9v5.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
        <circle class="translation-marker-button__glyph" cx="10" cy="14.1" r="1.05" fill="currentColor"></circle>
      </svg>
    `;
  }

  if (kind === "reviewed") {
    return `
      <svg class="translation-marker-button__icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <defs>
          <mask id="translation-marker-mask-reviewed">
            <rect x="0" y="0" width="20" height="20" fill="white"></rect>
            <path d="M6.2 10.25 8.8 12.85 13.9 7.7" fill="none" stroke="black" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path>
          </mask>
        </defs>
        <rect class="translation-marker-button__active-fill" x="2.25" y="2.25" width="15.5" height="15.5" rx="4" fill="currentColor" mask="url(#translation-marker-mask-reviewed)"></rect>
        <rect class="translation-marker-button__outline" x="2.25" y="2.25" width="15.5" height="15.5" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"></rect>
        <path class="translation-marker-button__glyph" d="M6.2 10.25 8.8 12.85 13.9 7.7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    `;
  }

  return `
    <svg class="translation-marker-button__icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <defs>
        <mask id="translation-marker-mask-please-check">
          <rect x="0" y="0" width="20" height="20" fill="white"></rect>
          <path d="M8 7.3a2.15 2.15 0 1 1 3.76 1.4c-.74.78-1.5 1.22-1.5 2.33" fill="none" stroke="black" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
          <circle cx="10" cy="13.9" r="0.95" fill="black"></circle>
        </mask>
      </defs>
      <rect class="translation-marker-button__active-fill" x="2.25" y="2.25" width="15.5" height="15.5" rx="4" fill="currentColor" mask="url(#translation-marker-mask-please-check)"></rect>
      <rect class="translation-marker-button__outline" x="2.25" y="2.25" width="15.5" height="15.5" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"></rect>
      <path class="translation-marker-button__glyph" d="M8 7.3a2.15 2.15 0 1 1 3.76 1.4c-.74.78-1.5 1.22-1.5 2.33" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
      <circle class="translation-marker-button__glyph" cx="10" cy="13.9" r="0.95" fill="currentColor"></circle>
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
  } else if (row.freshness === "stale") {
    badges.push('<span class="translation-row-badge translation-row-badge--stale">Needs refresh</span>');
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

function renderEditorRowLastUpdate(row) {
  const lastUpdate = row?.lastUpdate;
  if (!lastUpdate || typeof lastUpdate !== "object") {
    return "";
  }

  return `
    <div class="translation-row__last-update">
      Last update: ${escapeHtml(historyLastUpdateLabel(lastUpdate))}
    </div>
  `;
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
  const rubyConfig = rubyButtonConfig(language.code);
  const secondaryButtons = [];
  const inlineButtons = [
    {
      style: "bold",
      label: "b",
      tooltip: "Bold",
    },
    {
      style: "italic",
      label: "i",
      tooltip: "Italic",
    },
    {
      style: "underline",
      label: "u",
      tooltip: "Underline",
    },
    {
      style: "ruby",
      label: rubyConfig.label,
      tooltip: rubyConfig.tooltip,
    },
  ];

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
      <span class="translation-row-text-style-actions__separator" aria-hidden="true"></span>
      <div class="translation-row-text-style-actions__group translation-row-text-style-actions__group--inline" aria-label="Inline formatting">
        ${inlineButtons.map((button) => `
          <button
            class="translation-row-text-style-button translation-row-inline-style-button"
            type="button"
            data-action="toggle-editor-inline-style"
            data-editor-inline-style-button
            data-row-id="${escapeHtml(row.id)}"
            data-language-code="${escapeHtml(language.code)}"
            data-inline-style="${escapeHtml(button.style)}"
            aria-pressed="false"
            ${tooltipAttributes(button.tooltip, { side: "top" })}
          >
            <span class="translation-row-text-style-button__label">${escapeHtml(button.label)}</span>
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
      <span class="translation-row-text-style-actions__hint">Shift + Return to save</span>
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

function editorImagePreviewCachedStyle(size) {
  if (!size) {
    return "";
  }

  const frameWidth = Math.max(1, Number.parseInt(String(size.frameWidth), 10) || 0);
  const frameHeight = Math.max(1, Number.parseInt(String(size.frameHeight), 10) || 0);
  const contentWidth = Math.max(1, Number.parseInt(String(size.contentWidth), 10) || 0);
  const contentHeight = Math.max(1, Number.parseInt(String(size.contentHeight), 10) || 0);
  if (!frameWidth || !frameHeight || !contentWidth || !contentHeight) {
    return "";
  }

  return ` style="--editor-image-preview-width: ${escapeHtml(frameWidth)}px; --editor-image-preview-height: ${escapeHtml(frameHeight)}px; --editor-image-preview-content-width: ${escapeHtml(contentWidth)}px; --editor-image-preview-content-height: ${escapeHtml(contentHeight)}px;"`;
}

function renderEditorLanguageImageCaption(row, language) {
  if (!language.hasVisibleImage) {
    return "";
  }

  if (language.isImageCaptionEditorOpen === true) {
    return `
      <div class="translation-language-panel__image-caption-shell translation-language-panel__image-caption-shell--editing">
        <div
          class="translation-language-panel__field-stack translation-language-panel__field-stack--footnote translation-language-panel__field-stack--image-caption"
          data-row-id="${escapeHtml(row.id)}"
          data-language-code="${escapeHtml(language.code)}"
          data-content-kind="image-caption"
        >
          <textarea
            class="translation-language-panel__field translation-language-panel__image-caption-input"
            data-editor-row-field
            data-editor-image-caption-input
            data-content-kind="image-caption"
            data-row-id="${escapeHtml(row.id)}"
            data-language-code="${escapeHtml(language.code)}"
            lang="${escapeHtml(language.code)}"
            spellcheck="false"
            placeholder="Enter image caption"
          >${escapeHtml(language.imageCaption ?? "")}</textarea>
        </div>
      </div>
    `;
  }

  if (language.showAddImageCaptionButton === true) {
    return `
      <div class="translation-language-panel__image-caption-shell translation-language-panel__image-caption-shell--idle">
        <button
          class="translation-language-panel__image-caption-button"
          type="button"
          data-action="open-editor-image-caption"
          data-editor-image-caption-button
          data-row-id="${escapeHtml(row.id)}"
          data-language-code="${escapeHtml(language.code)}"
          ${tooltipAttributes("Add image caption", { side: "top" })}
        >
          <span>+ caption</span>
        </button>
      </div>
    `;
  }

  if (!language.hasVisibleImageCaption) {
    return "";
  }

  return `
    <div class="translation-language-panel__image-caption-shell translation-language-panel__image-caption-shell--idle translation-language-panel__image-caption-shell--display">
      <button
        class="translation-language-panel__image-caption-display"
        type="button"
        data-action="open-editor-image-caption"
        data-editor-image-caption-button
        data-row-id="${escapeHtml(row.id)}"
        data-language-code="${escapeHtml(language.code)}"
      ><span class="translation-language-panel__image-caption-text" lang="${escapeHtml(language.code)}">${renderSanitizedInlineMarkupHtml(language.imageCaption ?? "")}</span></button>
    </div>
  `;
}

function renderEditorLanguageImage(row, language) {
  if (!language.hasVisibleImage) {
    return "";
  }

  if (language.isImageUrlSubmitting === true) {
    return `
      <div class="translation-language-panel__image-shell">
        <button
          class="translation-language-panel__image-message-button message-box message-box--warning"
          type="button"
          data-action="open-editor-image-url"
          data-editor-image-url-status-button
          data-row-id="${escapeHtml(row.id)}"
          data-language-code="${escapeHtml(language.code)}"
          aria-busy="true"
        >
          <span class="message-box__text">Loading image...</span>
        </button>
      </div>
    `;
  }

  if (language.showInvalidImageUrl === true) {
    return `
      <div class="translation-language-panel__image-shell">
        <button
          class="translation-language-panel__image-message-button message-box message-box--error"
          type="button"
          data-action="open-editor-image-url"
          data-editor-image-url-status-button
          data-row-id="${escapeHtml(row.id)}"
          data-language-code="${escapeHtml(language.code)}"
        >
          <span class="message-box__text">${escapeHtml(language.imageUrlErrorMessage || "The image URL could not be used.")}</span>
        </button>
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
        <button
          class="translation-language-panel__image-remove translation-language-panel__image-url-close"
          type="button"
          data-action="close-editor-image-url"
          data-editor-image-url-close-button
          data-row-id="${escapeHtml(row.id)}"
          data-language-code="${escapeHtml(language.code)}"
          ${tooltipAttributes("Close image URL", { side: "top" })}
        >
          <span class="translation-language-panel__image-remove-icon" aria-hidden="true">
            <svg viewBox="0 0 12 12" focusable="false" aria-hidden="true">
              <path d="M2 2 10 10" />
              <path d="M10 2 2 10" />
            </svg>
          </span>
        </button>
      </div>
    `;
  }

  if (language.isImageUploadEditorOpen === true) {
    return `
      <div class="translation-language-panel__image-shell">
        <div class="translation-language-panel__image-upload-shell">
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
          <button
            class="translation-language-panel__image-remove translation-language-panel__image-upload-close"
            type="button"
            data-action="close-editor-image-upload"
            data-editor-image-upload-close-button
            data-row-id="${escapeHtml(row.id)}"
            data-language-code="${escapeHtml(language.code)}"
            ${tooltipAttributes("Close image upload", { side: "top" })}
          >
            <span class="translation-language-panel__image-remove-icon" aria-hidden="true">
              <svg viewBox="0 0 12 12" focusable="false" aria-hidden="true">
                <path d="M2 2 10 10" />
                <path d="M10 2 2 10" />
              </svg>
            </span>
          </button>
        </div>
      </div>
    `;
  }

  const image = language.image;
  const imageSrc = editorLanguageImageSrc(image);
  if (!image || !imageSrc) {
    return "";
  }

  const imageLabel = editorFieldImageMetadataText(image);
  const cachedPreviewSize = editorImagePreviewFrameSizeForSrc(imageSrc);
  const isLoading = !cachedPreviewSize;
  return `
    <div class="translation-language-panel__image-shell">
      <div class="translation-language-panel__image-row">
        <button
          class="translation-language-panel__image-preview${isLoading ? " is-loading" : ""}"
          type="button"
          data-action="open-editor-image-preview"
          data-row-id="${escapeHtml(row.id)}"
          data-language-code="${escapeHtml(language.code)}"
          ${isLoading ? 'aria-busy="true"' : ""}
          ${editorImagePreviewCachedStyle(cachedPreviewSize)}
          ${tooltipAttributes(imageLabel || "Preview image", { side: "top", align: "start" })}
        >
          <img
            class="translation-language-panel__image"
            data-editor-language-image-preview-img
            data-row-id="${escapeHtml(row.id)}"
            data-language-code="${escapeHtml(language.code)}"
            src="${escapeHtml(imageSrc)}"
            alt=""
            loading="eager"
            referrerpolicy="no-referrer"
          />
          <span
            class="translation-language-panel__image-loading-placeholder"
            data-editor-image-loading-placeholder
          >Loading image...</span>
        </button>
        ${renderEditorLanguageImageCaption(row, language)}
        <button
          class="translation-language-panel__image-remove"
          type="button"
          data-action="remove-editor-language-image"
          data-editor-language-image-remove-button
          data-row-id="${escapeHtml(row.id)}"
          data-language-code="${escapeHtml(language.code)}"
          ${tooltipAttributes("Remove image", { side: "top" })}
        >
          <span class="translation-language-panel__image-remove-icon" aria-hidden="true">
            <svg viewBox="0 0 12 12" focusable="false" aria-hidden="true">
              <path d="M2 2 10 10" />
              <path d="M10 2 2 10" />
            </svg>
          </span>
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
      >${renderSanitizedInlineMarkupHtml(language.text)}</span>
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
      >${renderSanitizedInlineMarkupHtml(language.text)}</span>
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
  const glossaryHighlightHtml =
    language.isAiTranslating === true
      ? ""
      : typeof language.glossaryHighlightHtml === "string"
        ? language.glossaryHighlightHtml
        : "";
  const staticFieldTextHtml = renderSanitizedInlineMarkupWithEditorHighlightState(language.text, {
    glossaryHighlightHtml,
    searchRanges: Array.isArray(language.searchHighlightRanges) ? language.searchHighlightRanges : [],
  });
  const staticFieldStackClassName =
    "translation-language-panel__field-stack translation-language-panel__field-stack--static";
  if (row.hasConflict) {
    return language.hasConflict
      ? renderConflictResolutionField(row, language, textStyle)
      : renderDisabledConflictField(language, textStyle);
  }

  if (language.isTextEditorOpen !== true) {
    const editorClassName =
      `translation-language-panel__editor`
      + `${language.isImageUrlEditorOpen === true || language.isImageUploadEditorOpen === true ? " translation-language-panel__editor--show-actions" : ""}`;
    const staticFieldClassName =
      `translation-language-panel__field-static`
      + `${language.isAiTranslating ? " translation-language-panel__field-static--loading" : ""}`;
    const staticFieldMarkup = language.isAiTranslating
      ? `
          <div
            class="${staticFieldClassName}"
            data-row-id="${escapeHtml(row.id)}"
            data-language-code="${escapeHtml(language.code)}"
            data-row-text-style="${escapeHtml(textStyle)}"
            lang="${escapeHtml(language.code)}"
            aria-busy="true"
          ><span
            class="translation-language-panel__field-static-text"
            data-editor-display-text
          >${staticFieldTextHtml}</span></div>
        `
      : `
          <button
            class="${staticFieldClassName} translation-language-panel__field-static--editable"
            type="button"
            data-editor-display-field
            data-row-id="${escapeHtml(row.id)}"
            data-language-code="${escapeHtml(language.code)}"
            data-row-text-style="${escapeHtml(textStyle)}"
            lang="${escapeHtml(language.code)}"
          ><span
            class="translation-language-panel__field-static-text"
            data-editor-display-text
          >${staticFieldTextHtml}</span></button>
        `;
    return `
      <div
        class="${editorClassName}"
        data-editor-language-cluster
        data-row-id="${escapeHtml(row.id)}"
        data-language-code="${escapeHtml(language.code)}"
      >
      <div
        class="${staticFieldStackClassName}"
        data-editor-glossary-field-stack
        data-row-id="${escapeHtml(row.id)}"
        data-language-code="${escapeHtml(language.code)}"
        data-row-text-style="${escapeHtml(textStyle)}"
        data-ai-translating="${language.isAiTranslating ? "true" : "false"}"
      >
          ${staticFieldMarkup}
        </div>
        ${language.hasVisibleFootnote ? renderEditorFootnoteField(row, language) : ""}
        ${renderEditorLanguageImage(row, language)}
        ${renderRowTextStyleButtons(row, language)}
      </div>
    `;
  }

  const fieldClassName = `translation-language-panel__field${language.isAiTranslating ? " translation-language-panel__field--loading" : ""}`;
  const loadingAttributes = language.isAiTranslating
    ? ' readonly aria-busy="true"'
    : "";
  const editingFieldStackClassName = "translation-language-panel__field-stack";
  const editorClassName =
    `translation-language-panel__editor`
    + `${language.isTextEditorOpen ? " translation-language-panel__editor--active" : ""}`
    + `${language.isImageUrlEditorOpen === true || language.isImageUploadEditorOpen === true ? " translation-language-panel__editor--show-actions" : ""}`;

  return `
    <div
      class="${editorClassName}"
      data-editor-language-cluster
      data-row-id="${escapeHtml(row.id)}"
      data-language-code="${escapeHtml(language.code)}"
    >
      <div
        class="${editingFieldStackClassName}"
        data-editor-glossary-field-stack
        data-row-id="${escapeHtml(row.id)}"
        data-language-code="${escapeHtml(language.code)}"
        data-row-text-style="${escapeHtml(textStyle)}"
        data-ai-translating="${language.isAiTranslating ? "true" : "false"}"
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
  chapterState = null,
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
  const glossaryHighlightMap = row?.kind === "row"
    ? buildCachedEditorRowGlossaryHighlights(row, chapterState)
    : new Map();
  const searchHighlightMap = row?.kind === "row"
    ? buildEditorRowSearchHighlightMap(row, chapterState)
    : new Map();
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
      <div class="translation-row__toolbar">
        ${renderEditorRowLastUpdate(row)}
        ${rowActions}
      </div>
      ${renderEditorRowSyncBadges(row)}
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
                        : renderEditorLanguageField(row, {
                          ...language,
                          glossaryHighlightHtml: renderableEditorGlossaryHighlightHtml(
                            glossaryHighlightMap.get(language.code) ?? null,
                          ),
                          searchHighlightRanges:
                            searchHighlightMap.get(buildEditorSearchHighlightKey(language.code, "field"))?.ranges
                            ?? [],
                        })
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
  chapterState = null,
) {
  return rows
    .slice(startIndex, endIndex)
    .map((row, offset) =>
      renderTranslationContentRow(
        row,
        collapsedLanguageCodes,
        startIndex + offset,
        editorReplace,
        chapterState,
      )
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
  chapterState = null,
) {
  if (!shouldVirtualizeEditorRows(rows)) {
    return renderTranslationContentRowsRange(
      rows,
      collapsedLanguageCodes,
      0,
      rows.length,
      editorReplace,
      chapterState,
    );
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
          chapterState,
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
