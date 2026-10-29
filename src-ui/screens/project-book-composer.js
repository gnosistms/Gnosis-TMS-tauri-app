import { extractVellumLeadingHeadingTitle } from "../app/vellum-text-editor-content.js";
import { escapeHtml, loadingSpinner, primaryButton, secondaryButton, tooltipAttributes, renderChevronIcon } from "../lib/ui.js";
import { renderExportSelect } from "./export-fields.js";
import { BOOK_SECTION_TYPES, bookChapterPreviewBlocks, bookChapterNumbers, bookItemIncluded, bookItemTitle, bookSectionLabel } from "../app/project-book-model.js";
import { bookPaperStyle } from "../app/project-book-paper.js";
import { bookImageSrc } from "../app/project-book-flow.js";
import { renderBookChapterPages } from "../app/project-book-chapter-preview.js";
import { convertLocalFileSrc } from "../app/runtime.js";
import { DEFAULT_PDF_PAPER_SIZE, PDF_PAPER_SIZES } from "../app/editor-export-options.js";
import { renderBookTextHtml } from "../app/project-book-text.js";
import flourish from "../../src-tauri/src/project_import/chapter_editor/chapter_flourish.svg?raw";

export function bookNavButton(direction, disabled = false) {
  const previous = direction === "previous";
  return `<button class="button ${previous ? "button--secondary" : "button--primary"} book-nav ${previous ? "book-nav--previous" : ""}" type="button" data-action="book-${direction}" ${disabled ? "disabled" : ""} ${previous ? "" : "data-modal-default"}>
    ${previous ? renderChevronIcon("left") : ""}
    ${previous ? "Previous" : "Next"}
    ${previous ? "" : renderChevronIcon("right")}
  </button>`;
}

