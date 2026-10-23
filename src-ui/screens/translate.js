import {
  actionNavButton,
  buildPageRefreshAction,
  escapeHtml,
  navButton,
  pageShell,
  renderSelectPillControl,
  tooltipAttributes,
} from "../lib/ui.js";
import {
  changedAfterMyEditFilterIsActive,
  changedAfterMyEditStateForChapter,
} from "../app/editor-changed-after-my-edit-flow.js";
import {
  buildEditorPreviewDocument,
  EDITOR_MODE_PREVIEW,
  normalizeEditorMode,
  renderEditorPreviewDocumentHtml,
  selectedEditorPreviewLanguageCode,
} from "../app/editor-preview.js";
import { buildEditorScreenViewModel } from "../app/editor-screen-model.js";
import { chapterHasSrtSourceFormat } from "../app/editor-timing.js";
import { SRT_PAUSE_THRESHOLDS_MS, srtGroupForRow } from "../app/editor-srt-grouping.js";
import { renderTranslationContentRows } from "../app/editor-row-render.js";
import { convertLocalFileSrc } from "../app/runtime.js";
import { getNoticeBadgeText } from "../app/status-feedback.js";
import { MANAGE_CHAPTER_LANGUAGES_OPTION_VALUE } from "../app/translate-flow.js";
import { renderEditorRowInsertModal } from "./editor-row-insert-modal.js";
import { renderEditorRowMergeModal } from "./editor-row-merge-modal.js";
import { renderEditorRowPermanentDeletionModal } from "./editor-row-permanent-deletion-modal.js";
import { renderEditorUnreviewAllModal } from "./editor-unreview-all-modal.js";
import { renderEditorExportModal } from "./editor-export-modal.js";
import { renderEditorAiReviewAllModal } from "./editor-ai-review-all-modal.js";
import { renderEditorAiTranslateAllModal } from "./editor-ai-translate-all-modal.js";
import { renderEditorClearTranslationsModal } from "./editor-clear-translations-modal.js";
import { renderEditorDeriveGlossariesModal } from "./editor-derive-glossaries-modal.js";
import { renderEditorConflictResolutionModal } from "./editor-conflict-resolution-modal.js";
import { renderEditorImageInvalidFileModal } from "./editor-image-invalid-file-modal.js";
import { renderEditorImagePreviewOverlay } from "./editor-image-preview-overlay.js";
import { renderEditorImageDuplicateOverwriteModal } from "./editor-image-duplicate-overwrite-modal.js";
import { renderEditorImageCaptionTranslationModal } from "./editor-image-caption-translation-modal.js";
import { renderEditorInsertLinkModal } from "./editor-insert-link-modal.js";
import { renderEditorWordPressExportSuccessModal } from "./editor-wordpress-export-success-modal.js";
import { renderEditorReplaceUndoModal } from "./editor-replace-undo-modal.js";
import { renderAiReviewMissingKeyModal } from "./ai-review-missing-key-modal.js";
import { renderEditorCloseWaitModal } from "./editor-close-wait-modal.js";
import { renderEditorSrtMarkerModal } from "./editor-srt-marker-modal.js";
import { renderTargetLanguageManagerModal } from "./target-language-manager-modal.js";
import { renderTranslateSidebar as renderTranslateEditorSidebar } from "./translate-sidebar.js";
import { resolveSelectedChapterGlossary } from "../app/project-context.js";
import { resolveEditorDeriveGlossariesConfig } from "../app/editor-derive-glossaries-flow.js";
import { editorSessionCanWrite } from "../app/editor-write-permission.js";
import {
  renderEditorConflictBanner,
  renderEditorFilterBanner,
  renderEditorSyncBanner,
  renderTranslateModeControl,
  renderPreviewToolbar,
  renderTranslateToolbar,
} from "./translate-toolbar.js";

function middleTruncateTitle(value, maxLength = 34) {
  const text = String(value ?? "");
  if (text.length <= maxLength) {
    return text;
  }

  const ellipsis = "...";
  const remaining = maxLength - ellipsis.length;
  const startLength = Math.ceil(remaining / 2);
  const endLength = Math.floor(remaining / 2);
  return `${text.slice(0, startLength)}${ellipsis}${text.slice(text.length - endLength)}`;
}

function renderTranslateStateCard(message) {
  return `
    <article class="card card--translation">
      <div class="card__body">
        <p>${escapeHtml(message)}</p>
      </div>
    </article>
  `;
}

