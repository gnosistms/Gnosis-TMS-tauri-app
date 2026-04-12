import { state } from "./state.js";
import { syncAutoSizeTextarea, syncEditorRowTextareaHeight } from "./autosize.js";
import { syncEditorVirtualizationRowLayout } from "./editor-virtualization.js";
import { editorChapterFiltersAreActive } from "./editor-filters.js";
import {
  updateProjectCreationName,
  updateProjectPermanentDeletionConfirmation,
  updateProjectRenameName,
} from "./project-flow.js";
import {
  updateChapterPermanentDeletionConfirmation,
  updateChapterGlossaryLinks,
  updateChapterRenameName,
} from "./project-chapter-flow.js";
import {
  updateTeamPermanentDeletionConfirmation,
  updateTeamRenameName,
} from "./team-setup-flow.js";
import { updateInviteUserQuery } from "./invite-user-flow.js";
import {
  updateGlossaryPermanentDeletionConfirmation,
  updateGlossaryRenameName,
  updateGlossaryTermVariant,
  updateGlossaryCreationField,
  updateGlossaryTermDraftField,
  updateGlossaryTermSearchQuery,
} from "./glossary-flow.js";
import {
  MANAGE_TARGET_LANGUAGES_OPTION_VALUE,
  openTargetLanguageManager,
  persistEditorRowOnBlur,
  syncEditorGlossaryHighlightRowDom,
  toggleEditorReplaceEnabled,
  toggleEditorReplaceRowSelected,
  updateEditorFontSize,
  updateEditorReplaceQuery,
  updateEditorRowFieldValue,
  updateEditorSearchFilterQuery,
  updateEditorSourceLanguage,
  updateEditorTargetLanguage,
} from "./translate-flow.js";
import { normalizedConfirmationValue } from "./resource-entity-modal.js";

function handleProjectCreationInput(event) {
  const input = event.target.closest("[data-project-name-input]");
  if (!input) {
    return false;
  }

  updateProjectCreationName(input.value);
  return true;
}

function handleProjectPermanentDeleteInput(event) {
  const input = event.target.closest("[data-project-permanent-delete-input]");
  if (!input) {
    return false;
  }

  updateProjectPermanentDeletionConfirmation(input.value);
  const deleteButton = document.querySelector("[data-project-permanent-delete-button]");
  if (deleteButton) {
    deleteButton.disabled =
      normalizedConfirmationValue(input.value) !== normalizedConfirmationValue(state.projectPermanentDeletion.projectName);
  }
  return true;
}

function handleTeamRenameInput(event) {
  const input = event.target.closest("[data-team-rename-input]");
  if (!input) {
    return false;
  }

  updateTeamRenameName(input.value);
  return true;
}

function handleTeamPermanentDeleteInput(event) {
  const input = event.target.closest("[data-team-permanent-delete-input]");
  if (!input) {
    return false;
  }

  updateTeamPermanentDeletionConfirmation(input.value);
  const deleteButton = document.querySelector("[data-team-permanent-delete-button]");
  if (deleteButton) {
    deleteButton.disabled =
      normalizedConfirmationValue(input.value) !== normalizedConfirmationValue(state.teamPermanentDeletion.teamName);
  }
  return true;
}

function handleProjectRenameInput(event) {
  const input = event.target.closest("[data-project-rename-input]");
  if (!input) {
    return false;
  }

  updateProjectRenameName(input.value);
  return true;
}

function handleChapterRenameInput(event) {
  const input = event.target.closest("[data-chapter-rename-input]");
  if (!input) {
    return false;
  }

  updateChapterRenameName(input.value);
  return true;
}

function handleChapterPermanentDeleteInput(event) {
  const input = event.target.closest("[data-chapter-permanent-delete-input]");
  if (!input) {
    return false;
  }

  updateChapterPermanentDeletionConfirmation(input.value);
  const deleteButton = document.querySelector("[data-chapter-permanent-delete-button]");
  if (deleteButton) {
    deleteButton.disabled =
      normalizedConfirmationValue(input.value) !== normalizedConfirmationValue(state.chapterPermanentDeletion.chapterName);
  }
  return true;
}