function itemRow(item, modal, numbers) {
  const label = item.kind === "title" ? bookSectionLabel("title") : bookItemTitle(item);
  const included = bookItemIncluded(item);
  const number = numbers.get(item.id);
  const language = modal.languages.find((entry) => entry.code === modal.languageCode);
  const help = included ? "Exclude this from the export." : "Include this in the export.";
  const unavailable = !included && item.available === false
    ? `disabled aria-disabled="true" aria-description="${escapeHtml(`This chapter does not contain a translation in ${language?.name || modal.languageCode}.`)}"` : "";
  return `<li class="term-variant-row book-item ${modal.book.selectedItemId === item.id ? "is-selected" : ""}" data-book-item="${escapeHtml(item.id)}" data-book-included="${included}">
    <div class="term-variant-row__shell" ${item.kind === "chapter" ? `data-book-chapter-select data-action="book-select:${escapeHtml(item.id)}"` : ""}>
      ${included ? `<button type="button" class="term-variant-row__drag-handle" data-book-drag-handle data-stop-row-action aria-label="Reorder ${escapeHtml(label)}" ${tooltipAttributes("Drag to change the export order.")}><span class="term-variant-row__drag-dots" aria-hidden="true">${"<span></span>".repeat(6)}</span></button>` : '<span class="term-variant-row__drag-spacer"></span>'}
      ${item.kind === "chapter" ? `<div class="book-item__chapter-select"><span class="book-item__chapter-number" data-book-chapter-number ${number ? `aria-label="Chapter ${number}"` : "hidden"}>${number ? `${number}.` : ""}</span><span class="book-item__title-wrap"><span class="book-item__title-size" data-book-title-size aria-hidden="true">${escapeHtml(item.title || item.defaultTitle || item.name)}</span><textarea rows="1" wrap="soft" class="book-item__select book-item__title" data-book-chapter-title="${escapeHtml(item.id)}" data-book-field="title" data-modal-enter-blur data-modal-enter-ignores-default aria-label="Chapter title: ${escapeHtml(item.name)}" ${tooltipAttributes("Edit the chapter title for this export language.")} placeholder="${escapeHtml(item.defaultTitle || item.name)}">${escapeHtml(item.title ?? bookItemTitle(item))}</textarea>
        </span><button type="button" class="book-item__preview-select" data-book-preview-select ${modal.book.selectedItemId === item.id ? "data-modal-initial-focus" : ""} aria-label="Preview chapter: ${escapeHtml(item.name)}" aria-pressed="${modal.book.selectedItemId === item.id}"></button></div>` : `<button type="button" class="book-item__select" data-book-section-select ${modal.book.selectedItemId === item.id ? "data-modal-initial-focus" : ""} data-action="book-select:${escapeHtml(item.id)}" aria-pressed="${modal.book.selectedItemId === item.id}">
        <span data-book-item-label="${escapeHtml(item.id)}">${escapeHtml(label)}</span>
        ${!["title", "contents"].includes(item.kind) && bookItemTitle(item) !== bookSectionLabel(item.kind) ? `<small>${escapeHtml(bookSectionLabel(item.kind))}</small>` : ""}
      </button>`}
      <div class="book-item__actions">
      ${item.kind === "chapter" ? `<span ${tooltipAttributes("Settings", { align: "end" })}><button type="button" class="term-variant-row__action-button book-item__settings" data-stop-row-action data-book-settings-button="${escapeHtml(item.id)}" aria-label="Settings" aria-haspopup="menu" aria-expanded="false"><svg class="book-item__settings-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 3 .5-2h4l.5 2 2 .8 1.8-1 2.8 2.8-1 1.8.9 2.1 2 .5v4l-2 .5-.8 2 1 1.8-2.8 2.8-1.8-1-2.1.9-.5 2h-4l-.5-2-2-.8-1.8 1-2.8-2.8 1-1.8-.9-2.1-2-.5v-4l2-.5.8-2-1-1.8 2.8-2.8 1.8 1z"/><circle cx="12" cy="12" r="3"/></svg></button></span>` : ""}
      <span ${tooltipAttributes(help, { align: "end" })}><button type="button" class="${included ? "term-variant-row__action-button term-variant-row__action-button--remove" : "term-lane__add-button"} book-item__toggle" aria-label="${help}" data-action="book-${included ? "exclude" : "include"}:${escapeHtml(item.id)}" ${unavailable}><span class="${included ? "term-variant-row__remove-icon" : "term-lane__add-icon"}" aria-hidden="true"></span></button></span>
      </div>
    </div>
  </li>`;
}

function field(name, value, placeholder, className = "") {
  return `<div class="book-page__input ${className}" contenteditable="plaintext-only" role="textbox" aria-multiline="true" data-book-field="${name}" data-book-empty="${!value}" aria-label="${placeholder}" data-placeholder="${placeholder}">${escapeHtml(value || "").replaceAll("\n", "<br>")}</div>`;
}
function titleInfoField(name, value, label, multiline = false) {
  const attributes = `data-book-field="${name}" aria-label="${label}" placeholder="Enter ${label.toLowerCase()}"`;
  return `<label class="field book-proof-editor__field"><span class="field__label">${label}</span>${multiline
    ? `<textarea class="field__textarea" rows="3" ${attributes}>${escapeHtml(value || "")}</textarea>`
    : `<input class="field__input" type="text" ${attributes} value="${escapeHtml(value || "")}" data-modal-enter-ignores-default />`}</label>`;
}

