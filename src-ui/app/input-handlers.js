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
import { updateEditorSourceLanguage, updateEditorTargetLanguage } from "./translate-flow.js";

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

const inputHandlers = [
  handleProjectCreationInput,
  handleProjectPermanentDeleteInput,
  handleTeamRenameInput,
  handleTeamPermanentDeleteInput,
  handleProjectRenameInput,
  handleChapterRenameInput,
  handleChapterPermanentDeleteInput,
  handleInviteUserInput,
  handleEditorSourceLanguageInput,
  handleEditorTargetLanguageInput,
];

export function handleInputEvent(event, render) {
  for (const handler of inputHandlers) {
    if (handler(event, render)) {
      break;
    }
  }
}
