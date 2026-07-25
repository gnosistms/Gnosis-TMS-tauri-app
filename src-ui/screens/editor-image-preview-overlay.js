import { escapeHtml } from "../lib/ui.js";

export function renderEditorImagePreviewOverlay(state) {
  const overlay = state.editorChapter?.imagePreviewOverlay;
  const src = typeof overlay?.src === "string" ? overlay.src.trim() : "";
  const imageUrl = typeof overlay?.imageUrl === "string" ? overlay.imageUrl.trim() : "";
  if (overlay?.isOpen !== true || !src) {
    return "";
  }

  return `
    <div class="editor-image-preview-overlay" data-action="close-editor-image-preview">
      <div class="editor-image-preview-overlay__frame" data-stop-row-action>
        <img
          class="editor-image-preview-overlay__image"
          data-editor-image-context-menu-target
          data-row-id="${escapeHtml(overlay.rowId ?? "")}"
          data-language-code="${escapeHtml(overlay.languageCode ?? "")}"
          ${imageUrl ? `data-image-url="${escapeHtml(imageUrl)}"` : ""}
          src="${escapeHtml(src)}"
          alt=""
          tabindex="0"
        />
      </div>
    </div>
  `;
}
