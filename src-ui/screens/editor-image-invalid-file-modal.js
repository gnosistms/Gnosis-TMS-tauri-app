import { escapeHtml, primaryButton } from "../lib/ui.js";
import {
  EDITOR_UPLOAD_REFUSAL_TOO_LARGE,
  EDITOR_UPLOAD_REFUSAL_UNSUPPORTED_AUDIO,
  EDITOR_UPLOAD_REFUSAL_VIDEO,
} from "../app/editor-upload-refusal.js";
import { IMPORT_FILE_SIZE_LIMIT_LABEL } from "../app/import-file-limit.js";

// What the modal says, by why the file was refused (see editor-upload-refusal.js).
function editorImageInvalidFileMessage(reason, fileName = "") {
  const name = String(fileName ?? "").trim();
  const quotedName = name ? `'${name}'` : "";
  switch (reason) {
    case EDITOR_UPLOAD_REFUSAL_VIDEO:
      return {
        eyebrow: "Can't upload this file",
        title: "Video files can't be uploaded.",
        supporting: `To add ${quotedName || "a video"}, put it online (on YouTube, Vimeo or VideoPress, or in a WordPress media library) and insert it by URL instead.`,
      };
    case EDITOR_UPLOAD_REFUSAL_UNSUPPORTED_AUDIO:
      return {
        eyebrow: "Can't upload this file",
        title: "This audio format is not supported.",
        supporting: `Audio must be an MP3, M4A or WAV file. Convert ${quotedName || "the recording"} to one of these formats and upload it again.`,
      };
    case EDITOR_UPLOAD_REFUSAL_TOO_LARGE:
      return {
        eyebrow: "Can't upload this file",
        title: "This file is too large.",
        supporting: `${quotedName || "The file"} is larger than the ${IMPORT_FILE_SIZE_LIMIT_LABEL} upload limit. Make it smaller and upload it again, or put it in a WordPress media library and insert it by URL.`,
      };
    default:
      return {
        eyebrow: "Invalid file",
        title: "The file you uploaded is not a valid image or audio file, or could not be opened.",
        supporting: "",
      };
  }
}

export function renderEditorImageInvalidFileModal(state) {
  const modal = state.editorChapter?.imageInvalidFileModal;
  if (!modal?.isOpen) {
    return "";
  }

  const message = editorImageInvalidFileMessage(modal.reason, modal.fileName);
  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="editor-image-invalid-file-modal-title" data-modal-dialog="editor-image-invalid-file" tabindex="-1">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">${escapeHtml(message.eyebrow)}</p>
          <h2 class="modal__title" id="editor-image-invalid-file-modal-title">${escapeHtml(message.title)}</h2>
          ${message.supporting ? `<p class="modal__supporting">${escapeHtml(message.supporting)}</p>` : ""}
          <div class="modal__actions">
            ${primaryButton("Ok", "close-editor-image-invalid-file-modal", {
              modalDefault: true,
              modalCancel: true,
              modalInitialFocus: true,
            })}
          </div>
        </div>
      </section>
    </div>
  `;
}
