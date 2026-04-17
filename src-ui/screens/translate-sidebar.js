import {
  resolveVisibleAiTranslateActions,
} from "../app/ai-action-config.js";
import {
  getAiProviderIconUrl,
} from "../app/ai-provider-config.js";
import { resolveVisibleEditorAiTranslateAction } from "../app/editor-ai-translate-state.js";
import {
  escapeHtml,
  loadingPrimaryButton,
  primaryButton,
  renderCollapseChevron,
  renderFlowArrowIcon,
  renderInlineStateBox,
  secondaryButton,
  tooltipAttributes,
} from "../lib/ui.js";
import { resolveVisibleEditorAiReview } from "../app/editor-ai-review-state.js";
import { normalizeEditorSidebarTab } from "../app/editor-comments.js";
import { findEditorHistoryPreviousEntry } from "../app/editor-history.js";
import { resolveEditorAiTranslateLanguages } from "../app/editor-ai-translate-target.js";
import { renderCommentsPane } from "./translate-comments-pane.js";
import { renderHistoryPane } from "./translate-history-pane.js";
import { renderHistoryContent, renderHistoryNote } from "./translate-history-shared.js";

function renderSidebarTab(label, tab, activeTab) {
  const isActive = tab === activeTab;
  return `
    <button
      class="history-tabs__item${isActive ? " history-tabs__item--active" : ""}"
      type="button"
      data-action="switch-editor-sidebar-tab:${escapeHtml(tab)}"
      aria-pressed="${isActive ? "true" : "false"}"
    >
      ${escapeHtml(label)}
    </button>
  `;
}

function renderTranslateActionButton(buttonModel, isAnyActionRunning) {
  const disabled =
    buttonModel.isLoading
    || isAnyActionRunning
    || buttonModel.isDisabled;
  const disabledAttributes = disabled ? ' disabled aria-disabled="true"' : "";

  return `
    <button
      class="button button--secondary translate-ai-action-button${buttonModel.isLoading ? " button--loading" : ""}"
      type="button"
      data-action="run-editor-ai-translate:${escapeHtml(buttonModel.actionId)}"
      aria-label="${escapeHtml(buttonModel.tooltip)}"
      aria-busy="${buttonModel.isLoading ? "true" : "false"}"
      ${tooltipAttributes(buttonModel.tooltip, { align: "start", side: "bottom" })}
      ${disabledAttributes}
    >
      <span class="translate-ai-action-button__icon-shell" aria-hidden="true">
        ${
          buttonModel.isLoading
            ? '<span class="translate-ai-action-button__spinner button__spinner" aria-hidden="true"></span>'
            : `
              <img
                class="translate-ai-action-button__icon"
                src="${escapeHtml(buttonModel.iconUrl)}"
                alt=""
              />
            `
        }
      </span>
      <span class="translate-ai-action-button__copy">
        <span class="translate-ai-action-button__model">${escapeHtml(buttonModel.modelLabel)}</span>
      </span>
    </button>
  `;
}

