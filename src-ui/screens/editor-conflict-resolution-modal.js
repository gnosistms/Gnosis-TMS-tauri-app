import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { buildConflictReview, conflictReviewPendingCount, conflictReviewTargets } from "../app/editor-conflict-review.js";
import { conflictSourceDiff } from "../app/editor-conflict-comparison.js";
import { buildInlineMarkupDiff, renderSanitizedInlineMarkupHtml, renderSanitizedInlineMarkupWithRanges } from "../app/editor-inline-markup.js";

function remoteVersionLabel(version) {
  const date = new Date(version?.committedAt ?? "");
  return [version?.authorName, Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date)]
    .filter(Boolean).map(escapeHtml).join(" · ");
}

function changeMarkup(html, change, note = "") {
  const tag = change === "delete" ? "del" : change === "insert" ? "ins" : "mark";
  const paragraph = /\n/.test(html) && !html.replace(/<[^>]*>/g, "").trim();
  return `<${tag} class="editor-conflict-change editor-conflict-change--${paragraph ? "paragraph" : change}"${note ? ` title="${escapeHtml(note)}"` : ""}>${paragraph ? '<span class="editor-conflict-paragraph-marker" aria-label="Paragraph break">¶</span>' : ""}${html}</${tag}>`;
}

function renderDiff(base, value, showMarkup) {
  if (value === null) return '<p class="editor-conflict-modal__empty">Deleted in this version</p>';
  if (base === null) return renderValue(value, showMarkup);
  if (showMarkup) return conflictSourceDiff(base, value).map(({ change, text }) => change
    ? changeMarkup(escapeHtml(text), change) : escapeHtml(text)).join("");
  if (base.length + value.length > 40000) return renderValue(value, false);
  const diff = buildInlineMarkupDiff(base, value);
  const html = renderSanitizedInlineMarkupWithRanges(diff.markup, diff.ranges, (segment, range) => changeMarkup(segment, range.change, range.note));
  const notes = [...new Set(diff.ranges.map((range) => range.note).filter(Boolean))];
  return html + (notes.length ? `<span class="editor-conflict-modal__format-notes">${notes.map(escapeHtml).join(" · ")}</span>` : "");
}

function renderValue(value, showMarkup) {
  if (value === null) return '<span class="editor-conflict-modal__empty">This passage will be deleted.</span>';
  return showMarkup ? escapeHtml(value) : renderSanitizedInlineMarkupHtml(value);
}

function choiceButton(passage, side, label, disabled, initial = false) {
  const button = secondaryButton(label, `choose-editor-conflict-passage:${passage.id}:${side}`, {
    compact: true, disabled, modalInitialFocus: initial,
  });
  return button.replace("<button ", `<button aria-pressed="${passage.choice === side}" `);
}

const INPUT_ATTRIBUTES = {
  text: "data-editor-conflict-final-input",
  footnote: "data-editor-conflict-final-footnote-input",
  attribution: "data-editor-conflict-final-attribution-input",
  imageCaption: "data-editor-conflict-final-image-caption-input",
  imageUrl: "data-editor-conflict-final-image-input",
};