function renderSrtDraftRecovery(chapter) {
  return Object.values(chapter?.srtGroupEdits ?? {}).filter((edit) => edit.draft !== edit.savedDraft
    && srtGroupForRow(chapter, edit.firstRowId).map((row) => row.rowId).join(":") !== edit.memberRowIds.join(":"))
    .map((edit) => `<article class="card card--translation"><div class="card__body">
      <p>A subtitle in this sentence changed or was deleted. Your sentence draft is preserved below. Resolve the affected subtitle before saving the draft.</p>
      <textarea data-editor-srt-recovery data-row-id="${escapeHtml(edit.firstRowId)}" data-language-code="${escapeHtml(edit.languageCode)}"
        aria-label="Preserved sentence draft" rows="4">${escapeHtml(edit.draft)}</textarea>
      ${edit.error ? `<p class="translation-srt-error" role="alert">${escapeHtml(edit.error)}</p>` : ""}
      <button type="button" data-action="save-editor-srt-drafts">Save sentence draft</button>
    </div></article>`).join("");
}

function resolvePreviewImageSrc(image) {
  if (!image) {
    return "";
  }

  if (image.kind === "url") {
    return image.url ?? "";
  }

  return convertLocalFileSrc(image.filePath ?? "");
}

function buildTranslateScreenFrame(state) {
  const {
    chapter,
    editorChapter,
    languages,
    sourceCode,
    targetCode,
    contentRows,
    editorFilters,
    editorReplace,
    collapsedLanguageCodes,
    editorFontSizePx,
    sidebarTab,
  } = buildEditorScreenViewModel(state);
  const mode = normalizeEditorMode(editorChapter?.mode);
  const authSession = state.auth?.session ?? null;
  const titleText = chapter?.name ?? editorChapter?.fileTitle ?? "Translate";
  const displayTitle = middleTruncateTitle(titleText);
  const previewCode = selectedEditorPreviewLanguageCode(editorChapter);

  let translateBody = "";
  if (editorChapter?.status === "loading") {
    translateBody = renderTranslateStateCard("Loading file...");
  } else if (editorChapter?.status === "error") {
    translateBody = renderTranslateStateCard(editorChapter.error || "The file could not be loaded.");
  } else if (!chapter && !editorChapter?.chapterId) {
    translateBody = renderTranslateStateCard("Could not determine which file to open.");
  } else if (contentRows.length === 0) {
    const changedAfterMyEdit = changedAfterMyEditFilterIsActive(editorChapter)
      ? changedAfterMyEditStateForChapter(editorChapter)
      : null;
    translateBody = renderTranslateStateCard(
      changedAfterMyEdit?.status === "loading"
        ? "Finding rows changed after your last edit..."
        : changedAfterMyEdit?.status === "error"
        ? changedAfterMyEdit.error || "The rows changed after your last edit could not be loaded."
        : editorFilters?.hasActiveFilters
        ? "No rows match the current filters."
        : "This file does not contain any translatable rows.",
    );
  } else {
    translateBody = renderTranslationContentRows(
      contentRows,
      collapsedLanguageCodes,
      editorFontSizePx,
      editorReplace,
      editorChapter,
    );
  }

  const previewBlocks =
    (editorChapter?.status === "ready" || editorChapter?.status === "refreshing")
      ? buildEditorPreviewDocument(editorChapter.rows, previewCode)
      : [];
  const previewRender = renderEditorPreviewDocumentHtml(previewBlocks, {
    searchState: editorChapter?.previewSearch,
    resolveImageSrc: resolvePreviewImageSrc,
  });
  let previewBody = "";
  if (editorChapter?.status === "loading") {
    previewBody = renderTranslateStateCard("Loading file...");
  } else if (editorChapter?.status === "error") {
    previewBody = renderTranslateStateCard(editorChapter.error || "The file could not be loaded.");
  } else if (!chapter && !editorChapter?.chapterId) {
    previewBody = renderTranslateStateCard("Could not determine which file to open.");
  } else if (previewBlocks.length === 0) {
    previewBody = renderTranslateStateCard("This file does not contain any previewable rows.");
  } else {
    previewBody = previewRender.html;
  }

  return {
    chapter,
    editorChapter,
    mode,
    languages,
    sourceCode,
    targetCode,
    previewCode,
    actionConfig: state.aiSettings.actionConfig,
    contentRows,
    editorFilters,
    editorReplace,
    collapsedLanguageCodes,
    editorFontSizePx,
    sidebarTab,
    offlineMode: state.offline?.isEnabled === true,
    authSession,
    titleText,
    displayTitle,
    translateBody,
    previewBlocks,
    previewBody,
    previewSearchState: previewRender.searchState,
  };
}

