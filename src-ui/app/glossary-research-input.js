// Typing and toggles in the Research modal and report. Fields update state in
// place without a re-render so the caret stays put; only controls that change
// what is shown (source mode, include checkboxes) re-render.

import {
  setResearchSourceMode,
  updateResearchField,
  updateResearchProposalField,
  updateResearchVariant,
} from "./glossary-research-flow.js";
import { updateResearchEntryField } from "./glossary-research-report-flow.js";
import { updateResearchPrepTerm } from "./glossary-research-prep-flow.js";

export function handleGlossaryResearchInput(event, render) {
  const target = event.target;
  if (!(target instanceof Element)) return false;

  const field = target.closest("[data-research-field]");
  if (field) {
    updateResearchField(field.dataset.researchField, field.value);
    return true;
  }
  const variant = target.closest("[data-research-variant-input]");
  if (variant) {
    updateResearchVariant(Number.parseInt(variant.dataset.variantIndex, 10), variant.value);
    return true;
  }
  const mode = target.closest("[data-research-source-mode]");
  if (mode) {
    if (event.type === "change" && mode.checked) setResearchSourceMode(render, mode.value);
    return true;
  }
  const proposal = target.closest("[data-research-proposal]");
  if (proposal) {
    const [entryIndex, fieldName, variantIndex, variantField] = proposal.dataset.researchProposal.split(":");
    updateResearchProposalField(
      [Number.parseInt(entryIndex, 10), fieldName, variantIndex == null ? null : Number.parseInt(variantIndex, 10), variantField],
      proposal.value,
    );
    return true;
  }
  const entry = target.closest("[data-research-entry]");
  if (entry) {
    const [entryId, fieldName, index] = entry.dataset.researchEntry.split(":");
    if (fieldName === "include") {
      if (event.type === "change") {
        updateResearchEntryField(entryId, "include", entry.checked, Number.parseInt(index, 10));
        render();
      }
      return true;
    }
    updateResearchEntryField(entryId, fieldName, entry.value, index == null ? null : Number.parseInt(index, 10));
    return true;
  }
  const prep = target.closest("[data-research-prep-term]");
  if (prep) {
    updateResearchPrepTerm(render, prep.value);
    return true;
  }
  return false;
}
