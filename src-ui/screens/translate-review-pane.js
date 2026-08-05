import { resolveVisibleEditorAiReview } from "../app/editor-ai-review-state.js";
import { serializeEditorFootnotesForLegacy } from "../app/editor-footnotes.js";
import {
  historyLastUpdateHeadingLabel,
  isOptimisticEditorHistoryEntry,
} from "../app/editor-history.js";
import { editorFieldImageEqual } from "../app/editor-images.js";
import { normalizeEditorRowTextStyle } from "../app/editor-row-text-style.js";
import {
  escapeHtml,
  loadingSpinnerKeyAttribute,
  renderCollapseChevron,
  renderInlineStateBox,
  secondaryButton,
  tooltipAttributes,
} from "../lib/ui.js";
import {
  renderHistoryContent,
  renderHistoryEntryContent,
  renderHistoryNote,
} from "./translate-history-shared.js";

const PENDING_LOCAL_SAVE_ERROR_AFTER_MS = 10_000;

function renderAiReviewPromptDetails(aiReview) {
  const promptText = typeof aiReview?.promptText === "string" ? aiReview.promptText.trim() : "";
  if (!promptText) {
    return "";
  }

  return `
    <details class="assistant-item__details">
      <summary>Show prompt</summary>
      <div class="assistant-item__details-body">
        <div class="assistant-item__section">
          <p class="assistant-item__section-label">Prompt</p>
          <pre class="assistant-item__pre">${escapeHtml(promptText)}</pre>
        </div>
      </div>
    </details>
  `;
}