function renderTranslateEditorBodyFromFrame(frame) {
  const {
    mode,
    editorChapter,
    languages,
    sourceCode,
    targetCode,
    actionConfig,
    contentRows,
    editorFilters,
    editorReplace,
    editorFontSizePx,
    translateBody,
    authSession,
    previewBody,
    offlineMode,
  } = frame;

  if (mode === EDITOR_MODE_PREVIEW) {
    return `
      <section class="translate-layout translate-layout--preview" style="--translation-editor-font-size: ${escapeHtml(String(editorFontSizePx))}px;">
        <div class="translate-main-scroll translate-main-scroll--preview">
          <div class="translate-preview">
            <article class="translate-preview__document" data-editor-preview-document>
              ${previewBody}
            </article>
          </div>
        </div>
      </section>
    `;
  }

  return `
    <section class="translate-layout" style="--translation-editor-font-size: ${escapeHtml(String(editorFontSizePx))}px;">
      <div class="translate-main-scroll">
        <div class="translate-main${editorReplace?.isEnabled ? " translate-main--replace-mode" : ""}">
          ${chapterHasSrtSourceFormat(editorChapter?.sourceFormats) ? `
            <div class="translation-srt-view-options">
              <div class="translation-srt-view-control segmented-control" role="group" aria-label="Subtitle view">
                ${[["standard", "Standard"], ["group-fragments", "Group fragments"]].map(([value, label]) => `
                  <button type="button" data-action="set-editor-srt-view:${value}"
                    ${value === "group-fragments" ? tooltipAttributes("Display with sentence fragments grouped into complete sentences for easier reading and editing.", { side: "bottom", align: "start" }) : ""}
                    aria-pressed="${(editorChapter.srtViewMode ?? "standard") === value}"
                    class="translation-srt-view-control__option segmented-control__button${(editorChapter.srtViewMode ?? "standard") === value ? " is-active" : ""}">${label}</button>`).join("")}
              </div>
              ${editorChapter.srtViewMode === "group-fragments" ? `
                <div class="translation-srt-pause-control"${tooltipAttributes("Sometimes sentences run on long with no punctuation. In that case, you may want to split groups at pauses.", { side: "bottom", align: "start" })}>
                  <label class="translation-srt-pause-control__label">
                    <input type="checkbox" class="editor-checkbox" data-editor-srt-pause-toggle${editorChapter.srtPauseSplitEnabled ? " checked" : ""}>
                    <span>Split groups at pauses longer than</span>
                  </label>
                  ${renderSelectPillControl({
                    className: "select-pill--toolbar translation-srt-pause-control__threshold",
                    value: String((editorChapter.srtPauseThresholdMs ?? 500) / 1000),
                    selectAttributes: { "data-editor-srt-pause-threshold": true, "aria-label": "Pause length in seconds" },
                    options: SRT_PAUSE_THRESHOLDS_MS.map((ms) => ({ value: String(ms), label: String(ms / 1000), selected: (editorChapter.srtPauseThresholdMs ?? 500) === ms })),
                  })}
                  <span>seconds.</span>
              </div>` : ""}
            </div>` : ""}
          ${renderEditorConflictBanner(editorFilters)}
          ${renderEditorFilterBanner(editorFilters)}
          ${renderEditorSyncBanner(editorChapter)}
          ${renderSrtDraftRecovery(editorChapter)}
          ${translateBody}
        </div>
      </div>
      <div class="translate-sidebar-scroll">
        ${renderTranslateEditorSidebar(
          editorChapter,
          contentRows,
          languages,
          sourceCode,
          targetCode,
          actionConfig,
          authSession,
          offlineMode,
        )}
      </div>
    </section>
  `;
}

export function renderTranslateEditorBody(state) {
  return renderTranslateEditorBodyFromFrame(buildTranslateScreenFrame(state));
}

