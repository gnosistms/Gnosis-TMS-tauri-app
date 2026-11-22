import { handleProjectBookAction } from "../project-book-flow.js";
import { reconcileEditorRowConnection } from "../editor-row-connection.js";
import { forgetPdfFontApproval, togglePdfSavedFonts } from "../editor-export-flow.js";
import { revealConnectedEditorRow } from "../editor-virtualization.js";
import { actionSuffix } from "../action-helpers.js";
import { cancelEditorImageReuse, confirmEditorImageReuse } from "../editor-image-reuse-flow.js";
import {
  assertEditorSessionWritePermission,
  assertCurrentEditorWritePermission,
  handleEditorPermissionDenied,
} from "../editor-write-permission.js";
import { waitForNextPaint } from "../runtime.js";
import { state } from "../state.js";
import { chooseEditorConflictPassage, editEditorConflictPassage, toggleEditorConflictMarkup } from "../editor-conflict-resolution-flow.js";
import { conflictReviewTargets } from "../editor-conflict-review.js";
import { dismissSrtMarkerModal } from "../editor-srt-group-edit-flow.js";
import {
  forceCloseFromEditorCloseWait,
  keepAppOpenFromEditorCloseWait,
} from "../editor-close-wait-flow.js";
import { showNoticeBadge } from "../status-feedback.js";
import {
  activeGlossaryFootnoteInsertionRequest,
  activeGlossaryTranslationCopyText,
  deactivateGlossaryTooltipMark,
} from "../events/glossary-tooltip.js";
import {
  captureLanguageToggleVisibilityAnchor,
  captureTranslateRowAnchor,
  restoreTranslateRowAnchor,
} from "../scroll-state.js";
import {
  cancelEditorConflictResolutionModal,
  cancelEditorClearTranslationsModal,
  cancelEditorDeriveGlossariesModal,
  cancelEditorAiReviewAllModal,
  cancelEditorAiTranslateAllModal,
  cancelEditorUnreviewAllModal,
  cancelEditorReplaceUndoModal,
  cancelEditorRowPermanentDeletionModal,
  cancelInsertEditorRowModal,
  cancelMergeEditorRowModal,
  closeTargetLanguageManagerPicker,
  confirmEditorUnreviewAll,
  confirmEditorAiTranslateAll,
  confirmEditorClearTranslations,
  confirmEditorDeriveGlossaries,
  confirmEditorAiReviewAll,
  confirmEditorReplaceUndo,
  confirmEditorRowPermanentDeletion,
  confirmInsertEditorRow,
  confirmMergeEditorRows,
  addTargetLanguageManagerLanguage,
  moveTargetLanguageManagerLanguageToIndex,
  openEditorFootnote,
  openEditorFootnoteEntry,
  openEditorImageCaption,
  closeTargetLanguageManager,
  openTargetLanguageManagerPicker,
  closeEditorImageUrl,
  cancelEditorImageDuplicateOverwrite,
  cancelEditorImageCaptionTranslation,
  confirmEditorImageDuplicateOverwrite,
  copyEditorImageUrl,
  duplicateEditorLanguageImage,
  duplicateEditorLanguageImageWithCaption,
  closeEditorImageInvalidFileModal,
  closeEditorImagePreview,
  closeEditorExportOptions,
  copyEditorConflictResolutionVersion,
  deleteActiveEditorRowComment,
  moveEditorPreviewSearch,
  closeEditorInsertLinkModal,
  openEditorInsertLink,
  submitEditorInsertLink,
  openEditorImagePreview,
  openEditorImageUpload,
  openEditorImageUploadPicker,
  openEditorImageUrl,
  openEditorConflictResolutionModal,
  openEditorClearTranslationsModal,
  openEditorDeriveGlossariesModal,
  openEditorAiReviewAllModal,
  openEditorAiTranslateAllModal,
  openEditorUnreviewAllModal,
  openEditorReplaceUndoModal,
  openEditorRowComments,
  openEditorRowPermanentDeletionModal,
  openInsertEditorRowModal,
  openMergeEditorRowModal,
  openEditorExportOptions,
  selectEditorExportOption,
  submitEditorExport,
  toggleEditorExportCategory,
  insertEditorSeparator,
  closeWordPressExportSuccessModal,
  connectWordPress,
  forgetWordPressSite,
  inspectWordPressSite,
  reconnectWordPress,
  saveSelfHostedWordPressSite,
  searchWordPressPosts,
  selectWordPressSite,
  selectWordPressPost,
  showAddWordPressSite,
  showWordPressSitePicker,
  cancelAddWordPressSite,
  applyEditorAiReview,
  continueEditorAiReviewAllPreflight,
  dismissEditorAiReviewAllFilterModal,
  applyEditorAssistantDraft,
  replaceSelectedEditorRows,
  reviewEditorClearTranslations,
  removeEditorLanguageImage,
  runEditorAiTranslate,
  runEditorAiAssistant,
  runEditorAiReview,
  saveEditorConflictResolution,
  resolveEditorMultipleH1Warning,
  resolveEditorRowConflict,
  restoreEditorFieldHistory,
  restoreEditorRow,
  saveActiveEditorRowComment,
  selectTargetLanguageManagerPickerLanguage,
  selectAllEditorReplaceRows,
  setEditorMode,
  setEditorSrtView,
  setActiveEditorField,
  flushDirtyEditorRows,
  showEditorRowInContext,
  softDeleteEditorRow,
  submitTargetLanguageManager,
  switchEditorSidebarTab,
  toggleEditorSearchFilterCaseSensitive,
  toggleDeletedEditorRowGroup,
  toggleEditorInlineStyle,
  toggleEditorAssistantDraftDiff,
  toggleEditorRowFieldMarker,
  toggleEditorHistoryGroupExpanded,
  toggleEditorReviewSectionExpanded,
  updateEditorRowTextStyle,
  toggleEditorLanguageCollapsed,
  dismissActiveIdleEditorImageUpload,
  removeTargetLanguageManagerLanguage,
} from "../translate-flow.js";