function renderTranslatePane(editorChapter, rows, languages, sourceCode, targetCode, actionConfig) {
  const activeRow = rows.find((row) => row.id === editorChapter?.activeRowId) ?? null;
  const translateLanguages = resolveEditorAiTranslateLanguages(editorChapter);
  const sourceLanguage =
    translateLanguages.sourceLanguage
    ?? languages.find((language) => language.code === sourceCode)
    ?? null;
  const toolbarTargetLanguage =
    translateLanguages.toolbarTargetLanguage
    ?? languages.find((language) => language.code === targetCode)
    ?? null;
  const targetLanguage = translateLanguages.targetLanguage ?? toolbarTargetLanguage;
  const sourceSection =
    activeRow?.sections?.find((section) => section.code === sourceLanguage?.code) ?? null;
  const targetSection =
    activeRow?.sections?.find((section) => section.code === targetLanguage?.code) ?? null;

  if (!activeRow) {
    return `
      <div class="history-empty">
        <p>Select a translation row to translate with AI.</p>
      </div>
    `;
  }

  if (!sourceLanguage || !targetLanguage || !sourceSection || !targetSection) {
    return `
      <div class="history-empty">
        <p>Select both the source and target language before translating.</p>
      </div>
    `;
  }

  const translateActions = resolveVisibleAiTranslateActions(actionConfig);
  const visibleActions = translateActions.map((translateAction) =>
    resolveVisibleEditorAiTranslateAction(
      editorChapter,
      translateAction.actionId,
      activeRow.id,
      sourceLanguage.code,
      targetLanguage.code,
      sourceSection.text,
    ));
  const isAnyActionRunning = visibleActions.some((action) => action.isLoading);
  const canTranslate =
    sourceLanguage.code !== targetLanguage.code && sourceSection.text.trim().length > 0;
  const disabledMessage =
    sourceLanguage.code === targetLanguage.code
      ? "Choose a language other than the source language before translating."
      : sourceSection.text.trim().length === 0
        ? "There is no source text to translate yet."
        : "";
  const alternateTargetMarkup =
    translateLanguages.usesAlternateTarget
      ? `
        <p class="translate-ai-tools__language-flow">
          <span>${escapeHtml(sourceLanguage.name ?? sourceLanguage.code)}</span>
          ${renderFlowArrowIcon("translate-ai-tools__language-arrow")}
          <span>${escapeHtml(targetLanguage.name ?? targetLanguage.code)}</span>
        </p>
      `
      : "";
  const buttonModels = translateActions.map((translateAction, index) => {
    const selection = translateAction.selection;
    const providerId = selection.providerId;
    const modelId = typeof selection.modelId === "string" ? selection.modelId.trim() : "";
    const visibleAction = visibleActions[index];
    const visibleModelLabel = modelId || "Select a model in AI Settings";
    return {
      actionId: translateAction.actionId,
      label: translateAction.label,
      iconUrl: getAiProviderIconUrl(providerId),
      isLoading: visibleAction.isLoading,
      isDisabled: !canTranslate || !modelId,
      modelLabel: visibleModelLabel,
      tooltip: `Translate ${sourceLanguage.name ?? sourceLanguage.code} to ${targetLanguage.name ?? targetLanguage.code} using ${visibleModelLabel}`,
      showError: visibleAction.showError,
      error: visibleAction.error,
    };
  });
  const buttonsMarkup = buttonModels
    .map((buttonModel) => renderTranslateActionButton(buttonModel, isAnyActionRunning))
    .join("");
  const errorMarkup = buttonModels
    .filter((buttonModel) => buttonModel.showError)
    .map((buttonModel) =>
      renderInlineStateBox({
        tone: "error",
        message: `${buttonModel.modelLabel}: ${buttonModel.error}`,
      }))
    .join("");

  return `
    <div class="translate-ai-tools">
      ${alternateTargetMarkup}
      <div class="translate-ai-tools__actions${translateActions.length === 1 ? " translate-ai-tools__actions--single" : ""}">
        ${buttonsMarkup}
      </div>
      ${
        disabledMessage
          ? renderInlineStateBox({
            message: disabledMessage,
          })
          : ""
      }
      ${errorMarkup}
    </div>
  `;
}