// Title and contents pages preview the actual typeset PDF page.
export function renderBookPageProof(modal) {
  const preview = modal.book.pagePreview;
  const item = modal.book.items.find((entry) => entry.id === modal.book.selectedItemId);
  const current = Boolean(item) && preview?.itemId === item.id;
  const pages = current ? preview.pages || [] : [];
  const error = current ? preview.error : "";
  const ready = current && preview.status === "ready";
  const name = item?.kind === "contents" ? "Table of contents" : "Title page";
  const paper = PDF_PAPER_SIZES.find((entry) => entry.value === modal.pdfPaperSize)
    || PDF_PAPER_SIZES.find((entry) => entry.value === DEFAULT_PDF_PAPER_SIZE);
  const rendering = `${loadingSpinner({ key: "book-page-proof", label: "Rendering" })}<span>Rendering…</span>`;
  const status = error ? escapeHtml(error) : ready ? "PDF preview" : pages.length ? rendering : "";
  return `<div class="book-proof" data-book-page-proof aria-busy="${!ready && !error}">
    <p class="book-proof__status ${error ? "modal__error" : ""}" role="status">${status}</p>
    ${error ? '<button type="button" class="button button--secondary" data-action="book-page-preview-retry">Retry preview</button>' : ""}
    ${!error && !pages.length ? `<div class="book-proof__pending" style="aspect-ratio: ${paper.widthMm} / ${paper.heightMm}">${rendering}</div>` : ""}
    ${pages.map((src, index) => `<img class="book-proof__page" src="${escapeHtml(src)}" alt="${name} PDF preview${pages.length > 1 ? ` · page ${index + 1}` : ""}" />`).join("")}
    ${pages.length > 1 && item?.kind === "title" ? '<p class="modal__supporting">This title page spans multiple pages. Shorten the text if you want it to fit on one page.</p>' : ""}
  </div>`;
}

function proofLayout(modal, kind, name, fields) {
  return `<div class="book-proof-layout book-page--${kind}">
    <section class="book-proof-editor" aria-label="${name} details">
      <h3>${name}</h3>
      ${fields}
    </section>
    <section class="book-proof-preview" aria-label="${name} PDF preview">
      <div class="book-proof-preview__output">${renderBookPageProof(modal)}</div>
    </section>
  </div>`;
}

function titlePageEditor(modal, item) {
  return proofLayout(modal, "title", "Title page", `${titleInfoField("title", item.title, "Title", true)}
      ${titleInfoField("subtitle", item.subtitle, "Subtitle")}
      ${titleInfoField("author", item.author, "Author")}
      ${titleInfoField("translator", item.translator, "Translator")}
      <div class="book-proof-editor__logo"><span class="field__label">Publisher logo</span>${imageEditor(item, true)}</div>`);
}