function reviewModeFromEvent(event) {
  const target = typeof Element !== "undefined" && event?.target instanceof Element
    ? event.target
    : null;
  return target?.closest("[data-ai-review-mode]")?.dataset.aiReviewMode ?? null;
}

// Each guarded command names its actual target. A chapter-wide command has no row,
// even when its toolbar or confirmation is used with a deleted row selected.
const SESSION_WRITE_TARGETS = new Map([
  ["add-target-language-manager-language", "chapter"],
  ["open-target-language-manager-picker", "chapter"],
  ["move-target-language-manager-language", "chapter"],
  ["remove-target-language-manager-language", "chapter"],
  ["select-target-language-manager-picker-language", "chapter"],
  ["continue-editor-ai-review-all", "chapter"],
  ["review-editor-clear-translations", "chapter"],
  ["select-all-editor-replace-rows", "chapter"],
  ["open-editor-replace-undo", "chapter"],
  ["open-editor-unreview-all", "chapter"],
  ["open-editor-ai-translate-all", "chapter"],
  ["open-editor-ai-review-all", "chapter"],
  ["open-editor-clear-translations", "chapter"],
  ["open-editor-derive-glossaries", "chapter"],
  ["review-editor-text-now", "selection"],
  ["run-editor-ai-translate", "selection"],
  ["run-editor-ai-assistant", "selection"],
  ["apply-editor-ai-review", "selection"],
  ["apply-editor-assistant-draft", "selection"],
  ["toggle-editor-reviewed", "control"],
  ["toggle-editor-please-check", "control"],
  ["set-editor-row-text-style", "control"],
  ["toggle-editor-inline-style", "control"],
  ["insert-editor-separator", "control"],
  ["open-editor-insert-link", "control"],
  ["submit-editor-insert-link", "insertLinkModal"],
  ["open-editor-footnote", "control"],
  ["open-editor-footnote-entry", "control"],
  ["insert-hovered-glossary-footnote", "glossaryFootnote"],
  ["open-editor-image-caption", "control"],
  ["open-editor-image-url", "control"],
  ["open-editor-image-upload", "control"],
  ["open-editor-image-upload-picker", "control"],
  ["open-insert-editor-row", "argument"],
  ["open-merge-editor-rows", "argument"],
  ["resolve-editor-row-conflict", "argument"],
  ["open-editor-conflict-resolution", "argument"],
  ["copy-editor-conflict-version", "conflictResolutionModal"],
  ["choose-editor-conflict-passage", "conflictResolutionModal"],
  ["edit-editor-conflict-passage", "conflictResolutionModal"],
]);