export function renderTranslateHeaderDetail(state) {
  const frame = buildTranslateScreenFrame(state);
  const {
    mode,
    languages,
    sourceCode,
    targetCode,
    previewCode,
    editorFilters,
    editorReplace,
    editorFontSizePx,
    previewSearchState,
    offlineMode,
    editorChapter,
  } = frame;
  const targetLanguageManageOption = [{
    value: MANAGE_CHAPTER_LANGUAGES_OPTION_VALUE,
    label: "Add / Remove",
  }];
  const writeActionsAvailable = editorSessionCanWrite(editorChapter);
  const chapterLanguageManagerOptions =
    writeActionsAvailable && !offlineMode
      ? targetLanguageManageOption
      : [];

  if (mode === EDITOR_MODE_PREVIEW) {
    return renderPreviewToolbar({
      languages,
      previewCode,
      previewSearchState,
    });
  }

  return renderTranslateToolbar({
    languages,
    sourceCode,
    targetCode,
    editorFilters,
    editorReplace,
    editorFontSizePx,
    sourceLanguageExtraOptions: chapterLanguageManagerOptions,
    targetLanguageExtraOptions: chapterLanguageManagerOptions,
    deriveGlossariesAvailable: resolveEditorDeriveGlossariesConfig(frame.editorChapter).canDerive,
    clearTranslationsAvailable: languages.length > 0,
    writeActionsAvailable,
    offlineMode,
    timingErrorFilterAvailable: chapterHasSrtSourceFormat(editorChapter?.sourceFormats),
  });
}

export function renderTranslateSidebar(state) {
  const frame = buildTranslateScreenFrame(state);
  if (frame.mode === EDITOR_MODE_PREVIEW) {
    return "";
  }

  const {
    editorChapter,
    contentRows,
    languages,
    sourceCode,
    targetCode,
    authSession,
    offlineMode,
  } = buildTranslateScreenFrame(state);
  const writeActionsAvailable = editorSessionCanWrite(frame.editorChapter);
  return renderTranslateEditorSidebar(
    editorChapter,
    contentRows,
    languages,
    sourceCode,
    targetCode,
    state.aiSettings.actionConfig,
    authSession,
    offlineMode,
    writeActionsAvailable,
  );
}

export function renderTranslateScreen(state) {
  const frame = buildTranslateScreenFrame(state);
  const { titleText, displayTitle, mode } = frame;
  const linkedGlossary = resolveSelectedChapterGlossary(state.glossaries);
  const navButtons = [
    navButton("Projects", "projects", false, { isBack: true }),
    actionNavButton("Glossary", "open-editor-glossary", false, {
      disabled: !linkedGlossary?.repoName,
    }),
    actionNavButton("QA", "open-editor-qa"),
  ];

  return pageShell({
    title: displayTitle,
    titleTooltip: titleText,
    headerClass: "page-header--editor",
    bodyClass: "page-body--editor",
    titleAction: buildPageRefreshAction(state),
    navButtons,
    tools: renderTranslateModeControl(mode),
    headerBody: renderTranslateHeaderDetail(state),
    pageSync: state.pageSync,
    noticeText: getNoticeBadgeText(),
    offlineMode: state.offline?.isEnabled === true,
    offlineReconnectState: state.offline?.reconnecting === true,
    body: renderTranslateEditorBodyFromFrame(frame),
  }) + renderTargetLanguageManagerModal(state)
    + renderEditorRowInsertModal(state)
    + renderEditorRowMergeModal(state)
    + renderEditorRowPermanentDeletionModal(state)
    + renderEditorUnreviewAllModal(state)
    + renderEditorExportModal(state)
    + renderEditorAiReviewAllModal(state)
    + renderEditorClearTranslationsModal(state)
    + renderEditorDeriveGlossariesModal(state)
    + renderEditorAiTranslateAllModal(state)
    + renderEditorConflictResolutionModal(state)
    + renderEditorImageInvalidFileModal(state)
    + renderEditorImageDuplicateOverwriteModal(state)
    + renderEditorImageCaptionTranslationModal(state)
    + renderEditorImagePreviewOverlay(state)
    + renderEditorInsertLinkModal(state)
    + renderEditorWordPressExportSuccessModal(state)
    + renderEditorReplaceUndoModal(state)
    + renderAiReviewMissingKeyModal(state)
    + renderEditorCloseWaitModal(state)
    + renderEditorSrtMarkerModal(state);
}