function contentsPageEditor(modal, item) {
  return proofLayout(modal, "contents", "Table of contents", `${titleInfoField("title", item.title, "Title")}
      <label class="book-proof-editor__check"><input type="checkbox" data-book-field="includeH1Headings" ${item.includeH1Headings ? "checked" : ""}> Include H1 headings</label>
      <p class="modal__supporting">Page numbers are estimated from the text without images. The exported PDF has the exact numbers.</p>`);
}
function imageEditor(item, logo = false) {
  const src = bookImageSrc(item.image);
  return `<div class="book-image ${logo ? "book-image--logo" : ""}" data-book-image-dropzone>
    ${src ? `<img src="${escapeHtml(src)}" alt="${logo ? "Publisher logo" : "Full page image"}" />
      <button type="button" class="translation-language-panel__image-remove" data-action="book-image-remove" aria-label="Remove image" ${tooltipAttributes("Remove image")}><span class="translation-language-panel__image-remove-icon"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2 10 10"/><path d="M10 2 2 10"/></svg></span></button>`
      : `<button type="button" class="book-image__target" data-action="book-image-pick">+ ${logo ? "Publisher Logo" : "Add image"}<small>Drop an image or click to choose</small></button>`}
  </div>`;
}
export function renderSelectedBookPage(modal) {
  const { book } = modal;
  const paper = (kind, html) => `<div class="book-paper" style="${escapeHtml(bookPaperStyle(modal, kind))}">${html}</div>`;
  const item = book.items.find((entry) => entry.id === book.selectedItemId);
  if (!item) return '<p class="modal__supporting">Select an item to preview it.</p>';
  if (item.kind === "chapter") {
    if (book.previewStatus === "error") return `<p class="modal__error">${escapeHtml(book.previewError)}</p>`;
    if (book.previewChapterId !== item.chapterId || book.previewStatus === "loading") return '<p class="modal__supporting" role="status">Loading chapter preview…</p>';
    if (item.available === false) return '<p class="modal__supporting">This chapter is not available in the selected language.</p>';
    const blocks = bookChapterPreviewBlocks(item, book.previewBlocks, modal.languageCode);
    const title = extractVellumLeadingHeadingTitle(blocks);
    const bodyBlocks = title ? blocks.slice(1) : blocks;
    const number = bookChapterNumbers(book.items).get(item.id);
    const pages = renderBookChapterPages(bodyBlocks, modal, (image) => image.kind === "url" ? image.url : convertLocalFileSrc(image.filePath || ""));
    const header = `<header class="book-chapter__header">${number ? `<span class="book-chapter__number">${number}</span>` : ""}<h1>${escapeHtml(title || bookItemTitle(item))}</h1>${flourish}</header>`;
    return pages.map((html, index) => paper("chapter", `<article class="book-page book-page--chapter translate-preview" aria-label="${index ? "Chapter preview, continued" : "Chapter preview"}" lang="${escapeHtml(modal.languageCode || "en")}">${index ? "" : header}${html}</article>`)).join("");
  }
  if (item.kind === "title") return titlePageEditor(modal, item);
  if (item.kind === "contents") return contentsPageEditor(modal, item);
  let body = "";

  if (item.kind === "image") body = `${imageEditor(item)}${field("caption", item.caption, "Enter image caption.", "book-page__caption")}`;
  if (["copyright", "dedication"].includes(item.kind)) body = `<div class="book-copyright__editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="${item.kind === "copyright" ? "Copyright text" : "Dedication text"}" data-book-copyright-editor data-book-empty="${!item.text}" data-book-field="text" data-placeholder="${item.kind === "copyright" ? "Enter copyright text." : "Enter dedication here."}">${renderBookTextHtml(item.text)}</div>`;
  return paper(item.kind, `<article class="book-page book-page--${item.kind}" aria-label="${escapeHtml(bookSectionLabel(item.kind))}" style="--book-flourish: url('data:image/svg+xml,${encodeURIComponent(flourish)}')">${body}</article>`);
}

function formattingToolbar(modal) {
  const item = modal.book.items.find((entry) => entry.id === modal.book.selectedItemId);
  if (!["copyright", "dedication"].includes(item?.kind)) return "";
  return `<div class="book-copyright__toolbar" role="toolbar" aria-label="${item.kind === "copyright" ? "Copyright" : "Dedication"} formatting"><button type="button" class="text-action" data-action="book-copyright:italic" aria-label="Italicise selected text" ${tooltipAttributes("Italicise selected text")}><svg class="book-copyright__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4h9M5 20h9M15 4 9 20"/></svg></button><button type="button" class="text-action" data-action="book-copyright:symbol" aria-label="Insert copyright symbol" ${tooltipAttributes("Insert copyright symbol")}><svg class="book-copyright__icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15 9a4.25 4.25 0 1 0 0 6"/></svg></button><button type="button" class="text-action book-copyright__flourish" data-action="book-copyright:flourish" aria-label="Insert separator" ${tooltipAttributes("Insert separator")}>${flourish}</button></div>`;
}

export function renderProjectBookItems(modal) {
  const included = modal.book.items.filter(bookItemIncluded);
  const numbers = bookChapterNumbers(modal.book.items);
  const excluded = modal.book.items.filter((item) => !bookItemIncluded(item)).sort((a, b) => bookItemTitle(a).localeCompare(bookItemTitle(b), undefined, { numeric: true, sensitivity: "base" }));
  return `<h3>Included <span data-book-count="included">${included.length}</span></h3><ul data-book-list="included">${included.map((item) => itemRow(item, modal, numbers)).join("")}</ul>
    <p class="modal__supporting" data-book-empty-hint ${included.length ? "hidden" : ""}>Include an item to continue.</p>
    <h3 class="book-excluded-heading" ${excluded.length ? "" : "hidden"}>Excluded <span data-book-count="excluded">${excluded.length}</span></h3><ul data-book-list="excluded" ${excluded.length ? "" : "hidden"}>${excluded.map((item) => itemRow(item, modal, numbers)).join("")}</ul>`;
}