const CURRENT_WRITE_TARGETS = new Map([
  ["submit-target-language-manager", "chapter"],
  ["confirm-editor-replace-undo", "chapter"],
  ["confirm-editor-unreview-all", "chapter"],
  ["confirm-editor-ai-translate-all", "chapter"],
  ["confirm-editor-ai-review-all", "chapter"],
  ["confirm-editor-clear-translations", "chapter"],
  ["confirm-editor-derive-glossaries", "chapter"],
  ["replace-selected-editor-rows", "chapter"],
  ["confirm-insert-editor-row-before", "insertRowModal"],
  ["confirm-insert-editor-row-after", "insertRowModal"],
  ["confirm-merge-editor-rows-previous", "mergeRowModal"],
  ["confirm-merge-editor-rows-next", "mergeRowModal"],
  ["save-editor-conflict-resolution", "conflictResolutionModal"],
  ["restore-editor-history", "selection"],
  ["save-editor-comment", "selection"],
  ["delete-editor-comment", "selection"],
  ["soft-delete-editor-row", "argument"],
  ["restore-editor-row", "argument"],
  ["remove-editor-language-image", "control"],
  ["duplicate-editor-language-image", "control"],
  ["duplicate-editor-language-image-with-caption", "control"],
  ["confirm-editor-image-duplicate-overwrite", "imageDuplicateOverwriteModal"],
  ["confirm-editor-image-reuse", "imageReuseModal"],
  ["confirm-editor-multiple-h1", "pendingH1Row"],
]);

function editorWriteTargetRowId(target, argument, event) {
  switch (target) {
    case "chapter": return null;
    case "argument": return argument;
    case "selection": return state.editorChapter?.activeRowId;
    case "pendingH1Row": return state.editorChapter?.pendingH1RowId;
    case "control": return event?.target?.closest?.("[data-row-id]")?.dataset.rowId;
    case "glossaryFootnote": return activeGlossaryFootnoteInsertionRequest()?.rowId;
    default: return state.editorChapter?.[target]?.rowId;
  }
}

function blockReadOnlyWriteAction(action, render, event) {
  const [command, argument] = action.split(":", 2);
  const currentTarget = CURRENT_WRITE_TARGETS.get(command);
  const target = currentTarget ?? SESSION_WRITE_TARGETS.get(command);
  if (!target) {
    return false;
  }
  const assertWritePermission = currentTarget ? assertCurrentEditorWritePermission : assertEditorSessionWritePermission;
  try {
    assertWritePermission({
      rowId: editorWriteTargetRowId(target, argument, event),
      actionKind: command === "restore-editor-row" ? "restoreRow" : "sharedWrite",
    });
    return false;
  } catch (error) {
    if (!handleEditorPermissionDenied(error, render)) {
      showNoticeBadge(error?.message ?? String(error), render, 2600);
    }
    return true;
  }
}

