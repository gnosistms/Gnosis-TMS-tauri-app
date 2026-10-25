import { escapeHtml, loadingSpinner, primaryButton, secondaryButton } from "../lib/ui.js";

const esc = escapeHtml;
const TITLE = "Make a glossary entry";
const RESEARCH_TOOLTIP = "Use AI to investigate the meaning of the source term and suggest target language translations";
const SAVE_TOOLTIP = "Open the glossary editor and enter this term. You'll have a chance to review before saving.";

function frame(body, actions) {
  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact research-modal glossary-entry-modal" role="dialog" aria-modal="true" aria-labelledby="editor-glossary-entry-title" data-modal-dialog="editor-glossary-entry" tabindex="-1">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">Glossary</p>
          <h2 class="modal__title" id="editor-glossary-entry-title">${TITLE}</h2>
          ${body}
          <div class="modal__actions">${actions}</div>
        </div>
      </section>
    </div>`;
}

function cancelButton() {
  return secondaryButton("Cancel", "close-editor-glossary-entry", { modalCancel: true });
}

function termField({ label, field, value, language, placeholder = "", initialFocus = false, disabled = false }) {
  return `
    <label class="field">
      <span class="field__label">${esc(label)}</span>
      <input class="field__input" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}"
        lang="${esc(language?.code ?? "")}" data-editor-glossary-entry-field="${esc(field)}"
        ${initialFocus ? "data-modal-initial-focus" : ""} ${disabled ? "disabled" : ""} />
    </label>`;
}

function highlightedLine(entry) {
  return `<p class="modal__supporting">Highlighted in ${esc(entry.selectionLanguage?.name ?? "")}:
    <span class="glossary-entry-modal__quote" lang="${esc(entry.selectionLanguage?.code ?? "")}">“${esc(entry.selectedText)}”</span></p>`;
}

export function renderEditorGlossaryEntryModal(state) {
  const entry = state.editorGlossaryEntry;
  if (!entry?.isOpen) return "";
  const sourceName = entry.sourceLanguage?.name ?? "Source";
  const targetName = entry.targetLanguage?.name ?? "Target";

  if (entry.step === "blocked") {
    return frame(`<p class="modal__supporting">${esc(entry.blockedMessage)}</p>`,
      primaryButton("OK", "close-editor-glossary-entry", { modalDefault: true, modalCancel: true }));
  }

  if (entry.step === "finding") {
    const what = entry.selectionRole === "target" ? "text" : "term";
    return frame(`
      ${entry.selectionRole === "target"
        ? termField({ label: `Translation (${targetName})`, field: "targetTerm", value: entry.targetTerm, language: entry.targetLanguage, disabled: true })
        : highlightedLine(entry)}
      <p class="glossary-entry-modal__finding">${loadingSpinner({ key: "editor-glossary-entry", label: "Searching" })}
        <span>Finding the ${esc(sourceName)} ${what} that corresponds to it…</span></p>`,
    cancelButton());
  }

  if (entry.step === "not-found") {
    return frame(`
      <p class="modal__supporting">${esc(entry.notice)}</p>
      ${entry.error ? `<p class="muted">${esc(entry.error)}</p>` : ""}`,
    cancelButton());
  }

  const needsSource = !entry.sourceTerm.trim();
  const focusTarget = !needsSource && !entry.targetTerm.trim();
  return frame(`
    ${entry.selectionRole === "other" ? highlightedLine(entry) : ""}
    ${termField({ label: `Source term (${sourceName})`, field: "sourceTerm", value: entry.sourceTerm, language: entry.sourceLanguage,
      placeholder: `Type the ${sourceName} term`, initialFocus: needsSource })}
    ${termField({ label: `Translation (${targetName})`, field: "targetTerm", value: entry.targetTerm, language: entry.targetLanguage,
      placeholder: `Type the ${targetName} translation`, initialFocus: focusTarget })}
    ${entry.notice ? `<p class="modal__supporting">${esc(entry.notice)}</p>` : ""}
    ${entry.error ? `<p class="muted">${esc(entry.error)}</p>` : ""}`,
  `${cancelButton()}
   ${secondaryButton("Research meanings", "research-editor-glossary-entry", { disabled: needsSource, tooltip: RESEARCH_TOOLTIP, tooltipOptions: { align: "end" } })}
   ${primaryButton("Save to glossary", "save-editor-glossary-entry", { modalDefault: true, modalInitialFocus: !needsSource && !focusTarget, disabled: needsSource,
     tooltip: SAVE_TOOLTIP, tooltipOptions: { align: "end" } })}`);
}
