import { extractInlineMarkupVisibleText } from "../app/editor-inline-markup.js";
import { escapeHtml, loadingSpinner, secondaryButton } from "../lib/ui.js";
import { convertLocalFileSrc } from "../app/runtime.js";
import { bookNavButton, renderBookSettingsNotice } from "./project-book-composer.js";
import { bookChapterNumbers, bookItemTitle, bookSectionLabel } from "../app/project-book-model.js";
import { imageReviewChoices, reviewChoiceIncluded } from "../app/project-book-redundancy-model.js";
function checkbox(id, included, description) {
  return `<label class="field__checkbox"><input type="checkbox" data-book-redundancy-choice="${escapeHtml(id)}" aria-label="Include in export: ${escapeHtml(description)}" ${included ? "checked" : ""}><span>Include in export</span></label>`;
}
function section(modal, kind) {
  const review = modal.book.redundancy || {};
  const numbers = bookChapterNumbers(modal.book.items || []);
  const labels = new Map((modal.book.items || []).map((item) => [item.id,
    `${numbers.has(item.id) ? `${numbers.get(item.id)}. ` : ""}${item.kind === "title" ? bookSectionLabel("title") : bookItemTitle(item) || ""}`]));
  const result = review.result || {};
  const status = review[`${kind}Status`] || review.status || "loading";
  const groups = result[kind] || [];
  const imageWarnings = result.imageWarnings || [];
  const warnings = kind === "images" ? imageWarnings : (result.warnings || []).filter((warning) => !imageWarnings.includes(warning));
  const phase = kind === "footnotes" ? review.footnotesPhase : "";
  const key = JSON.stringify([status, phase, groups, warnings]);
  let content;
  if (status === "loading") {
    const message = phase === "frequencies" ? "Computing word frequency counts..." : phase === "meanings" ? "Comparing footnote meanings..." : `Checking for redundant ${kind}...`;
    content = `<p class="book-redundancy__checking">${message}${loadingSpinner({ key: `book-redundancy-${kind}-${phase}`, label: message })}</p>`;
  } else if (status === "error") {
    content = `<p class="modal__supporting">Could not finish checking for redundant ${kind}.</p>`;
  } else {
    content = groups.map((group) => {
      if (kind === "images") {
        const src = group.occurrences[0].imageSrc;
        return `<article class="book-redundancy__group"><img class="book-redundancy__thumbnail" src="${escapeHtml(/^(https?:|data:image\/)/.test(src) ? src : convertLocalFileSrc(src))}" alt="Repeated image" loading="lazy"><h4 class="book-redundancy__chapters-heading">Chapters that include this image:</h4><ul class="book-redundancy__chapters">${imageReviewChoices(group).map((entry, index) => {
          const title = labels.get(entry.itemId) || entry.chapterName;
          return `<li class="term-variant-row book-item book-redundancy__chapter"><div class="term-variant-row__shell"><div class="book-redundancy__chapter-name"><span data-book-redundancy-chapter-title="${escapeHtml(entry.choiceId)}">${escapeHtml(title)}</span>${entry.occurrences.length > 1 ? `<small>${entry.occurrences.length} occurrences (keeps the first here)</small>` : ""}</div>${checkbox(entry.choiceId, reviewChoiceIncluded(review.choices, entry.choiceId, index), title)}</div></li>`;
        }).join("")}</ul></article>`;
      }
      return `<article class="book-redundancy__group"><blockquote>${escapeHtml(group.anchor)}</blockquote><ul>${group.occurrences.map((entry, index) => `<li><div><strong>${escapeHtml(entry.chapterName)} · note ${entry.marker}</strong><p>${escapeHtml(extractInlineMarkupVisibleText(entry.text))}</p><small>${escapeHtml(entry.context)}</small></div>${checkbox(entry.id, reviewChoiceIncluded(review.choices, entry.id, index), `${entry.chapterName}, note ${entry.marker}`)}</li>`).join("")}</ul></article>`;
    }).join("") || `<p class="modal__supporting">${warnings.length ? `No redundant ${kind} confirmed so far.` : `No redundant ${kind} found.`}</p>`;
    content += warnings.map((warning) => `<p class="modal__supporting" role="status">${escapeHtml(warning)} Unresolved ${kind} remain included.</p>`).join("");
  }
  return `<section data-book-redundancy-section="${kind}" data-content-key="${escapeHtml(key)}" aria-busy="${status === "loading"}" aria-labelledby="book-redundancy-${kind}"><h3 id="book-redundancy-${kind}">Redundant ${kind}</h3>${content}</section>`;
}
function messages(review) {
  return `<div data-book-redundancy-section="messages">
    ${review.error ? `<p class="modal__error" role="alert">${escapeHtml(review.error)}</p>` : ""}
    ${review.choiceSaveError ? `<p class="modal__error" role="alert">${escapeHtml(review.choiceSaveError)}</p>` : ""}
    ${review.choiceSaveError ? '<button type="button" class="button button--secondary" data-action="book-redundancy-save-retry">Retry saving choices</button>' : ""}
    ${review.status === "error" || (review.status === "ready" && review.result?.warnings?.length) ? '<button type="button" class="button button--secondary" data-action="book-redundancy-retry">Retry checks</button>' : ""}
  </div>`;
}
function contents(modal) {
  const review = modal.book.redundancy || {};
  return `<div data-book-redundancy-results>
    ${messages(review)}${section(modal, "images")}${section(modal, "footnotes")}</div>`;
}
export function renderBookRedundancy(modal) {
  return `<div class="modal-backdrop"><section class="card modal-card modal-card--book-redundancy" role="dialog" aria-modal="true" aria-label="Export project" data-modal-dialog="editor-export" tabindex="-1"><div class="card__body modal-card__body">
    <header class="book-redundancy__header">${bookNavButton("previous")}<h2 class="modal__title" id="book-redundancy-title">Redundancy checks</h2><div>${secondaryButton("Cancel", "close-editor-export-options", { modalCancel: true })}${bookNavButton("next", !["ready", "error"].includes(modal.book.redundancy?.status))}</div></header>
    <div class="book-redundancy__scroll">${contents(modal)}</div></div></section></div>${renderBookSettingsNotice(modal)}`;
}
export function updateBookRedundancyView(root, appState) {
  const modal = appState.editorChapter?.exportModal;
  const current = root.querySelector("[data-book-redundancy-results]");
  if (modal?.page !== 2 || !current) return false;
  const template = root.ownerDocument.createElement("template");template.innerHTML = contents(modal);
  for (const next of template.content.querySelectorAll("[data-book-redundancy-section]")) {
    const previous = current.querySelector(`[data-book-redundancy-section="${next.dataset.bookRedundancySection}"]`);
    if (next.dataset.contentKey && next.dataset.contentKey === previous.dataset.contentKey) {
      // Footnote completion must preserve the image controls, focus and scroll.
      const controls = new Map([...previous.querySelectorAll("[data-book-redundancy-choice]")].map((input) => [input.dataset.bookRedundancyChoice, input]));
      for (const input of next.querySelectorAll("[data-book-redundancy-choice]")) {
        const existing = controls.get(input.dataset.bookRedundancyChoice);
        if (existing) {
          existing.checked = input.checked;
          existing.setAttribute("aria-label", input.getAttribute("aria-label"));
        }
      }
      const titles = new Map([...previous.querySelectorAll("[data-book-redundancy-chapter-title]")].map((node) => [node.dataset.bookRedundancyChapterTitle, node]));
      for (const title of next.querySelectorAll("[data-book-redundancy-chapter-title]")) {
        const existing = titles.get(title.dataset.bookRedundancyChapterTitle);
        if (existing && existing.textContent !== title.textContent) existing.textContent = title.textContent;
      }
    } else if (next.outerHTML !== previous.outerHTML) previous.replaceWith(next);
  }
  root.querySelector('[data-action="book-next"]').disabled = !["ready", "error"].includes(modal.book.redundancy?.status);
  return true;
}