export function createTranslateActions(render) {
  return async function handleTranslateAction(action, event) {
    if (blockReadOnlyWriteAction(action, render, event)) {
      return true;
    }

    const moveTargetLanguageMatch = /^move-target-language-manager-language:(\d+):(\d+)$/.exec(action);
    if (moveTargetLanguageMatch) {
      moveTargetLanguageManagerLanguageToIndex(
        Number.parseInt(moveTargetLanguageMatch[1], 10),
        Number.parseInt(moveTargetLanguageMatch[2], 10),
      );
      render();
      return true;
    }

    const removeTargetLanguageMatch = /^remove-target-language-manager-language:(\d+)$/.exec(action);
    if (removeTargetLanguageMatch) {
      removeTargetLanguageManagerLanguage(Number.parseInt(removeTargetLanguageMatch[1], 10));
      render();
      return true;
    }

    const selectedTargetLanguageCode = actionSuffix(
      action,
      "select-target-language-manager-picker-language:",
    );
    if (selectedTargetLanguageCode) {
      selectTargetLanguageManagerPickerLanguage(selectedTargetLanguageCode);
      render();
      return true;
    }

    if (action === "add-target-language-manager-language") {
      addTargetLanguageManagerLanguage();
      render();
      return true;
    }

    if (action === "close-target-language-manager") {
      closeTargetLanguageManager();
      render();
      return true;
    }

    if (action === "open-target-language-manager-picker") {
      openTargetLanguageManagerPicker();
      render();
      return true;
    }

    if (action === "close-target-language-manager-picker") {
      closeTargetLanguageManagerPicker();
      render();
      return true;
    }

    if (action === "submit-target-language-manager") {
      await submitTargetLanguageManager(render);
      return true;
    }

    if (action === "editor-close-wait-keep-open") {
      keepAppOpenFromEditorCloseWait(render);
      return true;
    }

    if (action === "editor-close-wait-force-close") {
      forceCloseFromEditorCloseWait(render);
      return true;
    }

    if (action === "cancel-insert-editor-row") {
      cancelInsertEditorRowModal();
      render();
      return true;
    }

    if (action === "cancel-merge-editor-rows") {
      cancelMergeEditorRowModal();
      render();
      return true;
    }

    if (action === "cancel-editor-row-permanent-delete") {
      cancelEditorRowPermanentDeletionModal();
      render();
      return true;
    }

    if (action === "cancel-editor-replace-undo") {
      cancelEditorReplaceUndoModal();
      render();
      return true;
    }

    if (action === "cancel-editor-unreview-all") {
      cancelEditorUnreviewAllModal(render);
      return true;
    }

    if (action === "cancel-editor-ai-translate-all") {
      cancelEditorAiTranslateAllModal(render);
      return true;
    }

    if (action === "cancel-editor-ai-review-all") {
      cancelEditorAiReviewAllModal(render);
      return true;
    }

    if (action === "cancel-editor-clear-translations") {
      cancelEditorClearTranslationsModal(render);
      return true;
    }

    if (action === "cancel-editor-derive-glossaries") {
      cancelEditorDeriveGlossariesModal(render);
      return true;
    }

    if (action === "cancel-editor-conflict-resolution") {
      cancelEditorConflictResolutionModal(render);
      return true;
    }

    if (action === "confirm-insert-editor-row-before") {
      await confirmInsertEditorRow(render, "before");
      return true;
    }

    if (action === "confirm-insert-editor-row-after") {
      await confirmInsertEditorRow(render, "after");
      return true;
    }

    if (action === "confirm-merge-editor-rows-previous") {
      await confirmMergeEditorRows(render, "previous");
      return true;
    }

    if (action === "confirm-merge-editor-rows-next") {
      await confirmMergeEditorRows(render, "next");
      return true;
    }

    if (action === "confirm-editor-row-permanent-delete") {
      await confirmEditorRowPermanentDeletion(render);
      return true;
    }

    if (action === "confirm-editor-image-duplicate-overwrite") {
      await confirmEditorImageDuplicateOverwrite(render);
      return true;
    }

    if (action === "cancel-editor-image-duplicate-overwrite") {
      cancelEditorImageDuplicateOverwrite(render);
      return true;
    }

    if (action === "confirm-editor-image-reuse") {
      await confirmEditorImageReuse(render);
      return true;
    }

    if (action === "cancel-editor-image-reuse") {
      cancelEditorImageReuse(render);
      return true;
    }

    if (action === "cancel-editor-image-caption-translation") {
      cancelEditorImageCaptionTranslation(render);
      return true;
    }

    if (action === "confirm-editor-replace-undo") {
      await confirmEditorReplaceUndo(render);
      return true;
    }

    if (action === "confirm-editor-unreview-all") {
      await confirmEditorUnreviewAll(render);
      return true;
    }

    if (action === "confirm-editor-ai-translate-all") {
      await confirmEditorAiTranslateAll(render);
      return true;
    }

    if (action === "continue-editor-ai-review-all") {
      continueEditorAiReviewAllPreflight(render);
      return true;
    }

    if (action === "confirm-editor-ai-review-all") {
      await confirmEditorAiReviewAll(render);
      return true;
    }

    if (action === "dismiss-editor-ai-review-all-filter") {
      dismissEditorAiReviewAllFilterModal(render);
      return true;
    }

    if (action === "review-editor-clear-translations") {
      reviewEditorClearTranslations(render);
      return true;
    }

    if (action === "confirm-editor-clear-translations") {
      await confirmEditorClearTranslations(render);
      return true;
    }

    if (action === "confirm-editor-derive-glossaries") {
      await confirmEditorDeriveGlossaries(render);
      return true;
    }

    if (action === "save-editor-conflict-resolution") {
      await saveEditorConflictResolution(render);
      return true;
    }

    if (action === "toggle-editor-conflict-markup") {
      toggleEditorConflictMarkup(render);
      return true;
    }
    const passageChoice = actionSuffix(action, "choose-editor-conflict-passage:");
    if (passageChoice !== null) {
      const [id, side] = passageChoice.split(":");
      chooseEditorConflictPassage(render, id, side);
      return true;
    }
    const passageEdit = actionSuffix(action, "edit-editor-conflict-passage:");
    if (passageEdit !== null) {
      editEditorConflictPassage(render, passageEdit);
      return true;
    }
    const conflictNavigation = actionSuffix(action, "navigate-editor-conflict:");
    if (conflictNavigation !== null) {
      const modal = state.editorChapter?.conflictResolutionModal;
      if (!modal?.isOpen || modal.status === "loading") return true;
      const targets = conflictReviewTargets(state.editorChapter);
      const index = targets.findIndex((t) => t.rowId === modal.rowId && t.languageCode === modal.languageCode);
      const target = targets[index + (conflictNavigation === "previous" ? -1 : 1)];
      if (target) {
        document.querySelector(".modal-card--editor-conflict")?.scrollTo(0, 0);
        openEditorConflictResolutionModal(render, target.rowId, target.languageCode);
      }
      return true;
    }

    if (action === "select-all-editor-replace-rows") {
      selectAllEditorReplaceRows(render);
      return true;
    }

    if (action === "replace-selected-editor-rows") {
      await replaceSelectedEditorRows(render);
      return true;
    }

    if (action === "save-editor-comment") {
      await saveActiveEditorRowComment(render);
      return true;
    }

    const reviewEditorTextNowMode = actionSuffix(action, "review-editor-text-now:");
    if (reviewEditorTextNowMode !== null) {
      await runEditorAiReview(render, reviewModeFromEvent(event) ?? reviewEditorTextNowMode);
      return true;
    }

    if (action === "review-editor-text-now") {
      await runEditorAiReview(render, reviewModeFromEvent(event) ?? "grammar");
      return true;
    }

    if (action === "run-editor-ai-translate:translate1") {
      await runEditorAiTranslate(render, "translate1");
      return true;
    }

    if (action === "run-editor-ai-translate:translate2") {
      await runEditorAiTranslate(render, "translate2");
      return true;
    }

    if (action === "run-editor-ai-assistant") {
      await runEditorAiAssistant(render);
      return true;
    }

    if (action === "apply-editor-ai-review") {
      await applyEditorAiReview(render);
      return true;
    }

    if (action === "toggle-editor-search-case-sensitive") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-editor-search-case-toggle]")
        : null;
      const nextPressed = button?.getAttribute("aria-pressed") !== "true";
      toggleEditorSearchFilterCaseSensitive(render, nextPressed);
      return true;
    }

    if (action === "toggle-editor-reviewed" || action === "toggle-editor-please-check") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-row-id][data-language-code]")
        : null;
      const rowId = button?.dataset.rowId ?? null;
      const languageCode = button?.dataset.languageCode ?? null;
      const kind = action === "toggle-editor-reviewed" ? "reviewed" : "please-check";
      await toggleEditorRowFieldMarker(render, rowId, languageCode, kind, {
        target: event?.target ?? null,
      });
      return true;
    }

    if (action === "select-editor-row-language") {
      const panel = event?.target?.closest?.("[data-editor-language-panel]");
      if (panel) {
        await setActiveEditorField(render, panel.dataset.rowId, panel.dataset.languageCode);
      }
      return true;
    }

    if (action === "open-editor-comments") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-row-id][data-language-code]")
        : null;
      const rowId = button?.dataset.rowId ?? null;
      const languageCode = button?.dataset.languageCode ?? null;
      openEditorRowComments(render, rowId, languageCode);
      return true;
    }

    if (action === "open-editor-unreview-all") {
      openEditorUnreviewAllModal(render);
      return true;
    }

    if (action === "open-editor-ai-translate-all") {
      openEditorAiTranslateAllModal(render);
      return true;
    }

    if (action === "open-editor-ai-review-all") {
      openEditorAiReviewAllModal(render);
      return true;
    }

    if (action === "open-editor-clear-translations") {
      openEditorClearTranslationsModal(render);
      return true;
    }

    if (action === "open-editor-derive-glossaries") {
      openEditorDeriveGlossariesModal(render);
      return true;
    }

    if (action === "set-editor-row-text-style") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-row-id][data-text-style]")
        : null;
      const rowId = button?.dataset.rowId ?? null;
      const textStyle = button?.dataset.textStyle ?? null;
      await updateEditorRowTextStyle(render, rowId, textStyle);
      return true;
    }

    if (action === "confirm-editor-multiple-h1" || action === "cancel-editor-multiple-h1") {
      await resolveEditorMultipleH1Warning(render, action === "confirm-editor-multiple-h1");
      return true;
    }

    if (action === "toggle-editor-inline-style") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-editor-inline-style-button]")
        : null;
      toggleEditorInlineStyle(render, button);
      return true;
    }

    if (action === "insert-editor-separator") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-editor-separator-button]")
        : null;
      insertEditorSeparator(render, button);
      return true;
    }

    if (action === "open-editor-insert-link") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-editor-link-button]")
        : null;
      openEditorInsertLink(render, button);
      return true;
    }

    if (action === "submit-editor-insert-link") {
      submitEditorInsertLink(render);
      return true;
    }

    if (action === "close-editor-insert-link-modal") {
      closeEditorInsertLinkModal(render);
      return true;
    }

    if (action === "close-wordpress-export-success-modal") {
      closeWordPressExportSuccessModal(render);
      return true;
    }

    if (action === "open-editor-footnote") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-row-id][data-language-code]")
        : null;
      dismissActiveIdleEditorImageUpload(render);
      const rowId = button?.dataset.rowId ?? null;
      const languageCode = button?.dataset.languageCode ?? null;
      await openEditorFootnote(render, rowId, languageCode, { target: event?.target ?? null });
      return true;
    }

    if (action === "insert-hovered-glossary-footnote") {
      const request = activeGlossaryFootnoteInsertionRequest();
      if (!request) {
        return true;
      }
      dismissActiveIdleEditorImageUpload(render);
      deactivateGlossaryTooltipMark();
      await openEditorFootnote(render, request.rowId, request.languageCode, {
        visibleInsertIndex: request.visibleInsertIndex,
        footnoteText: request.footnoteText,
      });
      return true;
    }

    if (action === "copy-hovered-glossary-translation") {
      const text = activeGlossaryTranslationCopyText();
      if (!text) {
        return true;
      }
      try {
        if (typeof navigator === "undefined" || typeof navigator.clipboard?.writeText !== "function") {
          throw new Error("Clipboard access is not available.");
        }
        await navigator.clipboard.writeText(text);
        showNoticeBadge("Translation copied.", render);
      } catch {
        showNoticeBadge("The translation could not be copied.", render);
      }
      return true;
    }

    if (action === "open-editor-footnote-entry") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-editor-footnote-display]")
        : null;
      const rowId = button?.dataset.rowId ?? null;
      const languageCode = button?.dataset.languageCode ?? null;
      const marker = button?.dataset.footnoteMarker ?? null;
      openEditorFootnoteEntry(render, rowId, languageCode, marker, { target: event?.target ?? null });
      return true;
    }

    if (action === "open-editor-image-caption") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-row-id][data-language-code]")
        : null;
      dismissActiveIdleEditorImageUpload(render);
      const rowId = button?.dataset.rowId ?? null;
      const languageCode = button?.dataset.languageCode ?? null;
      openEditorImageCaption(render, rowId, languageCode, { target: event?.target ?? null });
      return true;
    }

    if (action === "open-editor-image-url") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-row-id][data-language-code]")
        : null;
      openEditorImageUrl(render, button?.dataset.rowId ?? null, button?.dataset.languageCode ?? null);
      return true;
    }

    if (action === "close-editor-image-url") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-row-id][data-language-code]")
        : null;
      closeEditorImageUrl(render, button?.dataset.rowId ?? null, button?.dataset.languageCode ?? null);
      return true;
    }

    if (action === "open-editor-image-upload") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-row-id][data-language-code]")
        : null;
      openEditorImageUpload(render, button?.dataset.rowId ?? null, button?.dataset.languageCode ?? null);
      return true;
    }

    if (action === "open-editor-image-upload-picker") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-row-id][data-language-code]")
        : null;
      await openEditorImageUploadPicker(render, button?.dataset.rowId ?? null, button?.dataset.languageCode ?? null);
      return true;
    }

    if (action === "close-editor-image-upload") {
      dismissActiveIdleEditorImageUpload(render);
      return true;
    }

    if (action === "remove-editor-language-image") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-row-id][data-language-code]")
        : null;
      await removeEditorLanguageImage(render, button?.dataset.rowId ?? null, button?.dataset.languageCode ?? null);
      return true;
    }

    if (action === "copy-editor-image-url") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-image-url]")
        : null;
      await copyEditorImageUrl(render, button?.dataset.imageUrl ?? "");
      return true;
    }

    if (action === "duplicate-editor-language-image") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-row-id][data-source-language-code][data-destination-language-code]")
        : null;
      await duplicateEditorLanguageImage(
        render,
        button?.dataset.rowId ?? "",
        button?.dataset.sourceLanguageCode ?? "",
        button?.dataset.destinationLanguageCode ?? "",
      );
      return true;
    }

    if (action === "duplicate-editor-language-image-with-caption") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-row-id][data-source-language-code][data-destination-language-code]")
        : null;
      await duplicateEditorLanguageImageWithCaption(
        render,
        button?.dataset.rowId ?? "",
        button?.dataset.sourceLanguageCode ?? "",
        button?.dataset.destinationLanguageCode ?? "",
      );
      return true;
    }

    if (action === "open-editor-image-preview") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-row-id][data-language-code]")
        : null;
      openEditorImagePreview(render, button?.dataset.rowId ?? null, button?.dataset.languageCode ?? null);
      return true;
    }

    if (action === "close-editor-image-preview") {
      closeEditorImagePreview(render);
      return true;
    }

    if (action === "close-editor-image-invalid-file-modal") {
      closeEditorImageInvalidFileModal(render);
      return true;
    }

    if (await handleProjectBookAction(action, render)) return true;

    if (action === "open-editor-export-options") {
      openEditorExportOptions(render);
      return true;
    }

    if (action === "close-editor-export-options") {
      closeEditorExportOptions(render);
      return true;
    }

    if (action === "submit-editor-export") {
      await submitEditorExport(render);
      return true;
    }

    if (action === "toggle-pdf-saved-fonts") {
      togglePdfSavedFonts(render);
      return true;
    }

    if (action.startsWith("forget-pdf-font-approval:")) {
      await forgetPdfFontApproval(render, action.slice("forget-pdf-font-approval:".length));
      return true;
    }

    if (action === "connect-wordpress") {
      await connectWordPress(render);
      return true;
    }

    if (action === "show-wordpress-site-picker") {
      showWordPressSitePicker(render);
      return true;
    }

    if (action === "show-add-wordpress-site") {
      showAddWordPressSite(render);
      return true;
    }
    if (action === "cancel-add-wordpress-site") {
      cancelAddWordPressSite(render);
      return true;
    }
    if (action === "inspect-wordpress-site") {
      await inspectWordPressSite(render);
      return true;
    }
    if (action === "save-self-hosted-wordpress-site") {
      await saveSelfHostedWordPressSite(render);
      return true;
    }
    if (action === "reconnect-wordpress") {
      reconnectWordPress(render);
      return true;
    }

    if (action === "search-wordpress-posts") {
      await searchWordPressPosts(render);
      return true;
    }

    if (action === "step-editor-preview-search:previous") {
      moveEditorPreviewSearch(render, "previous");
      return true;
    }

    if (action === "step-editor-preview-search:next") {
      moveEditorPreviewSearch(render, "next");
      return true;
    }

    const exportCategoryId = actionSuffix(action, "toggle-editor-export-category:");
    if (exportCategoryId !== null) {
      toggleEditorExportCategory(render, exportCategoryId);
      return true;
    }

    const exportOptionId = actionSuffix(action, "select-editor-export-option:");
    if (exportOptionId !== null) {
      selectEditorExportOption(render, exportOptionId);
      return true;
    }

    const wordpressPostId = actionSuffix(action, "select-wordpress-post:");
    if (wordpressPostId !== null) {
      selectWordPressPost(render, wordpressPostId);
      return true;
    }

    const wordpressSiteId = actionSuffix(action, "select-wordpress-site:");
    if (wordpressSiteId !== null) {
      selectWordPressSite(render, wordpressSiteId);
      return true;
    }
    const forgottenWordPressSiteId = actionSuffix(action, "forget-wordpress-site:");
    if (forgottenWordPressSiteId !== null) {
      await forgetWordPressSite(render, forgottenWordPressSiteId);
      return true;
    }

    const historyCommitSha = actionSuffix(action, "restore-editor-history:");
    if (historyCommitSha !== null) {
      await restoreEditorFieldHistory(render, historyCommitSha);
      return true;
    }

    const undoReplaceCommitSha = actionSuffix(action, "open-editor-replace-undo:");
    if (undoReplaceCommitSha !== null) {
      openEditorReplaceUndoModal(undoReplaceCommitSha);
      render();
      return true;
    }

    const historyGroupKey = actionSuffix(action, "toggle-editor-history-group:");
    if (historyGroupKey !== null) {
      toggleEditorHistoryGroupExpanded(historyGroupKey);
      render();
      return true;
    }

    const reviewSectionKey = actionSuffix(action, "toggle-editor-review-section:");
    if (reviewSectionKey !== null) {
      toggleEditorReviewSectionExpanded(reviewSectionKey);
      render();
      return true;
    }

    const deletedRowGroupKey = actionSuffix(action, "toggle-editor-deleted-row-group:");
    if (deletedRowGroupKey !== null) {
      const scrollAnchor = captureTranslateRowAnchor(event?.target ?? null);
      toggleDeletedEditorRowGroup(render, deletedRowGroupKey, scrollAnchor);
      return true;
    }

    if (action === "show-connected-editor-row") {
      if (reconcileEditorRowConnection(state)) {
        render?.({ scope: "translate-body" });
        return true;
      }
      revealConnectedEditorRow();
      return true;
    }

    const sidebarTab = actionSuffix(action, "switch-editor-sidebar-tab:");
    if (sidebarTab !== null) {
      switchEditorSidebarTab(render, sidebarTab);
      return true;
    }

    const commentId = actionSuffix(action, "delete-editor-comment:");
    if (commentId !== null) {
      await deleteActiveEditorRowComment(render, commentId);
      return true;
    }

    const assistantDraftId = actionSuffix(action, "apply-editor-assistant-draft:");
    if (assistantDraftId !== null) {
      await applyEditorAssistantDraft(render, assistantDraftId);
      return true;
    }

    const assistantDraftDiffId = actionSuffix(action, "toggle-editor-assistant-draft-diff:");
    if (assistantDraftDiffId !== null) {
      toggleEditorAssistantDraftDiff(render, assistantDraftDiffId);
      return true;
    }

    const copyConflictSide = actionSuffix(action, "copy-editor-conflict-version:");
    if (copyConflictSide !== null) {
      await copyEditorConflictResolutionVersion(render, copyConflictSide);
      return true;
    }

    const insertRowId = actionSuffix(action, "open-insert-editor-row:");
    if (insertRowId !== null) {
      openInsertEditorRowModal(insertRowId);
      render();
      return true;
    }

    const mergeRowId = actionSuffix(action, "open-merge-editor-rows:");
    if (mergeRowId !== null) {
      openMergeEditorRowModal(mergeRowId);
      render();
      return true;
    }

    const softDeleteRowId = actionSuffix(action, "soft-delete-editor-row:");
    if (softDeleteRowId !== null) {
      const scrollAnchor = captureTranslateRowAnchor(event?.target ?? null);
      await softDeleteEditorRow(render, softDeleteRowId, scrollAnchor);
      return true;
    }

    const restoreRowId = actionSuffix(action, "restore-editor-row:");
    if (restoreRowId !== null) {
      await restoreEditorRow(render, restoreRowId);
      return true;
    }

    const showInContextRowId = actionSuffix(action, "show-editor-row-in-context:");
    if (showInContextRowId !== null) {
      await showEditorRowInContext(render, showInContextRowId);
      return true;
    }

    const permanentDeleteRowId = actionSuffix(action, "open-editor-row-permanent-delete:");
    if (permanentDeleteRowId !== null) {
      openEditorRowPermanentDeletionModal(permanentDeleteRowId);
      render();
      return true;
    }

    const conflictAction = actionSuffix(action, "resolve-editor-row-conflict:");
    if (conflictAction !== null) {
      const [rowId, resolution] = conflictAction.split(":");
      await resolveEditorRowConflict(render, rowId, resolution);
      return true;
    }

    const conflictModalAction = actionSuffix(action, "open-editor-conflict-resolution:");
    if (conflictModalAction !== null) {
      const [rowId, languageCode] = conflictModalAction.split(":");
      openEditorConflictResolutionModal(render, rowId, languageCode);
      return true;
    }

    const languageCode = actionSuffix(action, "toggle-editor-language:");
    if (languageCode !== null) {
      const scrollAnchor = captureLanguageToggleVisibilityAnchor(
        event?.target ?? null,
        state.editorChapter?.collapsedLanguageCodes,
        state.editorChapter?.languages,
      );
      toggleEditorLanguageCollapsed(languageCode);
      render();
      if (scrollAnchor) {
        void waitForNextPaint().then(() => restoreTranslateRowAnchor(scrollAnchor));
      }
      return true;
    }

    const srtView = actionSuffix(action, "set-editor-srt-view:");
    if (srtView !== null) {
      await setEditorSrtView(render, srtView);
      return true;
    }
    const historyFragment = actionSuffix(action, "select-editor-srt-history:");
    if (historyFragment !== null) {
      if (await flushDirtyEditorRows(render)) await setActiveEditorField(render, historyFragment, state.editorChapter.activeLanguageCode);
      return true;
    }
    if (action === "dismiss-editor-srt-marker-modal") { dismissSrtMarkerModal(render); return true; }
    if (action === "save-editor-srt-drafts") {
      if (await flushDirtyEditorRows(render, { confirmSrtMarkerRepair: true })) render?.({ scope: "translate-body" });
      return true;
    }

    const editorMode = actionSuffix(action, "set-editor-mode:");
    if (editorMode !== null) {
      await setEditorMode(render, editorMode);
      return true;
    }

    return false;
  };
}