function handleInviteUserInput(event, render) {
  const input = event.target.closest("[data-invite-user-input]");
  if (!input) {
    return false;
  }

  updateInviteUserQuery(render, input.value);
  return true;
}

function handleGlossaryTitleInput(event) {
  const input = event.target.closest("[data-glossary-title-input]");
  if (!input) {
    return false;
  }

  updateGlossaryCreationField("title", input.value);
  return true;
}

function handleGlossarySourceLanguageInput(event) {
  const input = event.target.closest("[data-glossary-source-language-select]");
  if (!input) {
    return false;
  }

  updateGlossaryCreationField("sourceLanguageCode", input.value);
  return true;
}

function handleGlossaryTargetLanguageInput(event) {
  const input = event.target.closest("[data-glossary-target-language-select]");
  if (!input) {
    return false;
  }

  updateGlossaryCreationField("targetLanguageCode", input.value);
  return true;
}

function handleGlossaryRenameInput(event) {
  const input = event.target.closest("[data-glossary-rename-input]");
  if (!input) {
    return false;
  }

  updateGlossaryRenameName(input.value);
  return true;
}

function handleGlossaryPermanentDeleteInput(event) {
  const input = event.target.closest("[data-glossary-permanent-delete-input]");
  if (!input) {
    return false;
  }

  updateGlossaryPermanentDeletionConfirmation(input.value);
  const deleteButton = document.querySelector("[data-glossary-permanent-delete-button]");
  if (deleteButton) {
    deleteButton.disabled =
      normalizedConfirmationValue(input.value) !== normalizedConfirmationValue(state.glossaryPermanentDeletion.glossaryName);
  }
  return true;
}

function handleGlossaryTermSearchInput(event, render) {
  const input = event.target.closest("[data-glossary-term-search-input]");
  if (!input) {
    return false;
  }

  updateGlossaryTermSearchQuery(render, input.value);
  return true;
}

function handleGlossaryTermVariantInput(event) {
  const input = event.target.closest("[data-glossary-term-variant-input]");
  if (!input) {
    return false;
  }

  const side = input.dataset.variantSide;
  const index = Number.parseInt(input.dataset.variantIndex ?? "", 10);
  if ((side !== "source" && side !== "target") || !Number.isInteger(index) || index < 0) {
    return false;
  }

  updateGlossaryTermVariant(side, index, input.value);
  syncAutoSizeTextarea(input, { minHeight: 44, maxHeight: 96 });
  return true;
}

function handleGlossaryTermNotesInput(event) {
  const input = event.target.closest("[data-glossary-term-notes-input]");
  if (!input) {
    return false;
  }

  updateGlossaryTermDraftField("notesToTranslators", input.value);
  return true;
}

function handleGlossaryTermFootnoteInput(event) {
  const input = event.target.closest("[data-glossary-term-footnote-input]");
  if (!input) {
    return false;
  }

  updateGlossaryTermDraftField("footnote", input.value);
  return true;
}

function handleEditorSourceLanguageInput(event, render) {
  const input = event.target.closest("[data-editor-source-language-select]");
  if (!input) {
    return false;
  }

  updateEditorSourceLanguage(render, input.value);
  return true;
}

function handleEditorTargetLanguageInput(event, render) {
  if (event.type !== "change") {
    return false;
  }

  const input = event.target.closest("[data-editor-target-language-select]");
  if (!input) {
    return false;
  }

  if (input.value === MANAGE_TARGET_LANGUAGES_OPTION_VALUE) {
    openTargetLanguageManager();
    render();
    return true;
  }

  updateEditorTargetLanguage(render, input.value);
  return true;
}