function renderAiReviewModeButton({ label, action, reviewMode, tooltip, isLoading = false, disabled = false }) {
  const tooltipMarkup = tooltipAttributes(tooltip, { align: "start" });
  const reviewModeAttribute = reviewMode ? ` data-ai-review-mode="${escapeHtml(reviewMode)}"` : "";
  if (isLoading) {
    return `
      <button class="button button--primary button--loading" data-action="noop"${loadingSpinnerKeyAttribute(action)}${reviewModeAttribute} disabled aria-busy="true"${tooltipMarkup}>
        <span class="button__spinner" aria-hidden="true"></span>
        <span>${escapeHtml(label)}...</span>
      </button>
    `;
  }

  return `
    <button
      class="button button--primary${disabled ? " is-disabled" : ""}"
      data-action="${escapeHtml(action)}"
      ${reviewModeAttribute}
      ${disabled ? 'disabled aria-disabled="true"' : ""}
      ${tooltipMarkup}
    >
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

function renderAiReviewSuggestionSections(aiReview, currentEntry, activeLanguage) {
  const sections = [];
  if (aiReview.suggestedText?.trim()) {
    sections.push(`
      <p class="history-item__content" lang="${escapeHtml(activeLanguage.code)}">${renderHistoryContent({ plainText: aiReview.suggestedText }, currentEntry)}</p>
    `);
  }
  if (aiReview.suggestedFootnote?.trim()) {
    sections.push(`
      <p class="history-item__meta">Footnote</p>
      <p class="history-item__content history-item__content--footnote" lang="${escapeHtml(activeLanguage.code)}">${renderHistoryContent({ plainText: aiReview.suggestedFootnote }, { plainText: currentEntry?.footnote ?? "" })}</p>
    `);
  }
  if (aiReview.suggestedImageCaption?.trim()) {
    sections.push(`
      <p class="history-item__meta">Image caption</p>
      <p class="history-item__content" lang="${escapeHtml(activeLanguage.code)}">${renderHistoryContent({ plainText: aiReview.suggestedImageCaption }, { plainText: currentEntry?.imageCaption ?? "" })}</p>
    `);
  }
  return sections.join("");
}

function editorReviewEntriesHaveSameContent(leftEntry, rightEntry) {
  if (!leftEntry || !rightEntry) {
    return false;
  }

  return (
    String(leftEntry.plainText ?? "") === String(rightEntry.plainText ?? "")
    && String(leftEntry.footnote ?? "") === String(rightEntry.footnote ?? "")
    && String(leftEntry.imageCaption ?? "") === String(rightEntry.imageCaption ?? "")
    && editorFieldImageEqual(leftEntry.image, rightEntry.image)
    && normalizeEditorRowTextStyle(leftEntry.textStyle) === normalizeEditorRowTextStyle(rightEntry.textStyle)
  );
}

function findLastCommittedReviewContentUpdate(entries) {
  const committedEntries = entries.filter((entry) => !isOptimisticEditorHistoryEntry(entry));
  if (committedEntries.length === 0) {
    return { entry: null, baselineEntry: null };
  }

  // Marker toggles and comment writes can create newer row revisions without
  // changing anything rendered in Last update. Walk to the oldest revision in
  // the newest equal-content run: that is the commit which introduced the
  // current text/image/style state. The next entry is its meaningful baseline.
  let contentUpdateIndex = 0;
  while (
    contentUpdateIndex + 1 < committedEntries.length
    && editorReviewEntriesHaveSameContent(
      committedEntries[contentUpdateIndex],
      committedEntries[contentUpdateIndex + 1],
    )
  ) {
    contentUpdateIndex += 1;
  }

  return {
    entry: committedEntries[contentUpdateIndex],
    baselineEntry: committedEntries[contentUpdateIndex + 1] ?? null,
  };
}

function pendingLocalSaveAgeMs(entry) {
  const committedAtMs = Date.parse(entry?.committedAt ?? "");
  if (!Number.isFinite(committedAtMs)) {
    return 0;
  }
  return Math.max(0, Date.now() - committedAtMs);
}

export function renderReviewPane(editorChapter, rows, languages, offlineMode = false) {
  const expandedSectionKeys =
    editorChapter?.reviewExpandedSectionKeys instanceof Set
      ? editorChapter.reviewExpandedSectionKeys
      : new Set(["last-update", "ai-review"]);
  const activeRow = rows.find((row) => row.id === editorChapter?.activeRowId) ?? null;
  const activeLanguage =
    languages.find((language) => language.code === editorChapter?.activeLanguageCode) ?? null;
  const activeSection = activeRow?.sections?.find((section) => section.code === activeLanguage?.code) ?? null;
  // History entries and AI review state carry footnotes in the persisted
  // labeled serialization; the section's plain text would falsely diff as a
  // change whenever marker labels are present.
  const activeSectionFootnote = serializeEditorFootnotesForLegacy(
    activeSection?.footnotes ?? activeSection?.footnote ?? "",
  );
  const history =
    editorChapter?.history && typeof editorChapter.history === "object"
      ? editorChapter.history
      : {
          status: "idle",
          error: "",
          entries: [],
  };
  const historyEntries = Array.isArray(history.entries) ? history.entries : [];
  const newestPendingLocalSaveEntry =
    historyEntries.find((entry) => isOptimisticEditorHistoryEntry(entry)) ?? null;
  const newestCommittedEntry =
    historyEntries.find((entry) => !isOptimisticEditorHistoryEntry(entry)) ?? null;
  const committedContentUpdate = findLastCommittedReviewContentUpdate(historyEntries);
  const lastCommittedEntry = committedContentUpdate.entry;
  const previousEntry = committedContentUpdate.baselineEntry;
  const pendingLocalSaveEntry =
    newestPendingLocalSaveEntry
    && (
      !newestCommittedEntry
      || !editorReviewEntriesHaveSameContent(newestPendingLocalSaveEntry, newestCommittedEntry)
    )
      ? newestPendingLocalSaveEntry
      : null;
  const currentEntry = {
    plainText: activeSection?.text ?? "",
    footnote: activeSectionFootnote,
    imageCaption: activeSection?.imageCaption ?? "",
    image: activeSection?.image ?? null,
    reviewed: activeSection?.reviewed === true,
    pleaseCheck: activeSection?.pleaseCheck === true,
    textStyle: activeRow?.textStyle ?? "paragraph",
  };
  const currentEntryMatchesPendingSave =
    pendingLocalSaveEntry
    && editorReviewEntriesHaveSameContent(pendingLocalSaveEntry, currentEntry);
  const currentEntryMatchesLastCommit =
    lastCommittedEntry
    && editorReviewEntriesHaveSameContent(lastCommittedEntry, currentEntry);
  const showsPendingLocalSave = Boolean(currentEntryMatchesPendingSave);
  const pendingLocalSaveIsOverdue =
    showsPendingLocalSave
    && pendingLocalSaveAgeMs(pendingLocalSaveEntry) >= PENDING_LOCAL_SAVE_ERROR_AFTER_MS;
  const showsCurrentEntry = !showsPendingLocalSave && !currentEntryMatchesLastCommit;
  const lastUpdateEntry = showsPendingLocalSave
    ? pendingLocalSaveEntry
    : showsCurrentEntry
      ? currentEntry
      : lastCommittedEntry;
  const lastUpdateBaselineEntry = showsPendingLocalSave
    ? lastCommittedEntry
    : showsCurrentEntry
    ? lastCommittedEntry
    : previousEntry;
  const lastUpdateHeadingLabel = showsPendingLocalSave
    ? pendingLocalSaveIsOverdue
      ? "Local save stalled"
      : "Saving locally..."
    : showsCurrentEntry
    ? "Current text"
    : historyLastUpdateHeadingLabel(lastUpdateEntry);
  const isLastUpdateExpanded = expandedSectionKeys.has("last-update");
  const isAiReviewExpanded = expandedSectionKeys.has("ai-review");
  const lastUpdateSummaryTooltip = tooltipAttributes(
    isLastUpdateExpanded ? "Collapse this review section" : "Expand this review section",
    { align: "start" },
  );
  const summaryMeta = showsPendingLocalSave
    ? pendingLocalSaveIsOverdue
      ? "Error"
      : ""
    : history.status === "loading"
    ? "Loading..."
    : history.status === "error"
      ? "Error"
      : lastUpdateBaselineEntry
        ? "Diff"
        : "Text only";
  const summaryMetaHtml = showsPendingLocalSave && !pendingLocalSaveIsOverdue
    ? '<span class="history-group__spinner button__spinner" aria-hidden="true"></span>'
    : escapeHtml(summaryMeta);
  const aiReview = resolveVisibleEditorAiReview(
    editorChapter,
    activeRow?.id ?? null,
    activeLanguage?.code ?? null,
    activeSection?.text ?? "",
    activeSectionFootnote,
    activeSection?.imageCaption ?? "",
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
        ? aiReview.fullReviewPassed
          ? "Looks good!"
          : "Grammar okay"
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
  const pendingLocalSaveMessage = showsPendingLocalSave && pendingLocalSaveIsOverdue
    ? renderInlineStateBox({
      tone: "error",
      message: "This edit is not committed locally yet, and the local save has not finished.",
      help: "The save operation is still running in the background. Leaving the editor is blocked until it finishes or reports an error.",
    })
    : "";
  const showFullReviewButton = aiReview.status === "loading"
    ? aiReview.reviewMode === "meaning"
    : aiReview.showFullReviewButton;
  const showGrammarReviewButton = aiReview.status === "loading"
    ? aiReview.reviewMode !== "meaning"
    : aiReview.showGrammarReviewButton;
  const reviewModeButtons = `
    ${showFullReviewButton
      ? renderAiReviewModeButton({
        label: "Full review",
        action: "review-editor-text-now:meaning",
        reviewMode: "meaning",
        tooltip: "Check to see if the translation is correct in addition to checking spelling and grammar.",
        isLoading: aiReview.status === "loading" && aiReview.reviewMode === "meaning",
        disabled: offlineMode === true || aiReview.status === "loading",
      })
      : ""}
    ${showGrammarReviewButton
      ? renderAiReviewModeButton({
        label: "Spelling and grammar only",
        action: "review-editor-text-now:grammar",
        reviewMode: "grammar",
        tooltip: "Check only for spelling and grammar errors.",
        isLoading: aiReview.status === "loading" && aiReview.reviewMode !== "meaning",
        disabled: offlineMode === true || aiReview.status === "loading",
      })
      : ""}
  `;
  const reviewModeButtonsFooter = reviewModeButtons.trim()
    ? `
      <div class="history-item__footer">
        <div class="history-item__actions">
          ${reviewModeButtons}
        </div>
      </div>
    `
    : "";
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
          <span class="history-group__meta">${summaryMetaHtml}</span>
        </button>
        ${
          isLastUpdateExpanded
            ? `
              <div class="history-group__entries">
                <article class="history-item">
                  ${pendingLocalSaveMessage}
                  ${renderHistoryEntryContent(lastUpdateEntry, lastUpdateBaselineEntry, activeLanguage.code)}
                  ${renderHistoryNote(lastUpdateEntry, lastUpdateBaselineEntry, {
                    includeMarkers: false,
                    includeStatusNote: !showsPendingLocalSave,
                  })}
                  ${
                    history.status === "loading"
                      ? '<p class="history-item__meta">Loading previous version...</p>'
                      : history.status === "error"
                        ? `<p class="history-item__note">${escapeHtml(history.error || "Could not load the previous version.")}</p>`
                        : lastUpdateBaselineEntry
                          ? `<p class="history-item__meta">${showsCurrentEntry ? "Compared with the latest saved version" : "Compared with the previous commit"}</p>`
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
                        ${renderAiReviewSuggestionSections(aiReview, currentEntry, activeLanguage)}
                        <div class="history-item__footer">
                          <div class="history-item__actions">
                            ${applyButton}
                          </div>
                          <p class="history-item__meta">Compared with the current text</p>
                        </div>
                        ${renderAiReviewPromptDetails(aiReview)}
                      `
                      : aiReview.showLooksGoodMessage
                        ? `
                          <p class="history-item__content" lang="${escapeHtml(activeLanguage.code)}">${escapeHtml(aiReview.fullReviewPassed ? "Your translation looks good!" : "Spelling and grammar look good!")}</p>
                          ${renderAiReviewPromptDetails(aiReview)}
                          ${reviewModeButtonsFooter}
                        `
                      : `
                        ${aiReviewMessage}
                        ${renderAiReviewPromptDetails(aiReview)}
                        ${reviewModeButtonsFooter}
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