function renderPassage(passage, modal, { first = false } = {}) {
  const busy = modal.status === "loading";
  const editing = modal.editingPassageId === passage.id;
  const canCombine = passage.combined !== null;
  const localBase = modal.hasSharedBase ? passage.base : null;
  const remoteBase = modal.hasSharedBase ? passage.base : passage.local ?? "";
  const labels = { local: "Local changes", remote: "GitHub changes", combined: "Both edits combined", manual: "Manually edited" };
  const status = labels[passage.choice] ?? (canCombine ? "Suggested · not accepted" : "Choose a version or edit the result");
  const pane = (side, base) => `
    <section class="editor-conflict-modal__column">
      <header class="editor-conflict-modal__pane-header">
        <p class="editor-conflict-modal__version-label">${side === "local" ? "Local version" : "GitHub version"}</p>
        <p class="editor-conflict-modal__metadata">${modal.hasSharedBase ? `Original → ${side === "local" ? "local" : "GitHub"}` : side === "local" ? "Comparison baseline" : "Local → GitHub"}${side === "remote" && modal.remoteVersion ? ` · ${remoteVersionLabel(modal.remoteVersion)}` : ""}${passage[`${side}ParagraphMigration`] ? " · Paragraph spacing only" : ""}</p>
      </header>
      <div class="editor-conflict-modal__version-text${modal.showMarkup ? " editor-conflict-modal__source" : ""}">${renderDiff(base, passage[side], modal.showMarkup)}</div>
      <div class="editor-conflict-modal__version-actions">${choiceButton(passage, side, `Use ${side === "local" ? "local" : "GitHub"} changes`, busy, first && !canCombine && side === "local")}</div>
    </section>`;
  return `<section class="editor-conflict-modal__passage" data-editor-conflict-passage="${escapeHtml(passage.id)}">
    <div class="editor-conflict-modal__passage-header">
      <h3>${escapeHtml(passage.label)}</h3>
      <div>${canCombine ? choiceButton(passage, "combined", "Combine changes", busy, first) : '<span class="editor-conflict-modal__metadata">Review competing edits</span>'}</div>
    </div>
    <div class="editor-conflict-modal__versions">${pane("local", localBase)}${pane("remote", remoteBase)}</div>
    <section class="editor-conflict-modal__result">
      <header class="editor-conflict-modal__result-header">
        <div><strong>Result</strong> <span class="editor-conflict-modal__result-status" data-editor-conflict-result-status>${status}</span></div>
        <div class="editor-conflict-modal__result-actions">${passage.choice ? choiceButton(passage, "undo", "Undo choice", busy) : ""}${secondaryButton(editing ? "Preview" : "Edit text", `edit-editor-conflict-passage:${passage.id}`, { compact: true, disabled: busy })}</div>
      </header>
      <div class="editor-conflict-modal__result-preview${modal.showMarkup ? " editor-conflict-modal__source" : ""}" ${editing ? "hidden" : ""}>${renderValue(passage.value, modal.showMarkup)}</div>
      <label class="field editor-conflict-modal__final-field" ${editing ? "" : "hidden"}>
        <span class="field__label">Resolved ${escapeHtml(passage.label.toLowerCase())}</span>
        <textarea class="field__textarea editor-conflict-modal__final-input" data-editor-conflict-passage-input="${escapeHtml(passage.id)}" ${INPUT_ATTRIBUTES[passage.kind]} aria-label="Resolved ${escapeHtml(passage.label.toLowerCase())}" rows="1" ${busy ? "disabled" : ""}>${escapeHtml(passage.value ?? "")}</textarea>
      </label>
    </section>
    ${modal.hasSharedBase ? `<details class="editor-conflict-modal__original"><summary>Show shared version</summary><div class="editor-conflict-modal__version-text${modal.showMarkup ? " editor-conflict-modal__source" : ""}">${renderValue(passage.base ?? "", modal.showMarkup)}</div></details>` : ""}
  </section>`;
}

