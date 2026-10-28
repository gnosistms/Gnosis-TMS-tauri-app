import { setBookRedundancyChoice } from "../project-book-redundancy-flow.js";
import { importBookImage, moveProjectBookItem, updateBookField } from "../project-book-flow.js";
import { escapeHtml } from "../../lib/ui.js";
import { state } from "../state.js";
import { rememberProjectsExportRender } from "../projects-background-render.js";
import { renderSelectedBookPage } from "../../screens/project-book-composer.js";
import { dismissBookChapterMenu, dismissBookChapterMenuOutside, handleBookChapterMenuClick, handleBookChapterMenuKeydown } from "../project-book-chapter-menu.js";
let drag = null;
function cancel() {
  drag?.preview?.remove();
  document.querySelectorAll("[data-book-item].is-dragging, [data-book-item].is-drop-before, [data-book-item].is-drop-after").forEach((row) => row.classList.remove("is-dragging", "is-drop-before", "is-drop-after"));
  drag = null;
}
export function registerProjectBookEvents(render) {
  document.addEventListener("change", (event) => {
    const input = event.target.closest?.("[data-book-redundancy-choice]");
    if (input) setBookRedundancyChoice(input.dataset.bookRedundancyChoice, input.checked);
  });
  document.addEventListener("click", (event) => handleBookChapterMenuClick(event, render));
  document.addEventListener("keydown", handleBookChapterMenuKeydown);
  document.addEventListener("scroll", (event) => dismissBookChapterMenuOutside(event.target), true);
  window.addEventListener("resize", () => dismissBookChapterMenu());
  window.addEventListener("blur", () => dismissBookChapterMenu());
  document.addEventListener("input", (event) => {
    const field = event.target.closest?.("[data-book-field]");
    if (field) updateBookField(field, field.dataset.bookChapterTitle ? () => {
      const preview = document.querySelector(".book-composer__page-scroll");
      if (preview) preview.innerHTML = renderSelectedBookPage(state.editorChapter.exportModal);
    } : render);
    // Field edits patch the mounted DOM directly, without a full/scoped render.
    if (field) rememberProjectsExportRender(document.querySelector("#app"), state);
  });
  document.addEventListener("mousedown", (event) => { if (event.target.closest?.('[data-action^="book-copyright:"]')) event.preventDefault(); });
  document.addEventListener("paste", (event) => {
    const editor = event.target.closest?.("[data-book-copyright-editor]");
    if (!editor) return;
    event.preventDefault();
    const paragraphs = event.clipboardData.getData("text/plain").split(/\r\n?|\n/)
      .map((line) => `<p>${escapeHtml(line).replaceAll("\u2028", "<br>") || "<br>"}</p>`).join("");
    document.execCommand("insertHTML", false, paragraphs);
    updateBookField(editor);
    rememberProjectsExportRender(document.querySelector("#app"), state);
  });
  document.addEventListener("pointerdown", (event) => {
    dismissBookChapterMenuOutside(event.target);
    const settings = event.target.closest?.("[data-book-settings-button]");
    if (settings && event.button === 0) { settings.focus({ preventScroll: true }); return; }
    const chapterRow = event.target.closest?.("[data-book-chapter-select]");
    const control = event.target.closest?.("input, textarea, button");
    // WebKit does not focus clicked buttons. Move focus before a section's
    // full render so it cannot restore the previously edited chapter title.
    const previewButton = event.target.closest?.("[data-book-preview-select], [data-book-section-select]")
      || (!control && chapterRow?.querySelector("[data-book-preview-select]"));
    if (previewButton && event.button === 0) {
      if (!control) event.preventDefault();
      previewButton.focus({ preventScroll: true });
      return;
    }
    const handle = event.target.closest?.("[data-book-drag-handle]");
    if (!handle || event.button !== 0) return;
    const row = handle.closest("[data-book-item]");
    const rect = row.getBoundingClientRect();
    event.preventDefault();
    const preview = row.cloneNode(true);
    preview.classList.add("term-variant-row-preview");
    preview.setAttribute("aria-hidden", "true");
    preview.removeAttribute("data-book-item");
    preview.querySelectorAll("[data-action]").forEach((element) => element.removeAttribute("data-action"));
    preview.style.width = `${rect.width}px`;
    document.body.append(preview);
    drag = { id: row.dataset.bookItem, row, preview, x: event.clientX - rect.left, y: event.clientY - rect.top, pointerId: event.pointerId };
    row.classList.add("is-dragging");
    preview.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
  });
  document.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    drag.preview.style.transform = `translate(${event.clientX - drag.x}px, ${event.clientY - drag.y}px)`;
    document.querySelectorAll("[data-book-item]").forEach((row) => row.classList.remove("is-drop-before", "is-drop-after"));
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-book-item][data-book-included="true"]');
    if (row && row !== drag.row) row.classList.add(event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2 ? "is-drop-after" : "is-drop-before");
  });
  document.addEventListener("pointerup", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-book-item][data-book-included="true"]');
    const id = drag.id;
    const after = row && event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
    const targetId = row?.dataset.bookItem;
    cancel();
    if (targetId) moveProjectBookItem(render, id, targetId, after);
  });
  document.addEventListener("pointercancel", cancel);
  window.addEventListener("blur", cancel);
  for (const name of ["dragover", "dragleave", "drop"]) document.addEventListener(name, (event) => {
    const zone = event.target.closest?.("[data-book-image-dropzone]");
    if (!zone) return;
    event.preventDefault();
    zone.classList.toggle("is-drag-over", name === "dragover");
    if (name === "drop" && event.dataTransfer?.files?.length) void importBookImage(render, event.dataTransfer.files[0]);
  });
}
