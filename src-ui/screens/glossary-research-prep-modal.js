import { escapeHtml, primaryButton, secondaryButton } from "../lib/ui.js";

const esc = escapeHtml;

function frame(title, body, actions) {
  return `
    <div class="modal-backdrop">
      <section class="card modal-card research-modal" role="dialog" aria-modal="true" aria-label="${esc(title)}" data-modal-dialog="glossary-research-prep" tabindex="-1">
        <h2 class="modal__title">${esc(title)}</h2>
        ${body}
        <div class="modal__actions">${actions}</div>
      </section>
    </div>`;
}

export function renderGlossaryResearchPrepModal(state) {
  const prep = state.glossaryResearchPrep;
  if (!prep?.isOpen) return "";
  const selected = prep.languages.find((language) => language.code === prep.selectedLanguageCode) ?? prep.languages[0];
  const sourceName = prep.languages.find((language) => language.code === prep.sourceLanguageCode)?.name ?? prep.sourceLanguageCode;

  if (prep.step === "blocked") {
    return frame("Research glossary terms", `<p class="modal__supporting">${esc(prep.blockedMessage)}</p>`,
      primaryButton("OK", "close-research-prep-blocked", { modalDefault: true }));
  }

  if (prep.step === "not-found") {
    return frame("Research glossary terms",
      `<p class="modal__supporting">We can not find a term in ${esc(sourceName)} that corresponds to ${esc(prep.term.trim())}.</p>
       ${prep.error ? `<p class="muted">${esc(prep.error)}</p>` : ""}`,
      `${secondaryButton("Cancel research", "cancel-research-prep", { modalCancel: true })}
       ${primaryButton("Edit research term", "edit-research-prep-term", { modalDefault: true })}`);
  }

  if (prep.step === "confirm") {
    const identified = prep.identified;
    return frame("Research glossary terms",
      `<p class="modal__supporting">We have identified that the ${esc(sourceName)} term corresponding to ${esc(prep.term.trim())} is <strong>${esc(identified.sourceTerm)}</strong>.</p>
       ${identified.definitions.length ? `<ol class="research-definitions" lang="${esc(selected?.code ?? "")}">${identified.definitions.map((definition) => `<li>${esc(definition)}</li>`).join("")}</ol>` : ""}`,
      `${secondaryButton("Cancel", "cancel-research-prep", { modalCancel: true })}
       ${secondaryButton("Edit term", "edit-research-prep-term")}
       ${primaryButton("Research this term", "confirm-research-prep-term", { modalDefault: true })}`);
  }

  const segments = prep.languages.map((language) => {
    const active = language.code === prep.selectedLanguageCode;
    return `<button type="button" class="segmented-control__button${active ? " is-active" : ""}" role="tab"
      aria-selected="${active}" data-action="select-research-prep-language:${esc(language.code)}">${esc(language.name)}</button>`;
  }).join("");
  const rowText = selected?.text.trim()
    ? `<div class="research-row-text" lang="${esc(selected.code)}">${esc(selected.text)}</div>`
    : `<p class="muted research-row-text research-row-text--empty">${esc(selected?.name ?? "")} has no text in this row.</p>`;
  const finding = prep.step === "finding";
  const body = `
    <div class="field">
      <span class="field__label">Select the language of the term you want to research</span>
      <div class="segmented-control" role="tablist" aria-label="Language of the term">${segments}</div>
    </div>
    <label class="field">
      <span class="field__label">Enter the ${esc(selected?.name ?? "")} word you want to research</span>
      <input class="field__input" type="text" value="${esc(prep.term)}" placeholder="Enter research word or phrase here"
        data-research-prep-term data-modal-initial-focus ${finding ? "disabled" : ""} />
    </label>
    ${rowText}
    ${finding ? `<p class="muted">Finding the ${esc(sourceName)} term…</p>` : ""}`;
  return frame("Research glossary terms", body,
    `${secondaryButton("Cancel", "cancel-research-prep", { modalCancel: true })}
     ${primaryButton("Next", "research-prep-next", { modalDefault: true, disabled: finding || !prep.term.trim() })}`);
}