export function renderBookPreviewFontStatus(modal) {
  const fonts = modal.book.previewFonts;
  return `<div class="book-preview-font-status" data-book-font-status role="status">${fonts?.status === "loading" ? "Preparing preview fonts…" : fonts?.status === "error" ? `${escapeHtml(fonts.error)} <button type="button" class="text-action" data-action="book-fonts-retry">Retry preview fonts</button>` : ""}</div>`;
}

export function renderBookSettingsNotice(modal) {
  if (!modal.book?.settingsNotice) return "";
  return `<div class="modal-backdrop"><section class="card modal-card modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="book-settings-notice-title" data-modal-dialog="book-settings-remote" tabindex="-1"><div class="card__body modal-card__body">
    <h2 class="modal__title" id="book-settings-notice-title">Settings loaded</h2>
    <p>Someone has saved an export configuration for this project on GitHub. We have loaded the saved settings for you.</p>
    <div class="modal__actions">${primaryButton("Ok", "book-settings-ok", { modalDefault: true, modalCancel: true, modalInitialFocus: true })}</div>
  </div></section></div>`;
}

export function renderProjectBookComposer(modal) {
  const included = modal.book.items.filter(bookItemIncluded);
  return `<div class="modal-backdrop"><section class="card modal-card modal-card--editor-export modal-card--book" role="dialog" aria-modal="true" aria-labelledby="editor-export-modal-title" data-modal-dialog="editor-export" tabindex="-1">
    <div class="card__body modal-card__body modal-card__body--editor-export">
      <header class="editor-export-modal__header"><div><h2 class="modal__title" id="editor-export-modal-title">Export project</h2><p class="book-step">1 of 2 · Arrange your book</p></div><div class="book-composer__header-actions">${secondaryButton("Cancel", "close-editor-export-options", { modalCancel: true })}${bookNavButton("next", !included.length)}</div></header>
      <div class="book-composer__toolbar">${renderExportSelect({ id: "editor-export-language", label: "Export language", selectAttributes: { "data-editor-export-language-select": true }, options: modal.languages.map((language) => ({ value: language.code, label: `${language.name || language.code} (${language.code})` })), value: modal.languageCode })}
        ${renderExportSelect({ id: "editor-export-paper-size", label: "Paper size", selectAttributes: { "data-editor-export-paper-size-select": true }, options: PDF_PAPER_SIZES, value: modal.pdfPaperSize || DEFAULT_PDF_PAPER_SIZE })}
        ${renderBookPreviewFontStatus(modal)}
      </div>
      <div class="book-composer"><div class="book-composer__sidebar"><nav class="book-composer__list" aria-label="Book items" tabindex="-1">${renderProjectBookItems(modal)}</nav><div class="book-add"><button type="button" class="button button--secondary" data-action="book-add-menu" aria-expanded="${modal.book.addMenuOpen}" ${modal.book.addMenuOpen ? "" : tooltipAttributes("Add new sections such as title page, table of contents, etc.", { align: "start" })}>+ Add new</button>${modal.book.addMenuOpen ? `<div class="book-add__menu">${BOOK_SECTION_TYPES.map((type) => `<button type="button" data-action="book-add:${type.kind}">${type.label}</button>`).join("")}</div>` : ""}</div></div><div class="book-composer__preview">${formattingToolbar(modal)}<div class="book-composer__page-scroll">${renderSelectedBookPage(modal)}</div></div></div>
      ${modal.error ? `<p class="modal__error book-composer__error" role="alert">${escapeHtml(modal.error)}</p>` : ""}
    </div></section></div>${renderBookSettingsNotice(modal)}`;
}
