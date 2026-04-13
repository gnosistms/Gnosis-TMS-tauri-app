import {
  buildPageRefreshAction,
  buildSectionNav,
  escapeHtml,
  pageShell,
} from "../lib/ui.js";
import { buildEditorScreenViewModel } from "../app/editor-screen-model.js";
import { renderTranslationContentRows } from "../app/editor-row-render.js";
import { getNoticeBadgeText } from "../app/status-feedback.js";
import { MANAGE_TARGET_LANGUAGES_OPTION_VALUE } from "../app/translate-flow.js";
import { renderEditorRowInsertModal } from "./editor-row-insert-modal.js";
import { renderEditorRowPermanentDeletionModal } from "./editor-row-permanent-deletion-modal.js";
import { renderEditorReplaceUndoModal } from "./editor-replace-undo-modal.js";
import { renderTargetLanguageManagerModal } from "./target-language-manager-modal.js";
import { renderTranslateSidebar as renderTranslateEditorSidebar } from "./translate-sidebar.js";
import {
  renderEditorFilterBanner,
  renderTranslateModeControl,
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
  const authSession = state.auth?.session ?? null;
  const titleText = chapter?.name ?? editorChapter?.fileTitle ?? "Translate";
  const displayTitle = middleTruncateTitle(titleText);

  let translateBody = "";
  if (editorChapter?.status === "loading") {
    translateBody = `
      <article class="card card--translation">
        <div class="card__body">
          <p>Loading file...</p>
        </div>
      </article>
    `;
  } else if (editorChapter?.status === "error") {
    translateBody = `
      <article class="card card--translation">
        <div class="card__body">
          <p>${escapeHtml(editorChapter.error || "The file could not be loaded.")}</p>
        </div>
      </article>
    `;
  } else if (!chapter && !editorChapter?.chapterId) {
    translateBody = `
      <article class="card card--translation">
        <div class="card__body">
          <p>Could not determine which file to open.</p>
        </div>
      </article>
    `;
  } else if (contentRows.length === 0) {
    translateBody = `
      <article class="card card--translation">
        <div class="card__body">
          <p>${escapeHtml(
            editorFilters?.hasActiveFilters
              ? "No rows match the current filters."
              : "This file does not contain any translatable rows.",
          )}</p>
        </div>
      </article>
    `;
  } else {
    translateBody = renderTranslationContentRows(
      contentRows,
      collapsedLanguageCodes,
      editorFontSizePx,
      editorReplace,
    );
  }

  return {
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
    authSession,
    titleText,
    displayTitle,
    translateBody,
  };
}

function renderTranslateEditorBodyFromFrame(frame) {
  const {
    editorChapter,
    languages,
    contentRows,
    editorFilters,
    editorReplace,
    editorFontSizePx,
    translateBody,
    authSession,
  } = frame;
  return `
    <section class="translate-layout" style="--translation-editor-font-size: ${escapeHtml(String(editorFontSizePx))}px;">
      <div class="translate-main-scroll">
        <div class="translate-main${editorReplace?.isEnabled ? " translate-main--replace-mode" : ""}">
          ${renderEditorFilterBanner(editorFilters)}
          ${translateBody}
        </div>
      </div>
      <div class="translate-sidebar-scroll">
        ${renderTranslateEditorSidebar(editorChapter, contentRows, languages, authSession)}
      </div>
    </section>
  `;
}

export function renderTranslateEditorBody(state) {
  return renderTranslateEditorBodyFromFrame(buildTranslateScreenFrame(state));
}

export function renderTranslateSidebar(state) {
  const { editorChapter, contentRows, languages, authSession } = buildTranslateScreenFrame(state);
  return renderTranslateEditorSidebar(editorChapter, contentRows, languages, authSession);
}

export function renderTranslateScreen(state) {
  const frame = buildTranslateScreenFrame(state);
  const {
    languages,
    sourceCode,
    targetCode,
    editorFilters,
    editorReplace,
    editorFontSizePx,
    titleText,
    displayTitle,
  } = frame;
  const targetLanguageManageOption = [{
    value: MANAGE_TARGET_LANGUAGES_OPTION_VALUE,
    label: "Add / Remove",
  }];

  return pageShell({
    title: displayTitle,
    titleTooltip: titleText,
    headerClass: "page-header--editor",
    bodyClass: "page-body--editor",
    titleAction: buildPageRefreshAction(state),
    navButtons: buildSectionNav("translate"),
    tools: renderTranslateModeControl(),
    headerBody: renderTranslateToolbar({
      languages,
      sourceCode,
      targetCode,
      editorFilters,
      editorReplace,
      editorFontSizePx,
      targetLanguageExtraOptions: targetLanguageManageOption,
    }),
    pageSync: state.pageSync,
    noticeText: getNoticeBadgeText(),
    offlineMode: state.offline?.isEnabled === true,
    offlineReconnectState: state.offline?.reconnecting === true,
    body: renderTranslateEditorBodyFromFrame(frame),
  }) + renderTargetLanguageManagerModal(state)
    + renderEditorRowInsertModal(state)
    + renderEditorRowPermanentDeletionModal(state)
    + renderEditorReplaceUndoModal(state);
}
