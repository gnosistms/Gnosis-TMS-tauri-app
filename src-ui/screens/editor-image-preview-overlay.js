import { escapeHtml } from "../lib/ui.js";

export function renderEditorImagePreviewOverlay(state) {
  const overlay = state.editorChapter?.imagePreviewOverlay;
  const src = typeof overlay?.src === "string" ? overlay.src.trim() : "";
  if (overlay?.isOpen !== true || !src) {
    return "";
  }

  return `
    <div class="editor-image-preview-overlay" data-action="close-editor-image-preview">
      <div class="editor-image-preview-overlay__frame" data-stop-row-action>
        <img class="editor-image-preview-overlay__image" src="${escapeHtml(src)}" alt="" />
      </div>
    </div>
  `;
}
