export function syncAutoSizeTextarea(textarea, options = {}) {
  if (!(textarea instanceof HTMLTextAreaElement)) {
    return;
  }

  const minHeight = Number.isFinite(options.minHeight) ? options.minHeight : 44;
  const hasMaxHeight = options.maxHeight !== null && options.maxHeight !== undefined;
  const maxHeight = hasMaxHeight
    ? (Number.isFinite(options.maxHeight) ? options.maxHeight : 96)
    : Number.POSITIVE_INFINITY;
  const scrollContainer =
    options.preserveScroll === true && typeof textarea.closest === "function"
      ? textarea.closest(".translate-main-scroll")
      : null;
  const scrollTop =
    scrollContainer && Number.isFinite(scrollContainer.scrollTop)
      ? scrollContainer.scrollTop
      : null;

  textarea.style.height = "auto";
  const scrollHeight = textarea.scrollHeight;
  const nextHeight = Math.max(minHeight, Math.min(scrollHeight, maxHeight));
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = hasMaxHeight && scrollHeight > maxHeight ? "auto" : "hidden";
  textarea.classList.toggle("is-single-line", scrollHeight <= minHeight + 2);
  if (scrollTop !== null && Number.isFinite(scrollContainer.scrollTop)) {
    scrollContainer.scrollTop = scrollTop;
  }
}

function parsePixelValue(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function singleLineTextareaHeight(textarea, fallback = 56) {
  if (!(textarea instanceof HTMLTextAreaElement) || typeof window === "undefined") {
    return fallback;
  }

  const computedStyle = window.getComputedStyle(textarea);
  const fontSize = parsePixelValue(computedStyle.fontSize, 16);
  const lineHeight = parsePixelValue(computedStyle.lineHeight, fontSize * 1.5);
  const paddingTop = parsePixelValue(computedStyle.paddingTop);
  const paddingBottom = parsePixelValue(computedStyle.paddingBottom);
  const borderTop = parsePixelValue(computedStyle.borderTopWidth);
  const borderBottom = parsePixelValue(computedStyle.borderBottomWidth);

  return Math.ceil(lineHeight + paddingTop + paddingBottom + borderTop + borderBottom);
}

export function syncGlossaryVariantTextareaHeights(root = document) {
  root
    .querySelectorAll("[data-glossary-term-variant-input], [data-glossary-term-variant-note-input]")
    .forEach((element) => syncAutoSizeTextarea(element, {
      minHeight: 44,
      maxHeight: element.matches("[data-glossary-term-variant-note-input]") ? 132 : 96,
    }));
}

export function syncEditorRowTextareaHeight(textarea) {
  if (!(textarea instanceof HTMLTextAreaElement)) {
    return;
  }

  const isActive = textarea.matches(":focus");
  const minHeight = singleLineTextareaHeight(textarea, 44);

  syncAutoSizeTextarea(
    textarea,
    isActive
      ? { minHeight, maxHeight: null, preserveScroll: true }
      : { minHeight, maxHeight: null },
  );
}

export function syncEditorRowTextareaHeights(root = document) {
  root
    .querySelectorAll("[data-editor-row-field]")
    .forEach((element) => syncEditorRowTextareaHeight(element));
}

export function syncEditorCommentDraftTextareaHeights(root = document) {
  root
    .querySelectorAll("[data-editor-comment-draft]")
    .forEach((element) => syncAutoSizeTextarea(element, { minHeight: 88, maxHeight: 220 }));
}

export function syncEditorConflictResolutionTextareaHeight(textarea) {
  if (!(textarea instanceof HTMLTextAreaElement)) {
    return;
  }

  syncAutoSizeTextarea(textarea, {
    minHeight: singleLineTextareaHeight(textarea, 44),
    maxHeight: null,
  });
}

export function syncEditorConflictResolutionTextareaHeights(root = document) {
  root
    .querySelectorAll(
      [
        "[data-editor-conflict-final-input]",
        "[data-editor-conflict-final-footnote-input]",
        "[data-editor-conflict-final-image-caption-input]",
        "[data-editor-conflict-final-image-input]",
      ].join(", "),
    )
    .forEach((element) => syncEditorConflictResolutionTextareaHeight(element));
}

export function syncEditorAssistantDraftTextareaHeights(root = document) {
  root
    .querySelectorAll("[data-editor-assistant-draft]")
    .forEach((element) => syncAutoSizeTextarea(element, { minHeight: 71, maxHeight: 213 }));
}