function handleEditorFontSizeInput(event, render) {
  if (event.type !== "change") {
    return false;
  }

  const input = event.target.closest("[data-editor-font-size-select]");
  if (!input) {
    return false;
  }

  updateEditorFontSize(input.value);
  render();
  return true;
}

function handleEditorSearchInput(event, render) {
  const input = event.target.closest("[data-editor-search-input]");
  if (!input) {
    return false;
  }

  updateEditorSearchFilterQuery(render, input.value);
  return true;
}

function handleEditorReplaceToggleInput(event, render) {
  if (event.type !== "change") {
    return false;
  }

  const input = event.target.closest("[data-editor-replace-toggle]");
  if (!(input instanceof HTMLInputElement)) {
    return false;
  }

  toggleEditorReplaceEnabled(render, input.checked);
  return true;
}

function handleEditorReplaceInput(event, render) {
  const input = event.target.closest("[data-editor-replace-input]");
  if (!input) {
    return false;
  }

  updateEditorReplaceQuery(render, input.value);
  return true;
}

function handleEditorReplaceRowSelectionInput(event, render) {
  if (event.type !== "change") {
    return false;
  }

  const input = event.target.closest("[data-editor-replace-row-select]");
  if (!(input instanceof HTMLInputElement)) {
    return false;
  }

  toggleEditorReplaceRowSelected(render, input.dataset.rowId, input.checked, input);
  return true;
}

function handleEditorRowFieldInput(event, render) {
  if (event.type !== "input") {
    return false;
  }

  const input = event.target.closest("[data-editor-row-field]");
  if (!input) {
    return false;
  }

  updateEditorRowFieldValue(
    input.dataset.rowId,
    input.dataset.languageCode,
    input.value,
  );
  if (editorChapterFiltersAreActive(state.editorChapter?.filters)) {
    render();
    return true;
  }
  syncEditorRowTextareaHeight(input);
  syncEditorVirtualizationRowLayout(input);
  syncEditorGlossaryHighlightRowDom(input.dataset.rowId);
  return true;
}

function handleEditorRowFieldChange(event, render) {
  if (event.type !== "change") {
    return false;
  }

  const input = event.target.closest("[data-editor-row-field]");
  if (!input) {
    return false;
  }

  void persistEditorRowOnBlur(render, input.dataset.rowId);
  return true;
}

function handleChapterGlossarySelectInput(event, render) {
  if (event.type !== "change") {
    return false;
  }

  const input = event.target.closest("[data-chapter-glossary-select]");
  if (!input) {
    return false;
  }

  void updateChapterGlossaryLinks(
    render,
    input.dataset.chapterId,
    input.value,
  );
  return true;
}

const inputHandlers = [
  handleProjectCreationInput,
  handleProjectPermanentDeleteInput,
  handleTeamRenameInput,
  handleTeamPermanentDeleteInput,
  handleProjectRenameInput,
  handleChapterRenameInput,
  handleChapterPermanentDeleteInput,
  handleInviteUserInput,
  handleGlossaryTitleInput,
  handleGlossarySourceLanguageInput,
  handleGlossaryTargetLanguageInput,
  handleGlossaryRenameInput,
  handleGlossaryPermanentDeleteInput,
  handleGlossaryTermSearchInput,
  handleGlossaryTermVariantInput,
  handleGlossaryTermNotesInput,
  handleGlossaryTermFootnoteInput,
  handleEditorSourceLanguageInput,
  handleEditorTargetLanguageInput,
  handleEditorFontSizeInput,
  handleEditorSearchInput,
  handleEditorReplaceToggleInput,
  handleEditorReplaceInput,
  handleEditorReplaceRowSelectionInput,
  handleEditorRowFieldInput,
  handleEditorRowFieldChange,
  handleChapterGlossarySelectInput,
];

export function handleInputEvent(event, render) {
  for (const handler of inputHandlers) {
    if (handler(event, render)) {
      break;
    }
  }
}
