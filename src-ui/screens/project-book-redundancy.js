import { extractInlineMarkupVisibleText } from "../app/editor-inline-markup.js";
import { escapeHtml, secondaryButton } from "../lib/ui.js";
import { convertLocalFileSrc } from "../app/runtime.js";
import { bookNavButton, renderBookSettingsNotice } from "./project-book-composer.js";
import { imageReviewChoices, reviewChoiceIncluded } from "../app/project-book-redundancy-model.js";
function checkbox(id, included, disabled, description) {
  return `<label class="field__checkbox"><input type="checkbox" data-book-redundancy-choice="${escapeHtml(id)}" aria-label="Include ${escapeHtml(description)}" ${included ? "checked" : ""} ${disabled ? "disabled" : ""}><span>Include</span></label>`;
}
function contents(modal) {
  const review = modal.book.redundancy || {}, result = review.result || {};
  const busy = review.status !== "ready";
  return `<div data-book-redundancy-results aria-busy="${review.status === "loading"}">
    <p class="modal__supporting">Include the first occurrence by default. Check additional occurrences to keep them in this book.</p>
    ${review.stage ? `<p role="status">${escapeHtml(review.stage)}</p>` : ""}
    ${review.error ? `<p class="modal__error" role="alert">${escapeHtml(review.error)}</p>` : ""}
    ${(result.warnings || []).map((warning) => `<p class="modal__supporting" role="status">${escapeHtml(warning)} Unresolved footnotes and images remain included.</p>`).join("")}
    ${review.status === "error" || result.warnings?.length ? '<button type="button" class="button button--secondary" data-action="book-redundancy-retry">Retry checks</button>' : ""}
    <section aria-labelledby="book-redundancy-images"><h3 id="book-redundancy-images">Redundant images</h3>
      ${(result.images || []).map((group) => {
        const src = group.occurrences[0].imageSrc;
        return `<article class="book-redundancy__group"><img class="book-redundancy__thumbnail" src="${escapeHtml(/^(https?:|data:image\/)/.test(src) ? src : convertLocalFileSrc(src))}" alt="Repeated image" loading="lazy"><ul>${imageReviewChoices(group).map((entry, index) => `<li><span>${escapeHtml(entry.chapterName)}${entry.occurrences.length > 1 ? ` · ${entry.occurrences.length} occurrences (keeps the first here)` : ""}</span>${checkbox(entry.choiceId, reviewChoiceIncluded(review.choices, entry.choiceId, index), busy, entry.chapterName)}</li>`).join("")}</ul></article>`;
      }).join("") || (review.status === "ready" ? `<p class="modal__supporting">${result.warnings?.length ? 'No redundant images confirmed so far.' : 'No redundant images found.'}</p>` : "")}
    </section>
    <section aria-labelledby="book-redundancy-footnotes"><h3 id="book-redundancy-footnotes">Redundant footnotes</h3>
      ${(result.footnotes || []).map((group) => `<article class="book-redundancy__group"><blockquote>${escapeHtml(group.anchor)}</blockquote><ul>${group.occurrences.map((entry, index) => `<li><div><strong>${escapeHtml(entry.chapterName)} · note ${entry.marker}</strong><p>${escapeHtml(extractInlineMarkupVisibleText(entry.text))}</p><small>${escapeHtml(entry.context)}</small></div>${checkbox(entry.id, reviewChoiceIncluded(review.choices, entry.id, index), busy, `${entry.chapterName}, note ${entry.marker}`)}</li>`).join("")}</ul></article>`).join("") || (review.status === "ready" ? `<p class="modal__supporting">${result.warnings?.length ? 'No redundant footnotes confirmed so far.' : 'No redundant footnotes found.'}</p>` : "")}
    </section></div>`;
}
export function renderBookRedundancy(modal) {
  return `<div class="modal-backdrop"><section class="card modal-card modal-card--book-redundancy" role="dialog" aria-modal="true" aria-label="Export project" data-modal-dialog="editor-export" tabindex="-1"><div class="card__body modal-card__body">
    <header class="book-redundancy__header">${bookNavButton("previous")}<h2 class="modal__title" id="book-redundancy-title">Review redundancy</h2><div>${secondaryButton("Cancel", "close-editor-export-options", { modalCancel: true })}${bookNavButton("next", !["ready", "error"].includes(modal.book.redundancy?.status))}</div></header>
    <div class="book-redundancy__scroll">${contents(modal)}</div></div></section></div>${renderBookSettingsNotice(modal)}`;
}
export function updateBookRedundancyView(root, appState) {
  const modal = appState.editorChapter?.exportModal;
  const current = root.querySelector("[data-book-redundancy-results]");
  if (modal?.page !== 2 || !current) return false;
  const template = root.ownerDocument.createElement("template");template.innerHTML = contents(modal);
  current.replaceWith(template.content);
  root.querySelector('[data-action="book-next"]').disabled = !["ready", "error"].includes(modal.book.redundancy?.status);
  return true;
}
