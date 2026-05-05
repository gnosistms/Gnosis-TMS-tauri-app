import {
  updateAiSettingsAboutModalDontShowAgain,
  updateAiActionDetailedConfiguration,
  updateAiActionModel,
  updateAiActionProvider,
  updateAiProviderSecretDraft,
} from "./ai-settings-flow.js";
import { state } from "./state.js";
import { syncAutoSizeTextarea, syncEditorRowTextareaHeight } from "./autosize.js";
import { syncEditorVirtualizationRowLayout } from "./editor-virtualization.js";
import { applyEditorRowFieldInput } from "./editor-row-input.js";
import { syncActiveEditorInlineStyleButtons } from "./editor-inline-markup-flow.js";
import { syncGlossaryTermInlineStyleButtons } from "./glossary-term-inline-markup-flow.js";
import {
  updateProjectCreationName,
  updateProjectPermanentDeletionConfirmation,
  updateProjectRenameName,
} from "./project-flow.js";
import { updateProjectSearchQuery } from "./project-search-flow.js";
import {
  selectProjectExportFormat,
  selectProjectExportLanguage,
} from "./project-export-flow.js";
import { updateProjectAddTranslationPaste } from "./project-add-translation-flow.js";
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
  MANAGE_CHAPTER_LANGUAGES_OPTION_VALUE,
  openTargetLanguageManager,
  syncEditorGlossaryHighlightRowDom,
  updateEditorConflictResolutionFinalFootnote,
  updateEditorConflictResolutionFinalImageCaption,
  updateEditorImageUrlDraft,
  updateEditorPreviewSearchQuery,
  toggleEditorReplaceEnabled,
  toggleEditorReplaceRowSelected,
  scheduleEditorAssistantTranscriptScrollToBottom,
  updateEditorConflictResolutionFinalText,
  updateEditorFontSize,
  updateEditorCommentDraft,
  updateEditorAssistantComposerDraft,
  updateEditorAiTranslateAllLanguageSelection,
  updateEditorAiReviewAllMode,
  updateEditorClearTranslationsLanguageSelection,
  updateEditorReplaceQuery,
  updateEditorRowFilterMode,
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

