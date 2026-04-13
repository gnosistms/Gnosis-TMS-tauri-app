export function syncAutoSizeTextarea(textarea, options = {}) {
  if (!(textarea instanceof HTMLTextAreaElement)) {
    return;
  }

  const minHeight = Number.isFinite(options.minHeight) ? options.minHeight : 44;
  const hasMaxHeight = options.maxHeight !== null && options.maxHeight !== undefined;
  const maxHeight = hasMaxHeight
    ? (Number.isFinite(options.maxHeight) ? options.maxHeight : 96)
    : Number.POSITIVE_INFINITY;

  textarea.style.height = "0px";
  const scrollHeight = textarea.scrollHeight;
  const nextHeight = Math.max(minHeight, Math.min(scrollHeight, maxHeight));
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = hasMaxHeight && scrollHeight > maxHeight ? "auto" : "hidden";
  textarea.classList.toggle("is-single-line", scrollHeight <= minHeight + 2);
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
    .querySelectorAll("[data-glossary-term-variant-input]")
    .forEach((element) => syncAutoSizeTextarea(element, { minHeight: 44, maxHeight: 96 }));
}

export function syncEditorRowTextareaHeight(textarea) {
  if (!(textarea instanceof HTMLTextAreaElement)) {
    return;
  }

  const isActive = textarea.matches(":focus");

  syncAutoSizeTextarea(
    textarea,
    isActive
      ? { minHeight: singleLineTextareaHeight(textarea), maxHeight: null }
      : { minHeight: 44, maxHeight: null },
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
