export function syncAutoSizeTextarea(textarea, options = {}) {
  if (!(textarea instanceof HTMLTextAreaElement)) {
    return;
  }

  const minHeight = Number.isFinite(options.minHeight) ? options.minHeight : 44;
  const maxHeight = Number.isFinite(options.maxHeight) ? options.maxHeight : 96;

  textarea.style.height = "0px";
  const scrollHeight = textarea.scrollHeight;
  const nextHeight = Math.max(minHeight, Math.min(scrollHeight, maxHeight));
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = scrollHeight > maxHeight ? "auto" : "hidden";
  textarea.classList.toggle("is-single-line", scrollHeight <= minHeight + 2);
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

  syncAutoSizeTextarea(
    textarea,
    textarea.matches(":focus") || textarea.classList.contains("is-active-selection")
      ? { minHeight: 116, maxHeight: 320 }
      : { minHeight: 44, maxHeight: 160 },
  );
}

export function syncEditorRowTextareaHeights(root = document) {
  root
    .querySelectorAll("[data-editor-row-field]")
    .forEach((element) => syncEditorRowTextareaHeight(element));
}