function renderReviewPane(editorChapter, rows, languages) {
  const expandedSectionKeys =
    editorChapter?.reviewExpandedSectionKeys instanceof Set
      ? editorChapter.reviewExpandedSectionKeys
      : new Set(["last-update", "ai-review"]);
  const activeRow = rows.find((row) => row.id === editorChapter?.activeRowId) ?? null;
  const activeLanguage =
    languages.find((language) => language.code === editorChapter?.activeLanguageCode) ?? null;
  const activeSection = activeRow?.sections?.find((section) => section.code === activeLanguage?.code) ?? null;
  const activeHistorySection = activeSection
    ? {
        ...activeSection,
        textStyle: activeRow?.textStyle ?? "paragraph",
      }
    : null;
  const history =
    editorChapter?.history && typeof editorChapter.history === "object"
      ? editorChapter.history
      : {
          status: "idle",
          error: "",
          entries: [],
  };
  const previousEntry = findEditorHistoryPreviousEntry(history.entries, activeHistorySection);
  const currentEntry = {
    plainText: activeSection?.text ?? "",
    reviewed: activeSection?.reviewed === true,
    pleaseCheck: activeSection?.pleaseCheck === true,
    textStyle: activeRow?.textStyle ?? "paragraph",
  };
  const isLastUpdateExpanded = expandedSectionKeys.has("last-update");
  const isAiReviewExpanded = expandedSectionKeys.has("ai-review");
  const lastUpdateSummaryTooltip = tooltipAttributes(
    isLastUpdateExpanded ? "Collapse this review section" : "Expand this review section",
    { align: "start" },
  );
  const summaryMeta = history.status === "loading"
    ? "Loading..."
    : history.status === "error"
      ? "Error"
      : previousEntry
        ? "Diff"
        : "Text only";
  const aiReview = resolveVisibleEditorAiReview(
    editorChapter,
    activeRow?.id ?? null,
    activeLanguage?.code ?? null,
    activeSection?.text ?? "",
  );
  const aiReviewSummaryTooltip = tooltipAttributes(
    isAiReviewExpanded ? "Collapse this review section" : "Expand this review section",
    { align: "start" },
  );
  const aiReviewMeta = aiReview.status === "loading"
    ? "Reviewing..."
    : aiReview.status === "applying"
      ? "Applying..."
      : aiReview.showLooksGoodMessage
        ? "Looks good!"
      : aiReview.showSuggestion
        ? "Suggestion"
        : aiReview.status === "error"
          ? "Error"
          : "Review now";
  const aiReviewMessage = aiReview.isStale
    ? renderInlineStateBox({
      tone: "warning",
      message: "The text changed since the last AI review.",
    })
    : aiReview.status === "error"
      ? renderInlineStateBox({
        tone: "error",
        message: aiReview.error,
      })
      : "";
  const reviewNowButton = aiReview.status === "loading"
    ? loadingPrimaryButton({
      label: "Review now",
      loadingLabel: "Reviewing...",
      action: "review-editor-text-now",
      isLoading: true,
    })
    : primaryButton("Review now", "review-editor-text-now");
  const applyButton = secondaryButton(
    aiReview.status === "applying" ? "Applying..." : "Apply",
    "apply-editor-ai-review",
    {
      disabled: aiReview.status === "applying",
      compact: true,
      className: "button--replace-toolbar",
      tooltip: "Update the translation to match this AI suggested revision",
      tooltipOptions: { align: "start" },
    },
  );

  if (!activeRow || !activeLanguage || !activeSection) {
    return `
      <div class="history-empty">
        <p>Select a translation to view review tools.</p>
      </div>
    `;
  }

  return `
    <div class="history-stack">
      <section class="history-group">
        <button
          class="history-group__toggle"
          type="button"
          data-action="toggle-editor-review-section:last-update"
          aria-expanded="${isLastUpdateExpanded ? "true" : "false"}"
        >
          <span class="history-group__summary collapse-affordance"${lastUpdateSummaryTooltip}>
            ${renderCollapseChevron(isLastUpdateExpanded, "history-group__chevron")}
            <span class="history-group__author">Last update</span>
          </span>
          <span class="history-group__meta">${escapeHtml(summaryMeta)}</span>
        </button>
        ${
          isLastUpdateExpanded
            ? `
              <div class="history-group__entries">
                <article class="history-item">
                  <p class="history-item__content" lang="${escapeHtml(activeLanguage.code)}">${renderHistoryContent(currentEntry, previousEntry)}</p>
                  ${renderHistoryNote(currentEntry, previousEntry, { includeMarkers: false })}
                  ${
                    history.status === "loading"
                      ? '<p class="history-item__meta">Loading previous version...</p>'
                      : history.status === "error"
                        ? `<p class="history-item__note">${escapeHtml(history.error || "Could not load the previous version.")}</p>`
                        : previousEntry
                          ? '<p class="history-item__meta">Compared with the previous version</p>'
                          : '<p class="history-item__meta">No previous version</p>'
                  }
                </article>
              </div>
            `
            : ""
        }
      </section>
      <section class="history-group">
        <button
          class="history-group__toggle"
          type="button"
          data-action="toggle-editor-review-section:ai-review"
          aria-expanded="${isAiReviewExpanded ? "true" : "false"}"
        >
          <span class="history-group__summary collapse-affordance"${aiReviewSummaryTooltip}>
            ${renderCollapseChevron(isAiReviewExpanded, "history-group__chevron")}
            <span class="history-group__author">AI Review</span>
          </span>
          <span class="history-group__meta">${escapeHtml(aiReviewMeta)}</span>
        </button>
        ${
          isAiReviewExpanded
            ? `
              <div class="history-group__entries">
                <article class="history-item">
                  ${
                    aiReview.showSuggestion
                      ? `
                        <p class="history-item__content" lang="${escapeHtml(activeLanguage.code)}">${renderHistoryContent({ plainText: aiReview.suggestedText }, currentEntry)}</p>
                        <div class="history-item__footer">
                          <div class="history-item__actions">
                            ${applyButton}
                          </div>
                          <p class="history-item__meta">Compared with the current text</p>
                        </div>
                      `
                      : aiReview.showLooksGoodMessage
                        ? `
                          <p class="history-item__content" lang="${escapeHtml(activeLanguage.code)}">Your translation looks good!</p>
                        `
                      : `
                        ${aiReviewMessage}
                        <div class="history-item__footer">
                          <div class="history-item__actions">
                            ${reviewNowButton}
                          </div>
                        </div>
                      `
                  }
                </article>
              </div>
            `
            : ""
        }
      </section>
    </div>
  `;
}

export function renderTranslateSidebar(
  editorChapter,
  rows,
  languages,
  sourceCode,
  targetCode,
  actionConfig,
  session,
) {
  const activeTab = normalizeEditorSidebarTab(editorChapter?.sidebarTab);
  const body = activeTab === "translate"
    ? renderTranslatePane(editorChapter, rows, languages, sourceCode, targetCode, actionConfig)
    : activeTab === "comments"
    ? renderCommentsPane(editorChapter, rows, session)
    : activeTab === "review"
      ? renderReviewPane(editorChapter, rows, languages)
      : renderHistoryPane(editorChapter, rows, languages);

  return `
    <aside class="translate-sidebar card card--history">
      <div class="card__body">
        <div class="history-tabs">
          ${renderSidebarTab("Translate", "translate", activeTab)}
          ${renderSidebarTab("Review", "review", activeTab)}
          ${renderSidebarTab("History", "history", activeTab)}
          ${renderSidebarTab("Comments", "comments", activeTab)}
        </div>
        ${body}
      </div>
    </aside>
  `;
}
