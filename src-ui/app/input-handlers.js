import { state } from "./state.js";
import {
  updateChapterPermanentDeletionConfirmation,
  updateChapterRenameName,
  updateProjectCreationName,
  updateProjectPermanentDeletionConfirmation,
  updateProjectRenameName,
} from "./project-flow.js";
import {
  updateTeamPermanentDeletionConfirmation,
  updateTeamRenameName,
} from "./team-setup-flow.js";
import { updateInviteUserQuery } from "./invite-user-flow.js";
import {
  updateGlossaryCreationField,
  updateGlossariesSearchQuery,
  updateGlossaryTermDraftField,
  updateGlossaryTermSearchQuery,
} from "./glossary-flow.js";
import {
  persistEditorRowOnBlur,
  updateEditorRowFieldValue,
  updateEditorSourceLanguage,
  updateEditorTargetLanguage,
} from "./translate-flow.js";

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
      input.value !== state.projectPermanentDeletion.projectName;
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
      input.value !== state.teamPermanentDeletion.teamName;
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
      input.value !== state.chapterPermanentDeletion.chapterName;
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

function handleGlossariesSearchInput(event, render) {
  const input = event.target.closest("[data-glossaries-search-input]");
  if (!input) {
    return false;
  }

  updateGlossariesSearchQuery(render, input.value);
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

function handleGlossaryTermSearchInput(event, render) {
  const input = event.target.closest("[data-glossary-term-search-input]");
  if (!input) {
    return false;
  }

  updateGlossaryTermSearchQuery(render, input.value);
  return true;
}

function handleGlossaryTermSourceInput(event) {
  const input = event.target.closest("[data-glossary-term-source-input]");
  if (!input) {
    return false;
  }

  updateGlossaryTermDraftField("sourceTermsText", input.value);
  return true;
}

function handleGlossaryTermTargetInput(event) {
  const input = event.target.closest("[data-glossary-term-target-input]");
  if (!input) {
    return false;
  }

  updateGlossaryTermDraftField("targetTermsText", input.value);
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

function handleGlossaryTermUntranslatedInput(event) {
  const input = event.target.closest("[data-glossary-term-untranslated-input]");
  if (!input) {
    return false;
  }

  updateGlossaryTermDraftField("untranslated", input.checked === true);
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
  const input = event.target.closest("[data-editor-target-language-select]");
  if (!input) {
    return false;
  }

  updateEditorTargetLanguage(render, input.value);
  return true;
}

function handleEditorRowFieldInput(event) {
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

const inputHandlers = [
  handleProjectCreationInput,
  handleProjectPermanentDeleteInput,
  handleTeamRenameInput,
  handleTeamPermanentDeleteInput,
  handleProjectRenameInput,
  handleChapterRenameInput,
  handleChapterPermanentDeleteInput,
  handleInviteUserInput,
  handleGlossariesSearchInput,
  handleGlossaryTitleInput,
  handleGlossarySourceLanguageInput,
  handleGlossaryTargetLanguageInput,
  handleGlossaryTermSearchInput,
  handleGlossaryTermSourceInput,
  handleGlossaryTermTargetInput,
  handleGlossaryTermNotesInput,
  handleGlossaryTermFootnoteInput,
  handleGlossaryTermUntranslatedInput,
  handleEditorSourceLanguageInput,
  handleEditorTargetLanguageInput,
  handleEditorRowFieldInput,
  handleEditorRowFieldChange,
];

export function handleInputEvent(event, render) {
  for (const handler of inputHandlers) {
    if (handler(event, render)) {
      break;
    }
  }
}
