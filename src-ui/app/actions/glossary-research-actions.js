import {
  addResearchProposalVariant,
  addResearchVariant,
  backToResearchForm,
  cancelGlossaryResearchRun,
  closeGlossaryResearch,
  closeResearchLanguagePicker,
  closeResearchProjectPicker,
  countGlossaryResearch,
  openGlossaryResearch,
  openResearchLanguagePicker,
  openResearchProjectPicker,
  removeResearchProposalEntry,
  removeResearchProposalVariant,
  removeResearchVariant,
  resumeGlossaryResearchRun,
  selectResearchPickerLanguage,
  setResearchReportLanguage,
  setResearchSourceMode,
  startGlossaryResearch,
  toggleAllResearchPickerProjects,
  toggleResearchAdvanced,
  toggleResearchPickerProject,
} from "../glossary-research-flow.js";
import {
  addResearchEntryVariant,
  closeResearchReport,
  copyResearchMarkdown,
  openResearchReport,
  saveResearchEntry,
  setResearchEntryDecision,
  showAllResearchExamples,
  toggleResearchVariantExamples,
} from "../glossary-research-report-flow.js";
import {
  cancelResearchPrep,
  closeResearchPrepBlocked,
  confirmResearchPrepTerm,
  editResearchPrepTerm,
  openResearchPrepFromEditor,
  researchPrepNext,
  selectResearchPrepLanguage,
} from "../glossary-research-prep-flow.js";
import { openExternalUrl } from "../runtime.js";

export function createGlossaryResearchActions(render) {
  const exact = {
    "open-glossary-research": () => openGlossaryResearch(render),
    "close-glossary-research": () => closeGlossaryResearch(render),
    "start-glossary-research": () => startGlossaryResearch(render),
    "back-to-research-form": () => backToResearchForm(render),
    "add-research-variant": () => addResearchVariant(render),
    "open-research-language-picker": () => openResearchLanguagePicker(render),
    "cancel-research-language-picker": () => closeResearchLanguagePicker(render, false),
    "confirm-research-language-picker": () => closeResearchLanguagePicker(render, true),
    "open-research-project-picker": () => openResearchProjectPicker(render),
    "cancel-research-project-picker": () => closeResearchProjectPicker(render, false),
    "confirm-research-project-picker": () => closeResearchProjectPicker(render, true),
    "toggle-research-advanced": () => toggleResearchAdvanced(render),
    "toggle-all-research-picker-projects": () => toggleAllResearchPickerProjects(render),
    "cancel-glossary-research-run": () => cancelGlossaryResearchRun(render),
    "count-glossary-research": () => countGlossaryResearch(render),
    "close-research-report": () => closeResearchReport(render),
    "copy-research-markdown": () => copyResearchMarkdown(render),
    "close-research-prep-blocked": () => closeResearchPrepBlocked(render),
    "cancel-research-prep": () => cancelResearchPrep(render),
    "research-prep-next": () => researchPrepNext(render),
    "edit-research-prep-term": () => editResearchPrepTerm(render),
    "confirm-research-prep-term": () => confirmResearchPrepTerm(render),
  };
  const prefixes = [
    ["remove-research-variant:", (rest) => removeResearchVariant(render, Number.parseInt(rest, 10))],
    ["set-research-report-language:", (rest) => setResearchReportLanguage(render, rest)],
    ["set-research-source-mode:", (rest) => setResearchSourceMode(render, rest)],
    ["select-research-picker-language:", (rest) => selectResearchPickerLanguage(render, rest)],
    ["toggle-research-picker-project:", (rest) => toggleResearchPickerProject(render, rest)],
    ["open-research-report:", (rest) => openResearchReport(render, rest)],
    ["resume-research-run:", (rest) => resumeGlossaryResearchRun(render, rest)],
    ["remove-research-entry:", (rest) => removeResearchProposalEntry(render, Number.parseInt(rest, 10))],
    ["add-research-proposal-variant:", (rest) => addResearchProposalVariant(render, Number.parseInt(rest, 10))],
    ["remove-research-proposal-variant:", (rest) => {
      const [entryIndex, variantIndex] = rest.split(":").map((value) => Number.parseInt(value, 10));
      removeResearchProposalVariant(render, entryIndex, variantIndex);
    }],
    ["toggle-research-examples:", (rest) => toggleResearchVariantExamples(render, rest)],
    ["show-all-research-examples:", (rest) => showAllResearchExamples(render, rest)],
    ["set-research-entry-decision:", (rest) => {
      const cut = rest.lastIndexOf(":");
      setResearchEntryDecision(render, rest.slice(0, cut), rest.slice(cut + 1));
    }],
    ["add-research-entry-variant:", (rest) => addResearchEntryVariant(render, rest)],
    ["save-research-entry:", (rest) => saveResearchEntry(render, rest)],
    ["open-research-source:", (rest) => openExternalUrl(rest)],
    ["select-research-prep-language:", (rest) => selectResearchPrepLanguage(render, rest)],
  ];

  return async function handleGlossaryResearchAction(action, event) {
    if (action === "open-research-prep") {
      const button = event?.target?.closest?.("[data-row-id]");
      if (button) await openResearchPrepFromEditor(render, button.dataset.rowId);
      return true;
    }
    if (exact[action]) {
      await exact[action](event);
      return true;
    }
    for (const [prefix, handler] of prefixes) {
      if (action.startsWith(prefix)) {
        await handler(action.slice(prefix.length), event);
        return true;
      }
    }
    return false;
  };
}