function handleProjectSearchInput(event, render) {
  const input = event.target.closest("[data-project-search-input]");
  if (!input) {
    return false;
  }

  updateProjectSearchQuery(render, input.value);
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
  syncGlossaryTermInlineStyleButtons();
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
  if (event.type !== "change") {
    return false;
  }

  const input = event.target.closest("[data-editor-source-language-select]");
  if (!input) {
    return false;
  }

  if (input.value === MANAGE_CHAPTER_LANGUAGES_OPTION_VALUE) {
    if (openTargetLanguageManager(render)) {
      render();
    }
    return true;
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

  if (input.value === MANAGE_CHAPTER_LANGUAGES_OPTION_VALUE) {
    if (openTargetLanguageManager(render)) {
      render();
    }
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

function handleEditorFilterSelectInput(event, render) {
  if (event.type !== "change") {
    return false;
  }

  const input = event.target.closest("[data-editor-filter-select]");
  if (!input) {
    return false;
  }

  updateEditorRowFilterMode(render, input.value);
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

function handlePreviewSearchInput(event, render) {
  if (event.type !== "input") {
    return false;
  }

  const input = event.target.closest("[data-preview-search-input]");
  if (!input) {
    return false;
  }

  updateEditorPreviewSearchQuery(render, input.value);
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

  toggleEditorReplaceEnabled(render, input.checked, input);
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

  applyEditorRowFieldInput({
    input,
    filters: state.editorChapter?.filters,
    render,
    updateEditorRowFieldValueForContentKind: updateEditorRowFieldValue,
    syncEditorRowTextareaHeight,
    syncEditorVirtualizationRowLayout,
    syncEditorGlossaryHighlightRowDom,
  });
  if (
    state.editorChapter?.sidebarTab === "review"
    && state.editorChapter?.activeRowId === (input.dataset.rowId ?? "")
    && state.editorChapter?.activeLanguageCode === (input.dataset.languageCode ?? "")
  ) {
    render?.({ scope: "translate-sidebar" });
  }
  syncActiveEditorInlineStyleButtons();
  return true;
}

function handleEditorCommentDraftInput(event, render) {
  const input = event.target.closest("[data-editor-comment-draft]");
  if (!input) {
    return false;
  }

  updateEditorCommentDraft(input.value);
  syncAutoSizeTextarea(input, { minHeight: 88, maxHeight: 220 });
  render?.({ scope: "translate-sidebar" });
  return true;
}

function handleEditorAssistantDraftInput(event, render) {
  const input = event.target.closest("[data-editor-assistant-draft]");
  if (!input) {
    return false;
  }

  updateEditorAssistantComposerDraft(input.value);
  syncAutoSizeTextarea(input, { minHeight: 71, maxHeight: 213 });
  scheduleEditorAssistantTranscriptScrollToBottom();
  return true;
}

function handleEditorAiTranslateAllLanguageInput(event, render) {
  if (event.type !== "change") {
    return false;
  }

  const input = event.target.closest("[data-editor-ai-translate-all-language]");
  if (!(input instanceof HTMLInputElement)) {
    return false;
  }

  updateEditorAiTranslateAllLanguageSelection(render, input.value, input.checked);
  return true;
}

function handleEditorAiReviewAllModeInput(event, render) {
  if (event.type !== "change") {
    return false;
  }

  const input = event.target.closest("[data-editor-ai-review-all-mode]");
  if (!(input instanceof HTMLInputElement)) {
    return false;
  }

  updateEditorAiReviewAllMode(render, input.value);
  return true;
}

function handleEditorClearTranslationsLanguageInput(event, render) {
  if (event.type !== "change") {
    return false;
  }

  const input = event.target.closest("[data-editor-clear-translations-language]");
  if (!(input instanceof HTMLInputElement)) {
    return false;
  }

  updateEditorClearTranslationsLanguageSelection(render, input.value, input.checked);
  return true;
}

function handleEditorImageUrlInput(event) {
  const input = event.target.closest("[data-editor-image-url-input]");
  if (!input) {
    return false;
  }

  updateEditorImageUrlDraft(input.value);
  return true;
}

function handleEditorConflictResolutionInput(event) {
  const imageCaptionInput = event.target.closest("[data-editor-conflict-final-image-caption-input]");
  if (imageCaptionInput) {
    updateEditorConflictResolutionFinalImageCaption(imageCaptionInput.value);
    return true;
  }

  const footnoteInput = event.target.closest("[data-editor-conflict-final-footnote-input]");
  if (footnoteInput) {
    updateEditorConflictResolutionFinalFootnote(footnoteInput.value);
    return true;
  }

  const input = event.target.closest("[data-editor-conflict-final-input]");
  if (!input) {
    return false;
  }

  updateEditorConflictResolutionFinalText(input.value);
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

function handleProjectExportFormatInput(event, render) {
  if (event.type !== "change") {
    return false;
  }

  const input = event.target.closest("[data-project-export-format-select]");
  if (!(input instanceof HTMLSelectElement)) {
    return false;
  }

  selectProjectExportFormat(render, input.value);
  return true;
}

function handleProjectExportLanguageInput(event, render) {
  if (event.type !== "change") {
    return false;
  }

  const input = event.target.closest("[data-project-export-language-select]");
  if (!(input instanceof HTMLSelectElement)) {
    return false;
  }

  selectProjectExportLanguage(render, input.value);
  return true;
}

function handleProjectAddTranslationInput(event, render) {
  const input = event.target.closest("[data-project-add-translation-textarea]");
  if (!input) {
    return false;
  }

  updateProjectAddTranslationPaste(render, input.value);
  return true;
}

function handleAiKeyInput(event) {
  const input = event.target.closest("[data-ai-key-input]");
  if (!input) {
    return false;
  }

  updateAiProviderSecretDraft(input.value);
  return true;
}

function handleAiDetailedConfigurationInput(event, render) {
  const input = event.target.closest("[data-ai-settings-detailed-toggle]");
  if (!(input instanceof HTMLInputElement) || input.type !== "checkbox") {
    return false;
  }

  updateAiActionDetailedConfiguration(render, input.checked);
  return true;
}

function handleAiSettingsAboutModalInput(event) {
  const input = event.target.closest("[data-ai-settings-about-dismiss-toggle]");
  if (!(input instanceof HTMLInputElement) || input.type !== "checkbox") {
    return false;
  }

  updateAiSettingsAboutModalDontShowAgain(input.checked);
  return true;
}

function handleAiActionProviderInput(event, render) {
  if (event.type !== "change") {
    return false;
  }

  const input = event.target.closest("[data-ai-settings-provider-select]");
  if (!(input instanceof HTMLSelectElement)) {
    return false;
  }

  updateAiActionProvider(render, input.dataset.aiSettingsScope ?? "", input.value);
  return true;
}

function handleAiActionModelInput(event, render) {
  if (event.type !== "change") {
    return false;
  }

  const input = event.target.closest("[data-ai-settings-model-select]");
  if (!(input instanceof HTMLSelectElement)) {
    return false;
  }

  void updateAiActionModel(render, input.dataset.aiSettingsScope ?? "", input.value);
  return true;
}

const inputHandlers = [
  handleProjectCreationInput,
  handleProjectPermanentDeleteInput,
  handleTeamRenameInput,
  handleTeamPermanentDeleteInput,
  handleProjectRenameInput,
  handleProjectSearchInput,
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
  handleEditorFilterSelectInput,
  handleEditorSearchInput,
  handlePreviewSearchInput,
  handleEditorReplaceToggleInput,
  handleEditorReplaceInput,
  handleEditorReplaceRowSelectionInput,
  handleEditorRowFieldInput,
  handleEditorCommentDraftInput,
  handleEditorAssistantDraftInput,
  handleEditorAiTranslateAllLanguageInput,
  handleEditorAiReviewAllModeInput,
  handleEditorClearTranslationsLanguageInput,
  handleEditorImageUrlInput,
  handleEditorConflictResolutionInput,
  handleChapterGlossarySelectInput,
  handleProjectExportFormatInput,
  handleProjectExportLanguageInput,
  handleProjectAddTranslationInput,
  handleAiKeyInput,
  handleAiDetailedConfigurationInput,
  handleAiSettingsAboutModalInput,
  handleAiActionProviderInput,
  handleAiActionModelInput,
];

export function handleInputEvent(event, render) {
  for (const handler of inputHandlers) {
    if (handler(event, render)) {
      break;
    }
  }
}