export function renderEditorConflictResolutionModal(state) {
  const chapter = state.editorChapter;
  const modal = chapter?.conflictResolutionModal;
  if (!modal?.isOpen) return "";
  const review = modal.review ?? buildConflictReview(modal);
  const changed = review.filter((p) => p.changed);
  const unchanged = review.filter((p) => !p.changed && p.value);
  const pending = conflictReviewPendingCount({ ...modal, review });
  const busy = modal.status === "loading";
  const targets = conflictReviewTargets(chapter);
  const index = targets.findIndex((t) => t.rowId === modal.rowId && t.languageCode === modal.languageCode);
  const onlyFootnotes = changed.length > 0 && changed.every((p) => p.kind === "footnote");
  const compatible = changed.length > 0 && changed.every((p) => p.combined !== null);
  const hasParagraphChange = changed.some((p) => p.localParagraphMigration || p.remoteParagraphMigration);
  const language = chapter.languages?.find((l) => l.code === modal.languageCode)?.name ?? modal.languageCode ?? "";
  const saveButton = loadingPrimaryButton({ label: "Save and finalize", loadingLabel: "Saving and finalizing...", action: "save-editor-conflict-resolution", isLoading: busy, modalDefault: true });
  return `<div class="modal-backdrop">
    <section class="card modal-card modal-card--editor-conflict" role="dialog" aria-modal="true" aria-labelledby="editor-conflict-resolution-modal-title" data-modal-dialog="editor-conflict-resolution" tabindex="-1">
      <div class="card__body modal-card__body editor-conflict-modal__body">
        <header class="editor-conflict-modal__header">
          <div><p class="card__eyebrow">CONFLICT</p><h2 class="modal__title" id="editor-conflict-resolution-modal-title">${onlyFootnotes ? "Resolve footnote changes" : "Resolve translation conflict"}</h2>
          <p class="editor-conflict-modal__metadata">${escapeHtml(chapter.fileTitle ?? "")} · ${escapeHtml(language)}${index >= 0 ? ` · Row ${targets[index].rowNumber}` : ""}</p></div>
          ${targets.length > 1 ? `<nav class="editor-conflict-modal__navigation" aria-label="Conflicted rows">${secondaryButton("Previous", "navigate-editor-conflict:previous", { compact: true, disabled: busy || index <= 0 })}<span>${index + 1} / ${targets.length}</span>${secondaryButton("Next", "navigate-editor-conflict:next", { compact: true, disabled: busy || index >= targets.length - 1 })}</nav>` : ""}
        </header>
        ${compatible ? `<p class="editor-conflict-modal__cause">${hasParagraphChange ? "Paragraph spacing and text edits can be combined." : "These changes can be combined. Review the suggested result before saving."}</p>` : ""}
        <div class="editor-conflict-modal__toolbar"><span>${modal.hasSharedBase ? "Changes against the shared version" : "Shared original unavailable · comparing local and GitHub versions"}</span>
          <button class="button button--secondary button--compact" data-action="toggle-editor-conflict-markup" aria-pressed="${Boolean(modal.showMarkup)}" ${busy ? "disabled" : ""}>${modal.showMarkup ? "Hide markup" : "Show markup"}</button></div>
        ${unchanged.length ? `<details class="editor-conflict-modal__unchanged"><summary>${unchanged.length} unchanged ${unchanged.length === 1 ? "passage" : "passages"}</summary>${unchanged.map((p) => `<section><h3>${escapeHtml(p.label)}</h3><div class="editor-conflict-modal__version-text">${renderValue(p.value, modal.showMarkup)}</div></section>`).join("")}</details>` : ""}
        <div class="editor-conflict-modal__legend" aria-label="Diff legend"><span><del>− removed</del></span><span><ins>+ added</ins></span><span class="editor-conflict-modal__paragraph-legend">¶ paragraph / formatting</span></div>
        ${changed.map((p, i) => renderPassage(p, modal, { first: i === 0 })).join("")}
      </div>
      <footer class="editor-conflict-modal__footer">
        <div class="editor-conflict-modal__feedback" aria-live="polite"><span data-editor-conflict-pending>${pending ? `${pending} ${pending === 1 ? "passage needs" : "passages need"} a choice` : "Ready to save"}</span>${modal.error ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(modal.error))}</p>` : ""}</div>
        <div class="modal__actions">${secondaryButton("Cancel", "cancel-editor-conflict-resolution", { disabled: busy, modalCancel: true })}${pending && !busy ? saveButton.replace("<button ", '<button disabled aria-disabled="true" ') : saveButton}</div>
      </footer>
    </section>
  </div>`;
}
