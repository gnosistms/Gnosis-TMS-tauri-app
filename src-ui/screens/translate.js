import {
  actionNavButton,
  buildPageRefreshAction,
  escapeHtml,
  navButton,
  pageShell,
} from "../lib/ui.js";
import {
  buildEditorPreviewDocument,
  EDITOR_MODE_PREVIEW,
  normalizeEditorMode,
  renderEditorPreviewDocumentHtml,
} from "../app/editor-preview.js";
import { buildEditorScreenViewModel } from "../app/editor-screen-model.js";
import { renderTranslationContentRows } from "../app/editor-row-render.js";
import { convertLocalFileSrc } from "../app/runtime.js";
import { getNoticeBadgeText } from "../app/status-feedback.js";
import { MANAGE_CHAPTER_LANGUAGES_OPTION_VALUE } from "../app/translate-flow.js";
import { renderEditorRowInsertModal } from "./editor-row-insert-modal.js";
import { renderEditorRowPermanentDeletionModal } from "./editor-row-permanent-deletion-modal.js";
import { renderEditorUnreviewAllModal } from "./editor-unreview-all-modal.js";
import { renderEditorAiTranslateAllModal } from "./editor-ai-translate-all-modal.js";
import { renderEditorDeriveGlossariesModal } from "./editor-derive-glossaries-modal.js";
import { renderEditorConflictResolutionModal } from "./editor-conflict-resolution-modal.js";
import { renderEditorImageInvalidFileModal } from "./editor-image-invalid-file-modal.js";
import { renderEditorImagePreviewOverlay } from "./editor-image-preview-overlay.js";
import { renderEditorReplaceUndoModal } from "./editor-replace-undo-modal.js";
import { renderAiReviewMissingKeyModal } from "./ai-review-missing-key-modal.js";
import { renderTargetLanguageManagerModal } from "./target-language-manager-modal.js";
import { renderTranslateSidebar as renderTranslateEditorSidebar } from "./translate-sidebar.js";
import { resolveSelectedChapterGlossary, selectedProjectsTeam } from "../app/project-context.js";
import { resolveEditorDeriveGlossariesConfig } from "../app/editor-derive-glossaries-flow.js";
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

  let translateBody = "";
  if (editorChapter?.status === "loading") {
    translateBody = renderTranslateStateCard("Loading file...");
  } else if (editorChapter?.status === "error") {
    translateBody = renderTranslateStateCard(editorChapter.error || "The file could not be loaded.");
  } else if (!chapter && !editorChapter?.chapterId) {
    translateBody = renderTranslateStateCard("Could not determine which file to open.");
  } else if (contentRows.length === 0) {
    translateBody = renderTranslateStateCard(
      editorFilters?.hasActiveFilters
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
      ? buildEditorPreviewDocument(editorChapter.rows, targetCode)
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
    actionConfig: state.aiSettings.actionConfig,
    contentRows,
    editorFilters,
    editorReplace,
    collapsedLanguageCodes,
    editorFontSizePx,
    sidebarTab,
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
          ${renderEditorConflictBanner(editorFilters)}
          ${renderEditorFilterBanner(editorFilters)}
          ${renderEditorSyncBanner(editorChapter)}
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
    editorFilters,
    editorReplace,
    editorFontSizePx,
    previewSearchState,
  } = frame;
  const targetLanguageManageOption = [{
    value: MANAGE_CHAPTER_LANGUAGES_OPTION_VALUE,
    label: "Add / Remove",
  }];
  const chapterLanguageManagerOptions =
    selectedProjectsTeam()?.canManageProjects === true
      ? targetLanguageManageOption
      : [];

  if (mode === EDITOR_MODE_PREVIEW) {
    return renderPreviewToolbar({
      languages,
      targetCode,
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
  } = buildTranslateScreenFrame(state);
  return renderTranslateEditorSidebar(
    editorChapter,
    contentRows,
    languages,
    sourceCode,
    targetCode,
    state.aiSettings.actionConfig,
    authSession,
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
    + renderEditorRowPermanentDeletionModal(state)
    + renderEditorUnreviewAllModal(state)
    + renderEditorDeriveGlossariesModal(state)
    + renderEditorAiTranslateAllModal(state)
    + renderEditorConflictResolutionModal(state)
    + renderEditorImageInvalidFileModal(state)
    + renderEditorImagePreviewOverlay(state)
    + renderEditorReplaceUndoModal(state)
    + renderAiReviewMissingKeyModal(state);
}
