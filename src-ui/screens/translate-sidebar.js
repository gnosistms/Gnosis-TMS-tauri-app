import {
  resolveVisibleAiTranslateActions,
} from "../app/ai-action-config.js";
import {
  buildEditorAssistantThreadKey,
  currentEditorAssistantThread,
  normalizeEditorAssistantState,
} from "../app/editor-ai-assistant-state.js";
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
  textAction,
  tooltipAttributes,
} from "../lib/ui.js";
import { resolveVisibleEditorAiReview } from "../app/editor-ai-review-state.js";
import { normalizeEditorSidebarTab } from "../app/editor-comments.js";
import {
  findEditorHistoryPreviousCommitEntry,
  historyLastUpdateHeadingLabel,
} from "../app/editor-history.js";
import { resolveEditorAiTranslateLanguages } from "../app/editor-ai-translate-target.js";
import { renderCommentsPane } from "./translate-comments-pane.js";
import { renderHistoryPane } from "./translate-history-pane.js";
import {
  renderHistoryContent,
  renderHistoryEntryContent,
  renderHistoryNote,
} from "./translate-history-shared.js";

function renderSidebarTab(label, tab, activeTab, actionTab = tab) {
  const isActive = tab === activeTab;
  return `
    <button
      class="history-tabs__item${isActive ? " history-tabs__item--active" : ""}"
      type="button"
      data-action="switch-editor-sidebar-tab:${escapeHtml(actionTab)}"
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

function activeAssistantThreadHasItems(editorChapter, activeRowId, targetLanguageCode) {
  const threadKey = buildEditorAssistantThreadKey(activeRowId, targetLanguageCode);
  const thread = currentEditorAssistantThread(editorChapter, threadKey);
  return Array.isArray(thread?.items) && thread.items.length > 0;
}

function renderTranslateTools(editorChapter, rows, languages, sourceCode, targetCode, actionConfig, offlineMode = false) {
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
    return "";
  }

  if (!sourceLanguage || !targetLanguage || !sourceSection || !targetSection) {
    return `
      <div class="history-empty">
        <p>Select both the source and target language before translating.</p>
      </div>
    `;
  }

  if (activeAssistantThreadHasItems(editorChapter, activeRow.id, targetLanguage.code)) {
    return "";
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
    offlineMode !== true
    && sourceLanguage.code !== targetLanguage.code
    && sourceSection.text.trim().length > 0;
  const disabledMessage =
    offlineMode === true
      ? "AI actions are unavailable offline."
      : sourceLanguage.code === targetLanguage.code
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
      tooltip: offlineMode === true
        ? "AI actions are unavailable offline."
        : `Translate ${sourceLanguage.name ?? sourceLanguage.code} to ${targetLanguage.name ?? targetLanguage.code} using ${visibleModelLabel}`,
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

function renderAssistantGlossaryHints(glossaryHints) {
  const hints = (Array.isArray(glossaryHints) ? glossaryHints : [])
    .filter((hint) => typeof hint?.sourceTerm === "string" && hint.sourceTerm.trim())
    .map((hint) => {
      const variants = (Array.isArray(hint.targetVariants) ? hint.targetVariants : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
        .join(", ");
      const notes = (Array.isArray(hint.notes) ? hint.notes : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
        .join(" | ");
      return `
        <li>
          <strong>${escapeHtml(hint.sourceTerm)}</strong>
          ${variants ? ` -> ${escapeHtml(variants)}` : ""}
          ${notes ? `<div>${escapeHtml(notes)}</div>` : ""}
        </li>
      `;
    })
    .join("");

  if (!hints) {
    return "";
  }

  return `
    <div class="assistant-item__section">
      <p class="assistant-item__section-label">Glossary</p>
      <ul class="assistant-item__list">
        ${hints}
      </ul>
    </div>
  `;
}

function renderAssistantContextRows(rows) {
  const rowMarkup = (Array.isArray(rows) ? rows : [])
    .map((row) => `
      <li>
        <strong>${escapeHtml(row?.rowId ?? "")}</strong>
        <div>${escapeHtml(row?.sourceText ?? "") || "(empty)"}</div>
        ${typeof row?.targetText === "string" && row.targetText.trim()
          ? `<div class="assistant-item__secondary">${escapeHtml(row.targetText)}</div>`
          : ""}
      </li>
    `)
    .join("");

  if (!rowMarkup) {
    return "";
  }

  return `
    <div class="assistant-item__section">
      <p class="assistant-item__section-label">Context</p>
      <ul class="assistant-item__list">
        ${rowMarkup}
      </ul>
    </div>
  `;
}

function renderAssistantConcordanceHits(hits) {
  const hitMarkup = (Array.isArray(hits) ? hits : [])
    .map((hit) => `
      <li>
        <strong>${escapeHtml(hit?.rowId ?? "")}</strong>
        <div>${escapeHtml(hit?.sourceSnippet ?? "")}</div>
        ${
          typeof hit?.targetSnippet === "string" && hit.targetSnippet.trim()
            ? `<div class="assistant-item__secondary">${escapeHtml(hit.targetSnippet)}</div>`
            : ""
        }
      </li>
    `)
    .join("");

  if (!hitMarkup) {
    return "";
  }

  return `
    <div class="assistant-item__section">
      <p class="assistant-item__section-label">Document Usage</p>
      <ul class="assistant-item__list">
        ${hitMarkup}
      </ul>
    </div>
  `;
}

function renderAssistantPromptDetails(item) {
  const details = item?.details && typeof item.details === "object" ? item.details : {};
  const itemType = typeof item?.type === "string" ? item.type : "";
  const sourceText = typeof details.sourceText === "string" ? details.sourceText.trim() : "";
  const targetText = typeof details.targetText === "string" ? details.targetText.trim() : "";
  const promptText = typeof item?.promptText === "string" ? item.promptText.trim() : "";
  const providerId = typeof details.providerId === "string" ? details.providerId.trim() : "";
  const modelId = typeof details.modelId === "string" ? details.modelId.trim() : "";
  const documentDigest = typeof details.documentDigest === "string" ? details.documentDigest.trim() : "";
  const translatedText = typeof details.translatedText === "string" ? details.translatedText.trim() : "";
  const appliedText = typeof details.appliedText === "string" ? details.appliedText.trim() : "";
  const glossarySourceText = typeof details.glossarySourceText === "string" ? details.glossarySourceText.trim() : "";
  const isAssistantTurnDetails =
    details.kind === "chat" || details.kind === "translate_refinement";
  const isTranslationLog = itemType === "translation-log";
  const showContextBreakdown = !isAssistantTurnDetails && !isTranslationLog;
  const showGlossarySourceText =
    showContextBreakdown
    && glossarySourceText
    && glossarySourceText !== sourceText;
  const hasAnyDetails =
    (showContextBreakdown && sourceText)
    || (showContextBreakdown && targetText)
    || promptText
    || providerId
    || modelId
    || (showContextBreakdown && documentDigest)
    || (!isTranslationLog && translatedText)
    || (!isTranslationLog && appliedText)
    || showGlossarySourceText
    || (showContextBreakdown && Array.isArray(details.rowWindow) && details.rowWindow.length > 0)
    || (showContextBreakdown && Array.isArray(details.glossaryHints) && details.glossaryHints.length > 0)
    || (showContextBreakdown && Array.isArray(details.concordanceHits) && details.concordanceHits.length > 0);

  if (!hasAnyDetails) {
    return "";
  }

  return `
    <details class="assistant-item__details">
      <summary>Details</summary>
      <div class="assistant-item__details-body">
        ${
          providerId || modelId
            ? `
              <p class="assistant-item__meta">
                ${escapeHtml([providerId, modelId].filter(Boolean).join(" / "))}
              </p>
            `
            : ""
        }
        ${
          showContextBreakdown && sourceText
            ? `
              <div class="assistant-item__section">
                <p class="assistant-item__section-label">Source</p>
                <pre class="assistant-item__pre">${escapeHtml(sourceText)}</pre>
              </div>
            `
            : ""
        }
        ${
          showContextBreakdown && targetText
            ? `
              <div class="assistant-item__section">
                <p class="assistant-item__section-label">Current Target</p>
                <pre class="assistant-item__pre">${escapeHtml(targetText)}</pre>
              </div>
            `
            : ""
        }
        ${
          showGlossarySourceText
            ? `
              <div class="assistant-item__section">
                <p class="assistant-item__section-label">Glossary Source</p>
                <pre class="assistant-item__pre">${escapeHtml(glossarySourceText)}</pre>
              </div>
            `
            : ""
        }
        ${showContextBreakdown && documentDigest
          ? `
            <div class="assistant-item__section">
              <p class="assistant-item__section-label">Document Digest</p>
              <pre class="assistant-item__pre">${escapeHtml(documentDigest)}</pre>
            </div>
          `
          : ""}
        ${showContextBreakdown ? renderAssistantContextRows(details.rowWindow) : ""}
        ${showContextBreakdown ? renderAssistantGlossaryHints(details.glossaryHints) : ""}
        ${showContextBreakdown ? renderAssistantConcordanceHits(details.concordanceHits) : ""}
        ${
          isTranslationLog && promptText
            ? `
              <div class="assistant-item__section">
                <p class="assistant-item__section-label">Prompt</p>
                <pre class="assistant-item__pre">${escapeHtml(promptText)}</pre>
              </div>
            `
            : ""
        }
        ${
          !isTranslationLog && translatedText
            ? `
              <div class="assistant-item__section">
                <p class="assistant-item__section-label">Model Output</p>
                <pre class="assistant-item__pre">${escapeHtml(translatedText)}</pre>
              </div>
            `
            : ""
        }
        ${
          !isTranslationLog && appliedText
            ? `
              <div class="assistant-item__section">
                <p class="assistant-item__section-label">Applied Text</p>
                <pre class="assistant-item__pre">${escapeHtml(appliedText)}</pre>
              </div>
            `
            : ""
        }
        ${
          !isTranslationLog && promptText
            ? `
              <div class="assistant-item__section">
                <p class="assistant-item__section-label">Prompt</p>
                <pre class="assistant-item__pre">${escapeHtml(promptText)}</pre>
              </div>
            `
            : ""
        }
      </div>
    </details>
  `;
}

function assistantDraftCanShowDiff(item, currentTargetText) {
  return Boolean(item?.draftTranslationText)
    && typeof currentTargetText === "string"
    && currentTargetText.trim().length > 0;
}

function renderAssistantDraftText(item, currentTargetText) {
  const draftText = item?.draftTranslationText ?? "";
  if (assistantDraftCanShowDiff(item, currentTargetText) && item?.draftDiffHidden !== true) {
    return renderHistoryContent(
      { plainText: draftText },
      { plainText: currentTargetText },
    );
  }

  return escapeHtml(draftText);
}

function normalizeAssistantDraftComparisonText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

function assistantDraftMatchesCurrentTarget(item, currentTargetText) {
  return normalizeAssistantDraftComparisonText(item?.draftTranslationText)
    === normalizeAssistantDraftComparisonText(currentTargetText);
}

function renderAssistantTranscriptItem(item, currentTargetText = "") {
  const itemType = item?.type ?? "assistant-message";
  const text = typeof item?.text === "string" ? item.text.trim() : "";

  if (itemType === "tool-event") {
    return `
      <article class="assistant-item assistant-item--tool">
        <p class="assistant-item__tool-text">${escapeHtml(text)}</p>
      </article>
    `;
  }

  if (itemType === "draft-translation") {
    const canToggleDiff = assistantDraftCanShowDiff(item, currentTargetText);
    const isDiffHidden = item.draftDiffHidden === true;
    const isApplying = item.applyStatus === "applying";
    const isAppliedToCurrentText =
      item.applyStatus === "applied" && assistantDraftMatchesCurrentTarget(item, currentTargetText);
    const diffToggleLabel = isDiffHidden ? "Show diff" : "Hide diff";
    const diffToggleTooltip = isDiffHidden
      ? "Show markings that indicate the differences between this draft and the translation on the left."
      : "Hide the markings that indicate the differences between this draft and the translation on the left.";
    const applyLabel =
      isApplying
        ? "Applying..."
        : isAppliedToCurrentText
          ? "Applied"
          : "Apply";
    const isDisabled = isApplying || isAppliedToCurrentText;
    return `
      <article class="assistant-item assistant-item--assistant">
        <p class="assistant-item__label">Draft Translation</p>
        ${text ? `<p class="assistant-item__text">${escapeHtml(text)}</p>` : ""}
        <pre class="assistant-item__draft">${renderAssistantDraftText(item, currentTargetText)}</pre>
        ${
          item.applyError
            ? renderInlineStateBox({
              tone: "error",
              message: item.applyError,
            })
            : ""
        }
        <div class="assistant-item__actions">
          <div class="assistant-item__actions-left">
            ${
              canToggleDiff
                ? textAction(diffToggleLabel, `toggle-editor-assistant-draft-diff:${item.id}`, {
                  tooltip: diffToggleTooltip,
                  tooltipOptions: { align: "start" },
                })
                : ""
            }
          </div>
          <div class="assistant-item__actions-right">
            ${secondaryButton(applyLabel, `apply-editor-assistant-draft:${item.id}`, {
              compact: true,
              disabled: isDisabled,
              className: "button--replace-toolbar",
            })}
          </div>
        </div>
        ${renderAssistantPromptDetails(item)}
      </article>
    `;
  }

  if (itemType === "translation-log") {
    return `
      <article class="assistant-item assistant-item--assistant">
        <p class="assistant-item__label">Translate</p>
        <p class="assistant-item__text">${escapeHtml(text)}</p>
        ${renderAssistantPromptDetails(item)}
      </article>
    `;
  }

  const itemClass =
    itemType === "user-message"
      ? "assistant-item assistant-item--user"
      : itemType === "apply-result"
        ? "assistant-item assistant-item--system"
        : "assistant-item assistant-item--assistant";
  const label =
    itemType === "user-message"
      ? "You"
      : itemType === "apply-result"
        ? "Applied"
        : "AI Assistant";

  return `
    <article class="${itemClass}">
      <p class="assistant-item__label">${escapeHtml(label)}</p>
      <p class="assistant-item__text">${escapeHtml(text)}</p>
      ${itemType === "assistant-message" ? renderAssistantPromptDetails(item) : ""}
    </article>
  `;
}

function assistantTranscriptStatusText(assistant, threadKey) {
  if (assistant?.activeThreadKey !== threadKey) {
    return "";
  }

  if (assistant.status === "sending") {
    return "Sending...";
  }

  if (assistant.status === "thinking") {
    return "Thinking...";
  }

  return "";
}

function renderAssistantTranscript(editorChapter, rows, languages, sourceCode, targetCode) {
  const activeRow = rows.find((row) => row.id === editorChapter?.activeRowId) ?? null;
  const translateLanguages = resolveEditorAiTranslateLanguages(editorChapter);
  const targetLanguage =
    translateLanguages.targetLanguage
    ?? translateLanguages.toolbarTargetLanguage
    ?? languages.find((language) => language.code === targetCode)
    ?? null;
  const targetSection =
    activeRow?.sections?.find((section) => section.code === targetLanguage?.code) ?? null;
  const currentTargetText = typeof targetSection?.text === "string" ? targetSection.text : "";
  const threadKey = buildEditorAssistantThreadKey(activeRow?.id ?? null, targetLanguage?.code ?? null);
  const thread = currentEditorAssistantThread(editorChapter, threadKey);
  const assistant = normalizeEditorAssistantState(editorChapter?.assistant);
  const items = Array.isArray(thread?.items) ? thread.items : [];
  const statusText = assistantTranscriptStatusText(assistant, threadKey);

  if (!activeRow || !targetLanguage) {
    return `
      <div class="assistant-empty">
        <p>Click on a translation on the left side to use the AI Assistant.</p>
      </div>
    `;
  }

  if (items.length === 0 && !statusText) {
    return `
      <div class="assistant-empty">
        <p>Chat with the AI Assistant about the selected translation.</p>
      </div>
    `;
  }

  return `
    <div class="assistant-transcript">
      ${assistant.error
        ? renderInlineStateBox({
          tone: "error",
          message: assistant.error,
        })
        : ""}
      ${items.map((item) => renderAssistantTranscriptItem(item, currentTargetText)).join("")}
      ${statusText ? `<p class="assistant-transcript__status">${escapeHtml(statusText)}</p>` : ""}
    </div>
  `;
}

function renderAssistantComposer(editorChapter, rows, languages, targetCode, offlineMode = false) {
  const activeRow = rows.find((row) => row.id === editorChapter?.activeRowId) ?? null;
  const translateLanguages = resolveEditorAiTranslateLanguages(editorChapter);
  const targetLanguage =
    translateLanguages.targetLanguage
    ?? translateLanguages.toolbarTargetLanguage
    ?? languages.find((language) => language.code === targetCode)
    ?? null;
  const assistant = normalizeEditorAssistantState(editorChapter?.assistant);
  const isDisabled = offlineMode === true || !activeRow || !targetLanguage;

  return `
    <div class="assistant-composer">
      <div class="assistant-composer__field-shell">
        <textarea
          class="assistant-composer__field"
          data-editor-assistant-draft
          placeholder="Ask AI Assistant about this translation..."
          ${isDisabled ? "disabled" : ""}
        >${escapeHtml(assistant.composerDraft)}</textarea>
      </div>
      <p class="translation-row-text-style-actions__hint assistant-composer__hint">Shift + Return to send</p>
    </div>
  `;
}

function renderAssistantPane(editorChapter, rows, languages, sourceCode, targetCode, actionConfig, offlineMode = false) {
  return `
    <div class="assistant-pane">
      ${renderTranslateTools(editorChapter, rows, languages, sourceCode, targetCode, actionConfig, offlineMode)}
      ${renderAssistantTranscript(editorChapter, rows, languages, sourceCode, targetCode)}
      ${renderAssistantComposer(editorChapter, rows, languages, targetCode, offlineMode)}
    </div>
  `;
}

function renderReviewPane(editorChapter, rows, languages, offlineMode = false) {
  const expandedSectionKeys =
    editorChapter?.reviewExpandedSectionKeys instanceof Set
      ? editorChapter.reviewExpandedSectionKeys
      : new Set(["last-update", "ai-review"]);
  const activeRow = rows.find((row) => row.id === editorChapter?.activeRowId) ?? null;
  const activeLanguage =
    languages.find((language) => language.code === editorChapter?.activeLanguageCode) ?? null;
  const activeSection = activeRow?.sections?.find((section) => section.code === activeLanguage?.code) ?? null;
  const history =
    editorChapter?.history && typeof editorChapter.history === "object"
      ? editorChapter.history
      : {
          status: "idle",
          error: "",
          entries: [],
  };
  const lastCommittedEntry = Array.isArray(history.entries) ? (history.entries[0] ?? null) : null;
  const previousEntry = findEditorHistoryPreviousCommitEntry(history.entries);
  const currentEntry = {
    plainText: activeSection?.text ?? "",
    footnote: activeSection?.footnote ?? "",
    imageCaption: activeSection?.imageCaption ?? "",
    image: activeSection?.image ?? null,
    reviewed: activeSection?.reviewed === true,
    pleaseCheck: activeSection?.pleaseCheck === true,
    textStyle: activeRow?.textStyle ?? "paragraph",
  };
  const lastUpdateEntry = lastCommittedEntry ?? currentEntry;
  const lastUpdateHeadingLabel = historyLastUpdateHeadingLabel(lastUpdateEntry);
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
  const aiReviewMeta = offlineMode === true
    ? "Offline"
    : aiReview.status === "loading"
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
    : offlineMode === true
      ? renderInlineStateBox({
        message: "AI actions are unavailable offline.",
      })
      : "";
  const reviewNowButton = aiReview.status === "loading"
    ? loadingPrimaryButton({
      label: "Review now",
      loadingLabel: "Reviewing...",
      action: "review-editor-text-now",
      isLoading: true,
    })
    : primaryButton("Review now", "review-editor-text-now", { disabled: offlineMode === true });
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
            <span class="history-group__author">${escapeHtml(lastUpdateHeadingLabel)}</span>
          </span>
          <span class="history-group__meta">${escapeHtml(summaryMeta)}</span>
        </button>
        ${
          isLastUpdateExpanded
            ? `
              <div class="history-group__entries">
                <article class="history-item">
                  ${renderHistoryEntryContent(lastUpdateEntry, previousEntry, activeLanguage.code)}
                  ${renderHistoryNote(lastUpdateEntry, previousEntry, { includeMarkers: false })}
                  ${
                    history.status === "loading"
                      ? '<p class="history-item__meta">Loading previous version...</p>'
                      : history.status === "error"
                        ? `<p class="history-item__note">${escapeHtml(history.error || "Could not load the previous version.")}</p>`
                        : previousEntry
                          ? '<p class="history-item__meta">Compared with the previous commit</p>'
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
  offlineMode = false,
) {
  const activeTab = normalizeEditorSidebarTab(editorChapter?.sidebarTab);
  const body = activeTab === "assistant"
    ? renderAssistantPane(editorChapter, rows, languages, sourceCode, targetCode, actionConfig, offlineMode)
    : activeTab === "comments"
    ? renderCommentsPane(editorChapter, rows, session)
    : activeTab === "review"
      ? renderReviewPane(editorChapter, rows, languages, offlineMode)
      : renderHistoryPane(editorChapter, rows, languages);

  return `
    <aside class="translate-sidebar card card--history${activeTab === "assistant" ? " translate-sidebar--assistant" : ""}">
      <div class="card__body">
        <div class="history-tabs">
          ${renderSidebarTab("AI Assistant", "assistant", activeTab, "translate")}
          ${renderSidebarTab("Review", "review", activeTab)}
          ${renderSidebarTab("History", "history", activeTab)}
          ${renderSidebarTab("Comments", "comments", activeTab)}
        </div>
        ${body}
      </div>
    </aside>
  `;
}
